-- Runtime support for formats authored by the graphical builder.
-- This migration deliberately replaces the graph functions instead of editing
-- an applied migration so existing tournament snapshots remain reproducible.

create or replace function public.graph_config_edges(p_config jsonb)
returns table (
  edge_id text,
  source_node_id text,
  destination_node_id text,
  priority integer,
  condition jsonb
)
language sql
stable
as $$
  select
    edge.value ->> 'id',
    edge.value ->> 'sourceNodeId',
    edge.value ->> 'destinationNodeId',
    coalesce((edge.value ->> 'priority')::integer, 1),
    jsonb_build_object('rankingMetric', 'points') || coalesce(edge.value -> 'condition', '{}'::jsonb)
  from jsonb_array_elements(coalesce(p_config -> 'edges', '[]'::jsonb)) edge(value);
$$;

drop function if exists public.start_tournament(text, jsonb);
create function public.start_tournament(
  p_tournament_id text,
  p_initial_assignments jsonb default '[]'::jsonb
)
returns table (
  started_tournament_id text,
  started_entrant_count integer,
  started_round_id text,
  started_round_number integer
)
language plpgsql
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_config jsonb;
  v_graph boolean;
  v_entrant_count integer;
  v_first_round public.rounds%rowtype;
  v_root_count integer;
begin
  select * into v_tournament
  from public.tournaments
  where id::text = p_tournament_id
  for update;

  if not found then raise exception 'Tournament was not found.'; end if;
  v_config := v_tournament.format_config;
  v_graph := jsonb_typeof(v_config -> 'nodes') = 'array'
    and jsonb_typeof(v_config -> 'edges') = 'array';

  if not v_graph then
    return query select * from public.start_linear_tournament(p_tournament_id);
    return;
  end if;
  if v_tournament.status <> 'accepting_players' then raise exception 'Tournament has already started.'; end if;

  select count(*)::integer into v_entrant_count
  from public.tournament_registrations registrations
  where registrations.tournament_id = v_tournament.id
    and registrations.registration_status = 'registered';
  if v_entrant_count = 0 then raise exception 'Register at least one player before starting the tournament.'; end if;
  if v_config -> 'startRequirement' ->> 'exactEntrants' ~ '^\d+$'
    and v_entrant_count <> (v_config -> 'startRequirement' ->> 'exactEntrants')::integer then
    raise exception 'This graph requires exactly % entrants.', v_config -> 'startRequirement' ->> 'exactEntrants';
  end if;
  if v_config -> 'startRequirement' ->> 'minimumEntrants' ~ '^\d+$'
    and v_entrant_count < (v_config -> 'startRequirement' ->> 'minimumEntrants')::integer then
    raise exception 'Register at least % players before starting the tournament.', v_config -> 'startRequirement' ->> 'minimumEntrants';
  end if;
  if jsonb_typeof(coalesce(p_initial_assignments, '[]'::jsonb)) <> 'array' then
    raise exception 'Initial node assignments must be an array.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
    join public.tournament_registrations registrations
      on registrations.id::text = assignment.value ->> 'registrationId'
     and registrations.tournament_id = v_tournament.id
    where assignment.value ->> 'nodeId' is null
  ) then raise exception 'Every initial assignment needs a node.'; end if;
  if (
    select count(*) from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
  ) <> (
    select count(distinct assignment.value ->> 'registrationId') from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
  ) then raise exception 'A registration may only be assigned to one entry node.'; end if;

  insert into public.tournament_participants (tournament_id, registration_id, seed_number, display_name_at_start)
  select v_tournament.id, registrations.id,
    row_number() over (order by registrations.created_at, registrations.id)::integer,
    registrations.display_name
  from public.tournament_registrations registrations
  where registrations.tournament_id = v_tournament.id
    and registrations.registration_status = 'registered'
  order by registrations.created_at, registrations.id
  limit v_tournament.max_players
  on conflict (tournament_id, registration_id) do nothing;

  update public.tournament_registrations registrations
  set registration_status = case when exists (
    select 1 from public.tournament_participants participants
    where participants.registration_id = registrations.id
      and participants.tournament_id = v_tournament.id
  ) then 'entered' else 'waitlisted' end
  where registrations.tournament_id = v_tournament.id
    and registrations.registration_status = 'registered';

  insert into public.rounds (tournament_id, round_number, format_round_id, stage_name, node_depth, status)
  select v_tournament.id, row_number() over (order by nodes.ordinality)::integer,
    nodes.value ->> 'id', nodes.value ->> 'name', nodes.ordinality::integer, 'pending'
  from jsonb_array_elements(v_config -> 'nodes') with ordinality nodes(value, ordinality)
  on conflict (tournament_id, format_round_id) do update
    set stage_name = excluded.stage_name, node_depth = excluded.node_depth;

  insert into public.tournament_edges (
    tournament_id, format_edge_id, source_round_id, destination_round_id, priority, condition
  )
  select v_tournament.id, edges.edge_id, source_round.id, destination_round.id,
    edges.priority, coalesce(edges.condition, '{}'::jsonb)
  from public.graph_config_edges(v_config) edges
  join public.rounds source_round
    on source_round.tournament_id = v_tournament.id and source_round.format_round_id = edges.source_node_id
  join public.rounds destination_round
    on destination_round.tournament_id = v_tournament.id and destination_round.format_round_id = edges.destination_node_id
  on conflict (tournament_id, format_edge_id) do update
    set source_round_id = excluded.source_round_id,
        destination_round_id = excluded.destination_round_id,
        priority = excluded.priority,
        condition = excluded.condition,
        status = 'pending', advanced_player_count = 0, resolved_at = null;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
    where not exists (
      select 1 from public.tournament_participants participants
      where participants.tournament_id = v_tournament.id
        and participants.registration_id::text = assignment.value ->> 'registrationId'
    )
    or not exists (
      select 1 from public.rounds roots
      where roots.tournament_id = v_tournament.id
        and roots.format_round_id = assignment.value ->> 'nodeId'
        and not exists (select 1 from public.tournament_edges incoming where incoming.destination_round_id = roots.id)
    )
  ) then raise exception 'Initial assignments must reference selected registrations and entry nodes.'; end if;

  select count(*)::integer into v_root_count
  from public.rounds nodes
  where nodes.tournament_id = v_tournament.id
    and not exists (select 1 from public.tournament_edges edges where edges.destination_round_id = nodes.id);

  -- A numeric initialEntrantSlots value is a hard capacity. "all" means all
  -- entrants for a single root, or an even share when several roots exist.
  if (
    select coalesce(sum(root_capacity), 0)
    from (
      select case
        when (public.graph_config_node(v_config, roots.format_round_id) ->> 'initialEntrantSlots') ~ '^\d+$'
          then (public.graph_config_node(v_config, roots.format_round_id) ->> 'initialEntrantSlots')::integer
        else greatest(1, ceil(v_entrant_count::numeric / greatest(v_root_count, 1)))::integer
      end as root_capacity
      from public.rounds roots
      where roots.tournament_id = v_tournament.id
        and not exists (select 1 from public.tournament_edges incoming where incoming.destination_round_id = roots.id)
    ) capacities
  ) < v_entrant_count then
    raise exception 'Entry node capacities do not fit all registered players.';
  end if;

  if exists (
    select 1
    from (
      select assignment.value ->> 'nodeId' as node_id, count(*)::integer as assigned_count
      from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
      group by assignment.value ->> 'nodeId'
    ) assigned
    join public.rounds roots
      on roots.tournament_id = v_tournament.id and roots.format_round_id = assigned.node_id
    where assigned.assigned_count > case
      when (public.graph_config_node(v_config, roots.format_round_id) ->> 'initialEntrantSlots') ~ '^\d+$'
        then (public.graph_config_node(v_config, roots.format_round_id) ->> 'initialEntrantSlots')::integer
      else greatest(1, ceil(v_entrant_count::numeric / greatest(v_root_count, 1)))::integer
    end
  ) then raise exception 'Initial assignments exceed an entry node capacity.'; end if;

  insert into public.participant_round_scores (participant_id, round_id, round_seed_number, score)
  with roots as (
    select nodes.id, nodes.format_round_id,
      row_number() over (order by nodes.id)::integer as root_number,
      case
        when (public.graph_config_node(v_config, nodes.format_round_id) ->> 'initialEntrantSlots') ~ '^\d+$'
          then (public.graph_config_node(v_config, nodes.format_round_id) ->> 'initialEntrantSlots')::integer
        else greatest(1, ceil(v_entrant_count::numeric / greatest(v_root_count, 1)))::integer
      end as capacity
    from public.rounds nodes
    where nodes.tournament_id = v_tournament.id
      and not exists (select 1 from public.tournament_edges incoming where incoming.destination_round_id = nodes.id)
  ), explicit as (
    select participants.id, roots.id as round_id
    from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
    join public.tournament_participants participants
      on participants.registration_id::text = assignment.value ->> 'registrationId'
     and participants.tournament_id = v_tournament.id
    join roots on roots.format_round_id = assignment.value ->> 'nodeId'
  ), root_usage as (
    select roots.id, roots.root_number, roots.capacity, count(explicit.id)::integer as explicit_count
    from roots left join explicit on explicit.round_id = roots.id
    group by roots.id, roots.root_number, roots.capacity
  ), open_slots as (
    select usage.id as round_id,
      row_number() over (order by usage.root_number, slots.slot_number)::integer as slot_number
    from root_usage usage
    cross join lateral generate_series(usage.explicit_count + 1, usage.capacity) slots(slot_number)
  ), entrants as (
    select participants.id,
      row_number() over (order by random())::integer as random_number
    from public.tournament_participants participants
    where participants.tournament_id = v_tournament.id
      and not exists (select 1 from explicit where explicit.id = participants.id)
  ), assigned as (
    select explicit.id, explicit.round_id from explicit
    union all
    select entrants.id, open_slots.round_id
    from entrants join open_slots on open_slots.slot_number = entrants.random_number
  )
  select assigned.id, assigned.round_id,
    row_number() over (partition by assigned.round_id order by random())::integer, 0
  from assigned
  on conflict (participant_id, round_id) do nothing;

  update public.rounds nodes
  set status = case when exists (
      select 1 from public.participant_round_scores scores where scores.round_id = nodes.id
    ) then 'active' else 'skipped' end, updated_at = now()
  where nodes.tournament_id = v_tournament.id
    and not exists (select 1 from public.tournament_edges edges where edges.destination_round_id = nodes.id);
  update public.tournament_edges edges
  set status = 'resolved', resolved_at = now(), updated_at = now()
  where edges.source_round_id in (
    select nodes.id from public.rounds nodes
    where nodes.tournament_id = v_tournament.id and nodes.status = 'skipped'
  );

  for v_first_round in
    select nodes.* from public.rounds nodes
    where nodes.tournament_id = v_tournament.id and nodes.status = 'active'
    order by nodes.round_number, nodes.id
  loop
    perform public.generate_round_lobbies(v_first_round.id::text);
  end loop;
  select nodes.* into v_first_round
  from public.rounds nodes
  where nodes.tournament_id = v_tournament.id and nodes.status = 'active'
  order by nodes.round_number, nodes.id limit 1;
  update public.tournaments
  set status = 'in_progress', started_at = coalesce(started_at, now()), current_round_id = v_first_round.id, updated_at = now()
  where id = v_tournament.id;
  select count(*)::integer into v_entrant_count
  from public.tournament_participants participants where participants.tournament_id = v_tournament.id;
  return query select v_tournament.id::text, v_entrant_count, v_first_round.id::text, v_first_round.round_number;
end;
$$;

drop function if exists public.finalize_tournament_node(text, text);
create function public.finalize_tournament_node(p_tournament_id text, p_node_id text)
returns table (
  transition_type text,
  completed_node_id text,
  activated_node_ids text[],
  skipped_node_ids text[],
  advanced_player_count integer
)
language plpgsql
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_node public.rounds%rowtype;
  v_config jsonb;
  v_edge record;
  v_player record;
  v_count integer;
  v_edge_advanced integer;
  v_temp_seed integer;
  v_destination public.rounds%rowtype;
  v_activated text[] := ARRAY[]::text[];
  v_skipped text[] := ARRAY[]::text[];
  v_total_advanced integer := 0;
  v_decisive integer;
  v_consumed uuid[] := ARRAY[]::uuid[];
begin
  select * into v_tournament from public.tournaments where id::text = p_tournament_id for update;
  if not found then raise exception 'Tournament was not found.'; end if;
  select * into v_node from public.rounds where id::text = p_node_id and tournament_id = v_tournament.id for update;
  if not found then raise exception 'Tournament node was not found.'; end if;
  if v_node.status in ('completed', 'skipped', 'cancelled') then
    return query select 'node_already_finalized', v_node.id::text, v_activated, v_skipped, 0;
    return;
  end if;
  if v_node.status <> 'active' then raise exception 'Tournament node is not active.'; end if;

  v_config := public.graph_config_node(v_tournament.format_config, v_node.format_round_id);
  if v_config is null then raise exception 'Graph node configuration was not found.'; end if;
  if v_config -> 'winCondition' ->> 'type' = 'checkmate' then
    if (select count(*) from public.participant_round_scores where round_id = v_node.id) <> 8 then raise exception 'Checkmate nodes require exactly eight participants.'; end if;
    v_decisive := public.checkmate_decisive_game(v_node.id::text, coalesce((v_config -> 'winCondition' ->> 'threshold')::integer, 0));
    if v_decisive is null and not exists (
      select 1 from public.lobbies where round_id = v_node.id and game_number >= coalesce((v_config -> 'winCondition' ->> 'maxGames')::integer, 2147483647)
    ) then raise exception 'Checkmate has not been achieved.'; end if;
  else
    if exists (
      select 1 from public.lobbies lobbies
      left join public.lobby_participants participants on participants.lobby_id = lobbies.id
      where lobbies.round_id = v_node.id and (participants.id is null or participants.result_status not in ('confirmed', 'corrected'))
    ) then raise exception 'Complete every lobby result before finalizing the node.'; end if;
  end if;

  for v_edge in
    select * from public.tournament_edges where source_round_id = v_node.id and status = 'pending' order by priority, id
  loop
    v_count := greatest(coalesce((v_edge.condition ->> 'count')::integer, 0), 0);
    v_edge_advanced := 0;
    select coalesce(max(round_seed_number), 0) + 1 into v_temp_seed
    from public.participant_round_scores where round_id = v_edge.destination_round_id;
    for v_player in
      with tournament_totals as (
        select scores.participant_id, sum(scores.score)::integer as tournament_points
        from public.participant_round_scores scores
        join public.rounds score_round on score_round.id = scores.round_id
        where score_round.tournament_id = v_tournament.id
        group by scores.participant_id
      ), ranked as (
        select scores.participant_id,
          row_number() over (
            order by
              case when coalesce(v_edge.condition ->> 'rankingMetric', 'points') = 'tournament_points'
                then coalesce(tournament_totals.tournament_points, 0)
                else scores.score end desc,
              scores.round_seed_number asc,
              participants.display_name_at_start asc,
              participants.id::text
          )::integer as source_rank
        from public.participant_round_scores scores
        join public.tournament_participants participants on participants.id = scores.participant_id
        left join tournament_totals on tournament_totals.participant_id = scores.participant_id
        where scores.round_id = v_node.id
      )
      select ranked.participant_id, ranked.source_rank
      from ranked
      where not (ranked.participant_id = any(v_consumed))
      order by ranked.source_rank
      limit v_count
    loop
      insert into public.participant_round_scores (participant_id, round_id, round_seed_number, score, source_edge_id, source_rank)
      values (v_player.participant_id, v_edge.destination_round_id, v_temp_seed, 0, v_edge.id, v_player.source_rank)
      on conflict (participant_id, round_id) do update
        set source_edge_id = excluded.source_edge_id, source_rank = excluded.source_rank, score = 0, updated_at = now();
      v_consumed := array_append(v_consumed, v_player.participant_id);
      v_temp_seed := v_temp_seed + 1;
      v_edge_advanced := v_edge_advanced + 1;
      v_total_advanced := v_total_advanced + 1;
    end loop;
    update public.tournament_edges
    set status = 'resolved', advanced_player_count = v_edge_advanced, resolved_at = now(), updated_at = now()
    where id = v_edge.id;
  end loop;

  update public.rounds set status = 'completed', updated_at = now() where id = v_node.id;
  loop
    select nodes.* into v_destination
    from public.rounds nodes
    where nodes.tournament_id = v_tournament.id and nodes.status = 'pending'
      and exists (select 1 from public.tournament_edges edges where edges.destination_round_id = nodes.id)
      and not exists (
        select 1 from public.tournament_edges edges
        where edges.destination_round_id = nodes.id and edges.status <> 'resolved'
      )
    order by nodes.round_number, nodes.id limit 1;
    exit when not found;
    if exists (select 1 from public.participant_round_scores scores where scores.round_id = v_destination.id) then
      with ranked as (
        select scores.participant_id,
          row_number() over (order by scores.source_rank nulls last, scores.source_edge_id nulls last, scores.participant_id)::integer as next_seed
        from public.participant_round_scores scores where scores.round_id = v_destination.id
      )
      update public.participant_round_scores scores set round_seed_number = ranked.next_seed, updated_at = now()
      from ranked where ranked.participant_id = scores.participant_id and scores.round_id = v_destination.id;
      update public.rounds set status = 'active', updated_at = now() where id = v_destination.id;
      perform public.generate_round_lobbies(v_destination.id::text);
      v_activated := array_append(v_activated, v_destination.id::text);
    else
      update public.rounds set status = 'skipped', updated_at = now() where id = v_destination.id;
      update public.tournament_edges set status = 'resolved', updated_at = now() where source_round_id = v_destination.id and status = 'pending';
      v_skipped := array_append(v_skipped, v_destination.id::text);
    end if;
  end loop;

  if not exists (select 1 from public.rounds where tournament_id = v_tournament.id and status in ('active', 'pending')) then
    update public.tournaments set status = 'completed', updated_at = now() where id = v_tournament.id;
  end if;
  return query select case when (select status from public.tournaments where id = v_tournament.id) = 'completed' then 'tournament_completed' else 'node_finalized' end,
    v_node.id::text, v_activated, v_skipped, v_total_advanced;
end;
$$;

notify pgrst, 'reload schema';
