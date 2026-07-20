-- Graph tournament runtime.  Legacy rounds remain as the physical gameplay
-- table for this migration; each round row now represents one graph node.

alter table public.rounds drop constraint if exists rounds_status_check;
alter table public.rounds add constraint rounds_status_check check (
  status in ('pending', 'active', 'completed', 'cancelled', 'skipped')
);

drop index if exists public.rounds_unique_tournament_number_idx;
alter table public.rounds add column if not exists node_depth integer;
alter table public.participant_round_scores add column if not exists source_edge_id bigint;
alter table public.participant_round_scores add column if not exists source_rank integer;
create unique index if not exists rounds_unique_tournament_format_node_idx
  on public.rounds(tournament_id, format_round_id);

do $$
declare
  v_tournament_id_type text;
  v_round_id_type text;
begin
  if to_regclass('public.tournament_edges') is null then
    select format_type(a.atttypid, a.atttypmod) into v_tournament_id_type
    from pg_attribute a
    where a.attrelid = 'public.tournaments'::regclass and a.attname = 'id' and not a.attisdropped;
    select format_type(a.atttypid, a.atttypmod) into v_round_id_type
    from pg_attribute a
    where a.attrelid = 'public.rounds'::regclass and a.attname = 'id' and not a.attisdropped;
    execute format($sql$
      create table public.tournament_edges (
        id bigint generated always as identity primary key,
        tournament_id %s not null references public.tournaments(id) on delete cascade,
        format_edge_id text not null,
        source_round_id %s not null references public.rounds(id) on delete cascade,
        destination_round_id %s not null references public.rounds(id) on delete cascade,
        priority integer not null check (priority > 0),
        condition jsonb not null,
        status text not null default 'pending' check (status in ('pending', 'resolved')),
        advanced_player_count integer not null default 0 check (advanced_player_count >= 0),
        resolved_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tournament_id, format_edge_id),
        unique (source_round_id, priority)
      )
    $sql$, v_tournament_id_type, v_round_id_type, v_round_id_type);
  end if;
end $$;

create index if not exists tournament_edges_destination_idx
  on public.tournament_edges(destination_round_id, status);

alter table public.participant_round_scores
  add constraint participant_round_scores_source_edge_fk
  foreign key (source_edge_id) references public.tournament_edges(id) on delete set null;

create or replace function public.graph_config_node(
  p_config jsonb,
  p_node_id text
)
returns jsonb
language sql
stable
as $$
  select node.value
  from jsonb_array_elements(coalesce(p_config -> 'nodes', '[]'::jsonb)) node(value)
  where node.value ->> 'id' = p_node_id
  limit 1;
$$;

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
    edge.value -> 'condition'
  from jsonb_array_elements(coalesce(p_config -> 'edges', '[]'::jsonb)) edge(value);
$$;

alter function public.start_tournament(text) rename to start_linear_tournament;

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

  if v_tournament.status <> 'accepting_players' then
    raise exception 'Tournament has already started.';
  end if;

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
  ) then
    raise exception 'Every initial assignment needs a node.';
  end if;
  if (
    select count(*) from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
  ) <> (
    select count(distinct assignment.value ->> 'registrationId') from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
  ) then
    raise exception 'A registration may only be assigned to one entry node.';
  end if;

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
  select v_tournament.id,
    row_number() over (order by nodes.ordinality)::integer,
    nodes.value ->> 'id',
    nodes.value ->> 'name',
    nodes.ordinality::integer,
    'pending'
  from jsonb_array_elements(v_config -> 'nodes') with ordinality nodes(value, ordinality)
  on conflict (tournament_id, format_round_id) do update
    set stage_name = excluded.stage_name,
        node_depth = excluded.node_depth;

  insert into public.tournament_edges (
    tournament_id, format_edge_id, source_round_id, destination_round_id, priority, condition
  )
  select v_tournament.id, edges.edge_id, source_round.id, destination_round.id,
    edges.priority, coalesce(edges.condition, '{}'::jsonb)
  from public.graph_config_edges(v_config) edges
  join public.rounds source_round on source_round.tournament_id = v_tournament.id and source_round.format_round_id = edges.source_node_id
  join public.rounds destination_round on destination_round.tournament_id = v_tournament.id and destination_round.format_round_id = edges.destination_node_id
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
      select 1
      from public.tournament_participants participants
      where participants.tournament_id = v_tournament.id
        and participants.registration_id::text = assignment.value ->> 'registrationId'
    )
    or not exists (
      select 1
      from public.rounds roots
      where roots.tournament_id = v_tournament.id
        and roots.format_round_id = assignment.value ->> 'nodeId'
        and not exists (select 1 from public.tournament_edges incoming where incoming.destination_round_id = roots.id)
    )
  ) then
    raise exception 'Initial assignments must reference selected registrations and entry nodes.';
  end if;

  select count(*)::integer into v_root_count
  from public.rounds nodes
  where nodes.tournament_id = v_tournament.id
    and not exists (select 1 from public.tournament_edges edges where edges.destination_round_id = nodes.id);

  -- With one entry node every selected entrant starts there. For multiple roots,
  -- explicit assignments are honored and the remainder is distributed randomly.
  insert into public.participant_round_scores (participant_id, round_id, round_seed_number, score)
  with roots as (
    select nodes.id, nodes.format_round_id,
      row_number() over (order by nodes.id)::integer as root_number
    from public.rounds nodes
    where nodes.tournament_id = v_tournament.id
      and not exists (select 1 from public.tournament_edges edges where edges.destination_round_id = nodes.id)
  ), explicit as (
    select participants.id, roots.id as round_id
    from jsonb_array_elements(coalesce(p_initial_assignments, '[]'::jsonb)) assignment(value)
    join public.tournament_participants participants
      on participants.registration_id::text = assignment.value ->> 'registrationId'
     and participants.tournament_id = v_tournament.id
    join roots on roots.format_round_id = assignment.value ->> 'nodeId'
  ), entrants as (
    select participants.id, row_number() over (order by random())::integer as random_number
    from public.tournament_participants participants
    where participants.tournament_id = v_tournament.id
      and not exists (select 1 from explicit where explicit.id = participants.id)
  ), assigned as (
    select explicit.id, explicit.round_id
    from explicit
    union all
    select entrants.id,
      case when v_root_count = 1 then (select roots.id from roots limit 1)
      else (select roots.id from roots where roots.root_number = ((entrants.random_number - 1) % v_root_count) + 1) end as round_id
    from entrants
  )
  select assigned.id, assigned.round_id,
    row_number() over (partition by assigned.round_id order by random())::integer,
    0
  from assigned
  on conflict (participant_id, round_id) do nothing;

  update public.rounds nodes
  set status = case when exists (
      select 1 from public.participant_round_scores scores where scores.round_id = nodes.id
    ) then 'active' else 'skipped' end,
    updated_at = now()
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
  v_remaining integer := 0;
  v_taken integer := 0;
  v_count integer;
  v_temp_seed integer;
  v_destination public.rounds%rowtype;
  v_activated text[] := '{}';
  v_skipped text[] := '{}';
  v_total_advanced integer := 0;
  v_decisive integer;
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

  select count(*)::integer into v_remaining from public.participant_round_scores where round_id = v_node.id;
  for v_edge in
    select * from public.tournament_edges where source_round_id = v_node.id and status = 'pending' order by priority, id
  loop
    v_count := coalesce((v_edge.condition ->> 'count')::integer, 0);
    for v_player in
      select scores.participant_id, row_number() over (
        order by scores.score desc, scores.round_seed_number asc, participants.display_name_at_start asc, participants.id::text
      )::integer as source_rank
      from public.participant_round_scores scores
      join public.tournament_participants participants on participants.id = scores.participant_id
      where scores.round_id = v_node.id
      order by scores.score desc, scores.round_seed_number asc, participants.display_name_at_start asc, participants.id::text
      offset v_taken limit v_count
    loop
      select coalesce(max(round_seed_number), 0) + 1 into v_temp_seed
      from public.participant_round_scores
      where round_id = v_edge.destination_round_id;
      insert into public.participant_round_scores (participant_id, round_id, round_seed_number, score, source_edge_id, source_rank)
      values (v_player.participant_id, v_edge.destination_round_id, v_temp_seed, 0, v_edge.id, v_player.source_rank)
      on conflict (participant_id, round_id) do update set source_edge_id = excluded.source_edge_id, source_rank = excluded.source_rank, score = 0;
      v_taken := v_taken + 1;
      v_total_advanced := v_total_advanced + 1;
    end loop;
    update public.tournament_edges set status = 'resolved', advanced_player_count = least(v_count, greatest(v_remaining - (v_taken - v_count), 0)), resolved_at = now(), updated_at = now() where id = v_edge.id;
  end loop;

  update public.rounds set status = 'completed', updated_at = now() where id = v_node.id;

  -- Activate every destination whose incoming edges have all resolved. A loop
  -- also skips empty nodes and propagates zero-player branches.
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
      update public.tournament_edges set status = 'resolved', resolved_at = now(), updated_at = now() where source_round_id = v_destination.id and status = 'pending';
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

drop function if exists public.randomize_pending_lobby_results(text, text);
create function public.randomize_pending_lobby_results(p_tournament_id text, p_node_id text)
returns table (randomized_lobby_count integer, randomized_participant_count integer)
language plpgsql
as $$
declare
  v_lobby record;
  v_results jsonb;
  v_lobbies integer := 0;
  v_participants integer := 0;
begin
  for v_lobby in
    select lobbies.id from public.lobbies lobbies join public.rounds nodes on nodes.id = lobbies.round_id
    where nodes.tournament_id::text = p_tournament_id and nodes.id::text = p_node_id and nodes.status = 'active'
      and exists (select 1 from public.lobby_participants pending where pending.lobby_id = lobbies.id and pending.result_status = 'pending')
    order by lobbies.game_number, lobbies.lobby_number
  loop
    select jsonb_agg(jsonb_build_object('participantId', randomized.participant_id::text, 'placement', randomized.placement) order by randomized.participant_id)
    into v_results
    from (select participant_id, row_number() over (order by random())::integer as placement from public.lobby_participants where lobby_id = v_lobby.id) randomized;
    perform public.update_lobby_results(p_tournament_id, v_lobby.id::text, v_results);
    v_lobbies := v_lobbies + 1;
    v_participants := v_participants + jsonb_array_length(v_results);
  end loop;
  if v_lobbies = 0 then raise exception 'There are no pending lobbies for the active node.'; end if;
  return query select v_lobbies, v_participants;
end;
$$;

notify pgrst, 'reload schema';
