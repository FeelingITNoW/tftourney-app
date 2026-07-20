-- Compact graph format v3. Existing snapshots are converted before the
-- schema constraint is added; the physical rounds table remains the runtime
-- node/lobby table, but format_config no longer stores a duplicate rounds list.

create or replace function public.compact_tournament_format_v3(p_config jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_config jsonb := replace(
    replace(p_config::text, 'current_round_firsts', 'current_node_firsts'),
    'round_entry_seed', 'node_entry_seed'
  )::jsonb;
  v_source_nodes jsonb;
  v_source_edges jsonb;
  v_nodes jsonb := '[]'::jsonb;
  v_edges jsonb := '[]'::jsonb;
  v_defaults jsonb;
  v_first_node jsonb;
  v_node jsonb;
  v_compact jsonb;
  v_edge jsonb;
  v_condition jsonb;
  v_index integer;
  v_minimum integer;
  v_exact integer;
  v_has_checkmate boolean;
  v_first_checkmate boolean;
  v_key text;
begin
  if v_config ->> 'schemaVersion' = '3'
    and jsonb_typeof(v_config -> 'nodeDefaults') = 'object'
    and jsonb_typeof(v_config -> 'nodes') = 'array'
    and jsonb_typeof(v_config -> 'edges') = 'array' then
    return v_config - 'rounds'::text;
  end if;

  if jsonb_typeof(v_config -> 'nodes') = 'array' then
    v_source_nodes := v_config -> 'nodes';
  else
    select coalesce(jsonb_agg(
      (round.value - 'type'::text - 'participants'::text - 'advancement'::text)
        || jsonb_build_object(
          'mergeSeeding', coalesce(round.value -> 'mergeSeeding', '"random"'::jsonb)
        )
        || case when round.ordinality = 1 then jsonb_build_object('initialEntrantSlots', 'all') else '{}'::jsonb end
      order by round.ordinality
    ), '[]'::jsonb)
    into v_source_nodes
    from jsonb_array_elements(coalesce(v_config -> 'rounds', '[]'::jsonb)) with ordinality round(value, ordinality);
  end if;

  if jsonb_typeof(v_config -> 'edges') = 'array' then
    v_source_edges := v_config -> 'edges';
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', round.value ->> 'id' || '-advancement',
      'sourceNodeId', round.value ->> 'id',
      'destinationNodeId', round.value -> 'advancement' ->> 'destinationRoundId',
      'priority', 1,
      'condition', jsonb_build_object(
        'type', 'top_n',
        'count', (round.value -> 'advancement' ->> 'count')::integer
      )
    )), '[]'::jsonb)
    into v_source_edges
    from jsonb_array_elements(coalesce(v_config -> 'rounds', '[]'::jsonb)) round(value)
    where jsonb_typeof(round.value -> 'advancement') = 'object'
      and round.value -> 'advancement' ->> 'destinationRoundId' is not null;
  end if;

  v_first_node := v_source_nodes -> 0;
  v_defaults := jsonb_build_object(
    'mergeSeeding', coalesce(v_first_node -> 'mergeSeeding', '"random"'::jsonb),
    'lobbySeeding', coalesce(v_first_node -> 'lobbySeeding', '"snake"'::jsonb),
    'reseed', coalesce(v_first_node -> 'reseed', '0'::jsonb),
    'standings', coalesce(v_first_node -> 'standings', jsonb_build_object(
      'rankingMetric', 'points', 'sortDirection', 'desc', 'tieBreakers', '[]'::jsonb
    )),
    'reseedStandings', coalesce(v_first_node -> 'reseedStandings', jsonb_build_object(
      'rankingMetric', 'tournament_points', 'sortDirection', 'desc', 'tieBreakers', '[]'::jsonb
    ))
  );
  if v_first_node ? 'games' then
    v_defaults := v_defaults || jsonb_build_object('games', v_first_node -> 'games');
  end if;

  for v_node, v_index in
    select value, ordinality from jsonb_array_elements(v_source_nodes) with ordinality
  loop
    v_compact := v_node - 'type'::text - 'participants'::text - 'advancement'::text;
    if v_index = 1 and not (v_compact ? 'initialEntrantSlots') then
      v_compact := v_compact || jsonb_build_object('initialEntrantSlots', 'all');
    end if;
    foreach v_key in array ARRAY['mergeSeeding', 'lobbySeeding', 'games', 'reseed', 'standings', 'reseedStandings']
    loop
      if v_compact ? v_key and v_defaults ? v_key and v_compact -> v_key = v_defaults -> v_key then
        v_compact := v_compact - v_key;
      end if;
    end loop;
    if v_compact -> 'winCondition' ->> 'type' = 'checkmate' then
      v_compact := v_compact - 'games'::text;
    end if;
    if jsonb_typeof(v_compact -> 'winCondition') = 'object' then
      v_compact := jsonb_set(v_compact, '{winCondition}', (v_compact -> 'winCondition'::text) - 'rankingMetric'::text);
    end if;
    v_nodes := v_nodes || jsonb_build_array(v_compact);
  end loop;

  for v_edge in select value from jsonb_array_elements(v_source_edges)
  loop
    v_condition := coalesce(v_edge -> 'condition', jsonb_build_object('type', 'top_n')) - 'rankingMetric'::text;
    v_edges := v_edges || jsonb_build_array(
      (v_edge - 'condition'::text) || jsonb_build_object('condition', v_condition)
    );
  end loop;

  select bool_or(node.value -> 'winCondition' ->> 'type' = 'checkmate')
  into v_has_checkmate
  from jsonb_array_elements(v_source_nodes) node(value);
  v_first_checkmate := v_source_nodes -> 0 -> 'winCondition' ->> 'type' = 'checkmate';
  v_minimum := coalesce((v_config -> 'startRequirement' ->> 'minimumEntrants')::integer, case when v_has_checkmate then 8 else 1 end);
  v_exact := case
    when (v_config -> 'startRequirement' ->> 'exactEntrants') ~ '^\d+$' then (v_config -> 'startRequirement' ->> 'exactEntrants')::integer
    when v_first_checkmate then 8
    else null
  end;

  return jsonb_build_object(
    'schemaVersion', 3,
    'id', coalesce(v_config -> 'id', '"format"'::jsonb),
    'name', coalesce(v_config -> 'name', '"Tournament format"'::jsonb),
    'placementPoints', coalesce(v_config -> 'placementPoints', '{}'::jsonb),
    'startRequirement', jsonb_build_object('minimumEntrants', v_minimum)
      || case when v_exact is null then '{}'::jsonb else jsonb_build_object('exactEntrants', v_exact) end,
    'nodeDefaults', v_defaults,
    'nodes', v_nodes,
    'edges', v_edges
  ) || case when v_config ->> 'isDefault' = 'true' then jsonb_build_object('isDefault', true) else '{}'::jsonb end;
end;
$$;

update public.tournaments
set format_config = public.compact_tournament_format_v3(format_config)
where format_config is not null;

alter table public.tournaments
  drop constraint if exists tournaments_format_config_graph_v3_check;
alter table public.tournaments
  add constraint tournaments_format_config_graph_v3_check check (
    format_config ->> 'schemaVersion' = '3'
    and jsonb_typeof(format_config -> 'nodeDefaults') = 'object'
    and jsonb_typeof(format_config -> 'nodes') = 'array'
    and jsonb_array_length(format_config -> 'nodes') > 0
    and jsonb_typeof(format_config -> 'edges') = 'array'
    and not (format_config ? 'rounds')
  );

create or replace function public.graph_config_node(
  p_config jsonb,
  p_node_id text
)
returns jsonb
language sql
stable
as $$
  select case
    when coalesce(node.value -> 'winCondition' ->> 'type', '') = 'checkmate' then
      (coalesce(p_config -> 'nodeDefaults', '{}'::jsonb) || node.value) - 'games'::text
    else
      coalesce(p_config -> 'nodeDefaults', '{}'::jsonb) || node.value
    end
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
    coalesce(edge.value -> 'condition', '{}'::jsonb) || jsonb_build_object('rankingMetric', 'points')
  from jsonb_array_elements(coalesce(p_config -> 'edges', '[]'::jsonb)) edge(value);
$$;

-- The current graph lobby generator is retained in name, but now resolves a
-- compact node. Fixed-game and checkmate behavior share the same node config.
create or replace function public.generate_round_lobbies(p_round_id text)
returns table (generated_lobby_count integer, assigned_participant_count integer)
language plpgsql
as $$
declare
  v_round public.rounds%rowtype;
  v_config jsonb;
  v_lobby_seeding text;
  v_games integer;
  v_reseed integer;
  v_block_size integer;
  v_current_max_game integer;
  v_next_game integer;
  v_block_end_game integer;
  v_participant_count integer;
  v_lobby_count integer;
  v_block_game_count integer;
  v_is_checkmate boolean;
  v_threshold integer;
  v_max_games integer;
begin
  select rounds.* into v_round from public.rounds rounds where rounds.id::text = p_round_id for update;
  if not found then raise exception 'Round was not found.'; end if;
  if v_round.status = 'completed' then return query select 0, 0; return; end if;
  select public.graph_config_node(tournaments.format_config, v_round.format_round_id)
    into v_config from public.tournaments tournaments where tournaments.id = v_round.tournament_id;
  if v_config is null then raise exception 'Tournament format configuration for node % was not found.', v_round.format_round_id; end if;

  v_is_checkmate := v_config -> 'winCondition' ->> 'type' = 'checkmate';
  v_threshold := coalesce((v_config -> 'winCondition' ->> 'threshold')::integer, 0);
  v_max_games := case when (v_config -> 'winCondition' ->> 'maxGames') ~ '^\d+$' then (v_config -> 'winCondition' ->> 'maxGames')::integer else null end;
  v_games := case when (v_config ->> 'games') ~ '^\d+$' then (v_config ->> 'games')::integer when v_max_games is not null then v_max_games else 6 end;
  v_reseed := coalesce((v_config ->> 'reseed')::integer, 0);
  v_lobby_seeding := v_config ->> 'lobbySeeding';
  if v_lobby_seeding not in ('snake', 'random') then raise exception 'Lobby seeding must be snake or random.'; end if;
  if not v_is_checkmate and (v_games < 1 or v_games > 100) then raise exception 'Node games must be between 1 and 100.'; end if;
  if v_is_checkmate and v_reseed <> 0 then raise exception 'Checkmate nodes must use reseed zero.'; end if;
  if not v_is_checkmate and (v_reseed < 0 or v_reseed > v_games) then raise exception 'Node reseed must be between zero and games.'; end if;
  v_block_size := case when v_is_checkmate then 1 when v_reseed = 0 then v_games else v_reseed end;

  select coalesce(max(lobbies.game_number), 0) into v_current_max_game from public.lobbies lobbies where lobbies.round_id = v_round.id;
  if v_is_checkmate then
    if (select count(*) from public.participant_round_scores scores where scores.round_id = v_round.id) <> 8 then raise exception 'Checkmate nodes require exactly eight participants.'; end if;
    if public.checkmate_decisive_game(v_round.id::text, v_threshold) is not null or (v_max_games is not null and v_current_max_game >= v_max_games) then return query select 0, 0; return; end if;
    v_games := greatest(coalesce(v_max_games, v_current_max_game + 1), v_current_max_game + 1);
  end if;

  if v_current_max_game = 0 then
    v_next_game := 1;
  else
    v_next_game := floor((v_current_max_game - 1)::numeric / v_block_size)::integer * v_block_size + v_block_size + 1;
    v_block_end_game := least(floor((v_current_max_game - 1)::numeric / v_block_size)::integer * v_block_size + v_block_size, v_games);
    if exists (select 1 from generate_series(floor((v_current_max_game - 1)::numeric / v_block_size)::integer * v_block_size + 1, v_block_end_game) expected(game_number) where not exists (select 1 from public.lobbies l where l.round_id = v_round.id and l.game_number = expected.game_number)) then return query select 0, 0; return; end if;
    if exists (select 1 from public.lobbies l left join public.lobby_participants p on p.lobby_id = l.id where l.round_id = v_round.id and l.game_number between floor((v_current_max_game - 1)::numeric / v_block_size)::integer * v_block_size + 1 and v_block_end_game and (p.id is null or p.result_status not in ('confirmed', 'corrected'))) then return query select 0, 0; return; end if;
  end if;
  if v_next_game > v_games then return query select 0, 0; return; end if;
  v_block_end_game := least(floor((v_next_game - 1)::numeric / v_block_size)::integer * v_block_size + v_block_size, v_games);
  v_block_game_count := v_block_end_game - v_next_game + 1;
  select count(*)::integer into v_participant_count from public.participant_round_scores scores join public.tournament_participants participants on participants.id = scores.participant_id where scores.round_id = v_round.id and participants.tournament_id = v_round.tournament_id;
  if v_participant_count = 0 then raise exception 'Add node participants before generating lobbies.'; end if;
  v_lobby_count := ceil(v_participant_count::numeric / 8)::integer;

  insert into public.lobbies (round_id, game_number, lobby_number)
  select v_round.id, game_number, lobby_number from generate_series(v_next_game, v_block_end_game) game_numbers(game_number) cross join generate_series(1, v_lobby_count) lobby_numbers(lobby_number)
  on conflict (round_id, game_number, lobby_number) do nothing;

  with tournament_totals as (
    select scores.participant_id, sum(scores.score)::integer as tournament_points
    from public.participant_round_scores scores join public.rounds rounds on rounds.id = scores.round_id
    where rounds.tournament_id = v_round.tournament_id group by scores.participant_id
  ), round_firsts as (
    select p.participant_id, count(*)::integer as firsts from public.lobbies lobbies join public.lobby_participants p on p.lobby_id = lobbies.id
    where lobbies.round_id = v_round.id and p.placement = 1 and p.result_status in ('confirmed', 'corrected') group by p.participant_id
  ), ordered_participants as (
    select scores.participant_id, row_number() over (order by case when v_lobby_seeding = 'random' then random() end, coalesce(tournament_totals.tournament_points, 0) desc, coalesce(round_firsts.firsts, 0) desc, scores.round_seed_number asc, participants.display_name_at_start asc, participants.id::text asc) - 1 as position
    from public.participant_round_scores scores join public.tournament_participants participants on participants.id = scores.participant_id
    left join tournament_totals on tournament_totals.participant_id = scores.participant_id left join round_firsts on round_firsts.participant_id = scores.participant_id
    where scores.round_id = v_round.id and participants.tournament_id = v_round.tournament_id
  ), assigned_participants as (
    select ordered_participants.participant_id, game_numbers.game_number,
      case when v_lobby_seeding = 'snake' and ((ordered_participants.position / v_lobby_count) % 2) = 1 then v_lobby_count - (ordered_participants.position % v_lobby_count)::integer else (ordered_participants.position % v_lobby_count)::integer + 1 end as lobby_number,
      (ordered_participants.position / v_lobby_count)::integer + 1 as slot_number
    from ordered_participants cross join generate_series(v_next_game, v_block_end_game) game_numbers(game_number)
  )
  insert into public.lobby_participants (lobby_id, participant_id, slot_number)
  select lobbies.id, assigned_participants.participant_id, assigned_participants.slot_number
  from assigned_participants join public.lobbies lobbies on lobbies.round_id = v_round.id and lobbies.game_number = assigned_participants.game_number and lobbies.lobby_number = assigned_participants.lobby_number
  on conflict (lobby_id, participant_id) do nothing;
  return query select v_lobby_count * v_block_game_count, v_participant_count * v_block_game_count;
end;
$$;

create or replace function public.update_lobby_results(
  p_tournament_id text,
  p_lobby_id text,
  p_results jsonb
)
returns table (updated_lobby_id text, updated_participant_count integer)
language plpgsql
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_round public.rounds%rowtype;
  v_lobby public.lobbies%rowtype;
  v_node_config jsonb;
  v_placement_points jsonb;
  v_participant_count integer;
  v_result_count integer;
  v_is_checkmate boolean := false;
  v_checkmate_threshold integer := 0;
  v_decisive_game integer;
begin
  select tournaments.* into v_tournament
  from public.tournaments tournaments where tournaments.id::text = p_tournament_id for update;
  if not found then raise exception 'Tournament was not found.'; end if;

  select rounds.* into v_round
  from public.rounds rounds
  where rounds.id = (select lobbies.round_id from public.lobbies lobbies where lobbies.id::text = p_lobby_id)
    and rounds.tournament_id = v_tournament.id for update;
  if not found then raise exception 'Lobby was not found in this tournament.'; end if;
  if v_round.status = 'completed' or v_tournament.status = 'completed' then raise exception 'Results cannot be edited after the round is completed.'; end if;

  select lobbies.* into v_lobby
  from public.lobbies lobbies where lobbies.id::text = p_lobby_id and lobbies.round_id = v_round.id for update;
  if not found then raise exception 'Lobby was not found in this tournament.'; end if;

  select tournaments.format_config -> 'placementPoints' into v_placement_points
  from public.tournaments tournaments where tournaments.id = v_tournament.id;
  v_node_config := public.graph_config_node(v_tournament.format_config, v_round.format_round_id);
  v_is_checkmate := coalesce(v_node_config -> 'winCondition' ->> 'type', '') = 'checkmate';
  v_checkmate_threshold := case when (v_node_config -> 'winCondition' ->> 'threshold') ~ '^\d+$' then (v_node_config -> 'winCondition' ->> 'threshold')::integer else 0 end;

  if jsonb_typeof(v_placement_points) <> 'object' then raise exception 'Tournament format does not define placement points.'; end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' then raise exception 'Lobby results must be an array.'; end if;
  select count(*)::integer into v_participant_count from public.lobby_participants where lobby_id = v_lobby.id;
  select count(*)::integer into v_result_count from jsonb_array_elements(p_results);
  if v_participant_count = 0 or v_result_count <> v_participant_count then raise exception 'Submit one result for every lobby player.'; end if;
  if exists (select 1 from jsonb_array_elements(p_results) result(value) where jsonb_typeof(result.value) <> 'object' or coalesce(result.value ->> 'participantId', '') = '' or coalesce(result.value ->> 'placement', '') !~ '^\d+$') then raise exception 'Every result needs a valid player and placement.'; end if;
  if exists (select 1 from jsonb_array_elements(p_results) result(value) where (result.value ->> 'placement')::numeric < 1 or (result.value ->> 'placement')::numeric > v_participant_count) then raise exception 'Every result needs a valid placement.'; end if;
  if (select count(distinct result.value ->> 'participantId') from jsonb_array_elements(p_results) result(value)) <> v_result_count then raise exception 'Each lobby player must appear exactly once.'; end if;
  if (select count(distinct (result.value ->> 'placement')::integer) from jsonb_array_elements(p_results) result(value)) <> v_result_count then raise exception 'Each player must have a unique placement.'; end if;
  if exists (select 1 from jsonb_array_elements(p_results) result(value) where not exists (select 1 from public.lobby_participants lobby_participants where lobby_participants.lobby_id = v_lobby.id and lobby_participants.participant_id::text = result.value ->> 'participantId')) then raise exception 'A submitted player does not belong to this lobby.'; end if;
  if exists (select 1 from jsonb_array_elements(p_results) result(value) where coalesce(v_placement_points ->> (result.value ->> 'placement'), '') !~ '^\d+$') then raise exception 'Tournament format has an invalid placement point value.'; end if;

  with parsed_results as (
    select result.value ->> 'participantId' as participant_id,
      (result.value ->> 'placement')::integer as placement,
      (v_placement_points ->> (result.value ->> 'placement'))::integer as points
    from jsonb_array_elements(p_results) result(value)
  )
  update public.lobby_participants lobby_participants
  set placement = parsed_results.placement,
      points = parsed_results.points,
      result_status = case when lobby_participants.result_status = 'pending' then 'confirmed' else 'corrected' end,
      updated_at = now()
  from parsed_results
  where lobby_participants.lobby_id = v_lobby.id and lobby_participants.participant_id::text = parsed_results.participant_id;

  if v_is_checkmate then v_decisive_game := public.checkmate_decisive_game(v_round.id::text, v_checkmate_threshold); end if;
  update public.participant_round_scores scores
  set score = coalesce((
    select sum(lobby_participants.points)
    from public.lobbies lobbies join public.lobby_participants lobby_participants on lobby_participants.lobby_id = lobbies.id
    where lobbies.round_id = scores.round_id and lobby_participants.participant_id = scores.participant_id and lobby_participants.result_status in ('confirmed', 'corrected')
      and (not v_is_checkmate or v_decisive_game is null or lobbies.game_number <= v_decisive_game)
  ), 0), updated_at = now()
  where scores.round_id = v_round.id;
  update public.lobbies set updated_at = now() where id = v_lobby.id;
  perform public.generate_round_lobbies(v_round.id::text);
  return query select v_lobby.id::text, v_participant_count;
end;
$$;

create or replace function public.prevent_late_lobby_result_edits()
returns trigger
language plpgsql
as $$
declare
  v_round_id public.rounds.id%type;
  v_game_number integer;
  v_format_round_id text;
  v_format_config jsonb;
  v_node_config jsonb;
  v_block_size integer;
  v_block_end_game integer;
begin
  if old.placement is not distinct from new.placement and old.points is not distinct from new.points and old.result_status is not distinct from new.result_status then return new; end if;
  select lobbies.round_id, lobbies.game_number, rounds.format_round_id, tournaments.format_config
    into v_round_id, v_game_number, v_format_round_id, v_format_config
    from public.lobbies lobbies join public.rounds rounds on rounds.id = lobbies.round_id join public.tournaments tournaments on tournaments.id = rounds.tournament_id where lobbies.id = new.lobby_id;
  if v_round_id is null then return new; end if;
  v_node_config := public.graph_config_node(v_format_config, v_format_round_id);
  if coalesce(v_node_config -> 'winCondition' ->> 'type', '') = 'checkmate' then v_block_size := 1;
  elsif (v_node_config ->> 'reseed') ~ '^\d+$' and (v_node_config ->> 'reseed')::integer > 0 then v_block_size := (v_node_config ->> 'reseed')::integer;
  elsif (v_node_config ->> 'games') ~ '^\d+$' and (v_node_config ->> 'games')::integer > 0 then v_block_size := (v_node_config ->> 'games')::integer;
  else v_block_size := 1; end if;
  v_block_end_game := ((v_game_number - 1) / v_block_size + 1) * v_block_size;
  if exists (select 1 from public.lobbies later_lobbies where later_lobbies.round_id = v_round_id and later_lobbies.game_number > v_block_end_game) then raise exception 'Results for game % cannot be edited after a later reseeded game has been generated.', v_game_number; end if;
  return new;
end;
$$;

drop function if exists public.randomize_pending_lobby_results(text);
drop function if exists public.generate_fixed_round_lobbies(text);
drop function if exists public.progress_tournament_round(text);
drop function if exists public.progress_fixed_tournament_round(text);

notify pgrst, 'reload schema';
