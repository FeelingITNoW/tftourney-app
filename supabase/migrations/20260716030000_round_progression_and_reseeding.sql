-- Round progression, game blocks, and round-local seeding.

alter table public.lobbies
  add column if not exists game_number integer;

update public.lobbies
set game_number = 1
where game_number is null;

alter table public.lobbies
  alter column game_number set default 1,
  alter column game_number set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lobbies_game_number_check'
      and conrelid = 'public.lobbies'::regclass
  ) then
    alter table public.lobbies
      add constraint lobbies_game_number_check check (game_number > 0);
  end if;
end $$;

drop index if exists public.lobbies_unique_round_number_idx;
create unique index if not exists lobbies_unique_round_game_number_idx
  on public.lobbies(round_id, game_number, lobby_number);

alter table public.participant_round_scores
  add column if not exists round_seed_number integer;

update public.participant_round_scores scores
set round_seed_number = participants.seed_number
from public.tournament_participants participants
where participants.id = scores.participant_id
  and scores.round_seed_number is null;

alter table public.participant_round_scores
  alter column round_seed_number set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'participant_round_scores_round_seed_check'
      and conrelid = 'public.participant_round_scores'::regclass
  ) then
    alter table public.participant_round_scores
      add constraint participant_round_scores_round_seed_check
      check (round_seed_number > 0);
  end if;
end $$;

create unique index if not exists participant_round_scores_unique_round_seed_idx
  on public.participant_round_scores(round_id, round_seed_number);

-- Preserve custom-format behavior when reseed was not configured. The built-in
-- format is deliberately upgraded to six games and two-game reseed blocks.
do $$
declare
  tournament_record record;
  configured_round record;
  updated_rounds jsonb;
  updated_round jsonb;
  tie_breakers constant jsonb := jsonb_build_array(
    jsonb_build_object(
      'rankingMetric', 'current_round_firsts',
      'sortDirection', 'desc'
    ),
    jsonb_build_object(
      'rankingMetric', 'round_entry_seed',
      'sortDirection', 'asc'
    )
  );
  round_games integer;
  round_reseed integer;
  standings jsonb;
  reseed_standings jsonb;
begin
  for tournament_record in
    select t.id, t.format_id, t.format_config
    from public.tournaments t
    where jsonb_typeof(t.format_config -> 'rounds') = 'array'
  loop
    updated_rounds := '[]'::jsonb;

    for configured_round in
      select value
      from jsonb_array_elements(tournament_record.format_config -> 'rounds')
    loop
      round_games := case
        when tournament_record.format_id = 'default' then 6
        when configured_round.value ->> 'games' ~ '^\d+$'
          then (configured_round.value ->> 'games')::integer
        else 6
      end;
      round_reseed := case
        when tournament_record.format_id = 'default' then 2
        when configured_round.value ->> 'reseed' ~ '^\d+$'
          then (configured_round.value ->> 'reseed')::integer
        else 0
      end;

      standings := coalesce(configured_round.value -> 'standings', '{}'::jsonb)
        || jsonb_build_object('tieBreakers', tie_breakers);
      reseed_standings := coalesce(
        configured_round.value -> 'reseedStandings',
        jsonb_build_object(
          'rankingMetric', 'tournament_points',
          'sortDirection', 'desc'
        )
      ) || jsonb_build_object('tieBreakers', tie_breakers);

      updated_round := configured_round.value
        || jsonb_build_object(
          'games', round_games,
          'reseed', round_reseed,
          'standings', standings,
          'reseedStandings', reseed_standings
        );
      updated_rounds := updated_rounds || jsonb_build_array(updated_round);
    end loop;

    update public.tournaments
    set format_config = jsonb_set(
      tournament_record.format_config,
      '{rounds}',
      updated_rounds,
      true
    )
    where id = tournament_record.id;
  end loop;
end $$;

create or replace function public.generate_round_lobbies(p_round_id text)
returns table (
  generated_lobby_count integer,
  assigned_participant_count integer
)
language plpgsql
as $$
declare
  v_round public.rounds%rowtype;
  v_round_config jsonb;
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
begin
  select r.*
  into v_round
  from public.rounds r
  where r.id::text = p_round_id
  for update;

  if not found then
    raise exception 'Round was not found.';
  end if;

  if v_round.status = 'completed' then
    return query select 0, 0;
    return;
  end if;

  select configured_round.value
  into v_round_config
  from public.tournaments t
  cross join lateral jsonb_array_elements(t.format_config -> 'rounds')
    as configured_round(value)
  where t.id = v_round.tournament_id
    and configured_round.value ->> 'id' = v_round.format_round_id
  limit 1;

  if v_round_config is null then
    raise exception 'Tournament format configuration for round % was not found.',
      coalesce(v_round.format_round_id, v_round.round_number::text);
  end if;

  v_games := case
    when v_round_config ->> 'games' ~ '^\d+$'
      then (v_round_config ->> 'games')::integer
    else 6
  end;
  v_reseed := case
    when v_round_config ->> 'reseed' ~ '^\d+$'
      then (v_round_config ->> 'reseed')::integer
    else 0
  end;
  v_lobby_seeding := v_round_config ->> 'lobbySeeding';

  if v_games <= 0 then
    raise exception 'Round games must be positive.';
  end if;

  if v_reseed < 0 or v_reseed > v_games then
    raise exception 'Round reseed must be between zero and games.';
  end if;

  if v_lobby_seeding is null
    or v_lobby_seeding not in ('snake', 'random') then
    raise exception 'Lobby seeding must be snake or random.';
  end if;

  v_block_size := case when v_reseed = 0 then v_games else v_reseed end;

  select coalesce(max(lobbies.game_number), 0)
  into v_current_max_game
  from public.lobbies lobbies
  where lobbies.round_id = v_round.id;

  if v_current_max_game = 0 then
    v_next_game := 1;
  else
    v_next_game :=
      floor((v_current_max_game - 1)::numeric / v_block_size)::integer
        * v_block_size + v_block_size + 1;
    v_block_end_game := least(
      floor((v_current_max_game - 1)::numeric / v_block_size)::integer
        * v_block_size + v_block_size,
      v_games
    );

    if exists (
      select 1
      from generate_series(
        floor((v_current_max_game - 1)::numeric / v_block_size)::integer
          * v_block_size + 1,
        v_block_end_game
      ) as expected_game(game_number)
      where not exists (
        select 1
        from public.lobbies lobbies
        where lobbies.round_id = v_round.id
          and lobbies.game_number = expected_game.game_number
      )
    ) then
      return query select 0, 0;
      return;
    end if;

    if exists (
      select 1
      from public.lobbies lobbies
      left join public.lobby_participants lobby_participants
        on lobby_participants.lobby_id = lobbies.id
      where lobbies.round_id = v_round.id
        and lobbies.game_number between
          floor((v_current_max_game - 1)::numeric / v_block_size)::integer
            * v_block_size + 1
          and v_block_end_game
        and (
          lobby_participants.id is null
          or lobby_participants.result_status not in ('confirmed', 'corrected')
        )
    ) then
      return query select 0, 0;
      return;
    end if;
  end if;

  if v_next_game > v_games then
    return query select 0, 0;
    return;
  end if;

  v_block_end_game := least(
    floor((v_next_game - 1)::numeric / v_block_size)::integer
      * v_block_size + v_block_size,
    v_games
  );
  v_block_game_count := v_block_end_game - v_next_game + 1;

  select count(*)::integer
  into v_participant_count
  from public.participant_round_scores scores
  join public.tournament_participants participants
    on participants.id = scores.participant_id
  where scores.round_id = v_round.id
    and participants.tournament_id = v_round.tournament_id;

  if v_participant_count = 0 then
    raise exception 'Add round participants before generating lobbies.';
  end if;

  v_lobby_count := ceil(v_participant_count::numeric / 8)::integer;

  insert into public.lobbies (round_id, game_number, lobby_number)
  select v_round.id, game_number, lobby_number
  from generate_series(v_next_game, v_block_end_game) as game_numbers(game_number)
  cross join generate_series(1, v_lobby_count) as lobby_numbers(lobby_number)
  on conflict (round_id, game_number, lobby_number) do nothing;

  with tournament_totals as (
    select scores.participant_id, sum(scores.score)::integer as tournament_points
    from public.participant_round_scores scores
    join public.rounds rounds on rounds.id = scores.round_id
    where rounds.tournament_id = v_round.tournament_id
    group by scores.participant_id
  ),
  round_firsts as (
    select lobby_participants.participant_id, count(*)::integer as firsts
    from public.lobbies lobbies
    join public.lobby_participants lobby_participants
      on lobby_participants.lobby_id = lobbies.id
    where lobbies.round_id = v_round.id
      and lobby_participants.placement = 1
      and lobby_participants.result_status in ('confirmed', 'corrected')
    group by lobby_participants.participant_id
  ),
  ordered_participants as (
    select
      scores.participant_id,
      row_number() over (
        order by
          case when v_lobby_seeding = 'random' then random() end,
          coalesce(tournament_totals.tournament_points, 0) desc,
          coalesce(round_firsts.firsts, 0) desc,
          scores.round_seed_number asc,
          participants.display_name_at_start asc,
          participants.id::text asc
      ) - 1 as position
    from public.participant_round_scores scores
    join public.tournament_participants participants
      on participants.id = scores.participant_id
    left join tournament_totals
      on tournament_totals.participant_id = scores.participant_id
    left join round_firsts
      on round_firsts.participant_id = scores.participant_id
    where scores.round_id = v_round.id
      and participants.tournament_id = v_round.tournament_id
  ),
  assigned_participants as (
    select
      ordered_participants.participant_id,
      game_numbers.game_number,
      case
        when v_lobby_seeding = 'snake'
          and ((ordered_participants.position / v_lobby_count) % 2) = 1
          then v_lobby_count
            - (ordered_participants.position % v_lobby_count)::integer
        else (ordered_participants.position % v_lobby_count)::integer + 1
      end as lobby_number,
      (ordered_participants.position / v_lobby_count)::integer + 1
        as slot_number
    from ordered_participants
    cross join generate_series(v_next_game, v_block_end_game)
      as game_numbers(game_number)
  )
  insert into public.lobby_participants (
    lobby_id,
    participant_id,
    slot_number
  )
  select
    lobbies.id,
    assigned_participants.participant_id,
    assigned_participants.slot_number
  from assigned_participants
  join public.lobbies lobbies
    on lobbies.round_id = v_round.id
    and lobbies.game_number = assigned_participants.game_number
    and lobbies.lobby_number = assigned_participants.lobby_number
  on conflict (lobby_id, participant_id) do nothing;

  return query
  select
    v_lobby_count * v_block_game_count,
    v_participant_count * v_block_game_count;
end;
$$;

drop function if exists public.start_tournament(uuid);
drop function if exists public.start_tournament(bigint);
drop function if exists public.start_tournament(text);

create function public.start_tournament(p_tournament_id text)
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
  v_round_id public.rounds.id%type;
  v_round_key text;
  v_entrant_count integer;
begin
  select *
  into v_tournament
  from public.tournaments
  where id::text = p_tournament_id
  for update;

  if not found then
    raise exception 'Tournament was not found.';
  end if;

  if v_tournament.status <> 'accepting_players' then
    raise exception 'Tournament has already started.';
  end if;

  select count(*)::integer
  into v_entrant_count
  from public.tournament_registrations registrations
  where registrations.tournament_id = v_tournament.id
    and registrations.registration_status = 'registered';

  if v_entrant_count = 0 then
    raise exception 'Register at least one player before starting the tournament.';
  end if;

  v_round_key := coalesce(
    v_tournament.format_config #>> '{rounds,0,id}',
    'opening-round'
  );

  insert into public.rounds (
    tournament_id,
    round_number,
    format_round_id,
    status
  )
  values (v_tournament.id, 1, v_round_key, 'active')
  on conflict (tournament_id, round_number) do update
    set format_round_id = excluded.format_round_id,
        status = 'active'
  returning id into v_round_id;

  with selected_registrations as (
    select
      registrations.id,
      registrations.display_name,
      row_number() over (
        order by registrations.created_at asc, registrations.id asc
      )::integer as seed_number
    from public.tournament_registrations registrations
    where registrations.tournament_id = v_tournament.id
      and registrations.registration_status = 'registered'
    order by registrations.created_at asc, registrations.id asc
    limit v_tournament.max_players
  )
  insert into public.tournament_participants (
    tournament_id,
    registration_id,
    seed_number,
    display_name_at_start
  )
  select
    v_tournament.id,
    selected_registrations.id,
    selected_registrations.seed_number,
    selected_registrations.display_name
  from selected_registrations
  on conflict (tournament_id, registration_id) do nothing;

  update public.tournament_registrations registrations
  set registration_status = case
    when exists (
      select 1
      from public.tournament_participants participants
      where participants.registration_id = registrations.id
        and participants.tournament_id = v_tournament.id
    ) then 'entered'
    else 'waitlisted'
  end
  where registrations.tournament_id = v_tournament.id
    and registrations.registration_status = 'registered';

  insert into public.participant_round_scores (
    participant_id,
    round_id,
    round_seed_number,
    score
  )
  select participants.id, v_round_id, participants.seed_number, 0
  from public.tournament_participants participants
  where participants.tournament_id = v_tournament.id
  on conflict (participant_id, round_id) do nothing;

  perform public.generate_round_lobbies(v_round_id::text);

  update public.tournaments
  set status = 'in_progress',
      started_at = coalesce(started_at, now()),
      current_round_id = v_round_id
  where id = v_tournament.id;

  select count(*)::integer
  into v_entrant_count
  from public.tournament_participants participants
  where participants.tournament_id = v_tournament.id;

  return query
  select v_tournament.id::text, v_entrant_count, v_round_id::text, 1;
end;
$$;

drop function if exists public.update_lobby_results(text, text, jsonb);

create function public.update_lobby_results(
  p_tournament_id text,
  p_lobby_id text,
  p_results jsonb
)
returns table (
  updated_lobby_id text,
  updated_participant_count integer
)
language plpgsql
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_round public.rounds%rowtype;
  v_lobby public.lobbies%rowtype;
  v_placement_points jsonb;
  v_participant_count integer;
  v_result_count integer;
begin
  select tournaments.*
  into v_tournament
  from public.tournaments tournaments
  where tournaments.id::text = p_tournament_id
  for update;

  if not found then
    raise exception 'Tournament was not found.';
  end if;

  select rounds.*
  into v_round
  from public.rounds rounds
  where rounds.id = (
    select lobbies.round_id
    from public.lobbies lobbies
    where lobbies.id::text = p_lobby_id
  )
    and rounds.tournament_id = v_tournament.id
  for update;

  if not found then
    raise exception 'Lobby was not found in this tournament.';
  end if;

  if v_round.status = 'completed' or v_tournament.status = 'completed' then
    raise exception 'Results cannot be edited after the round is completed.';
  end if;

  select lobbies.*
  into v_lobby
  from public.lobbies lobbies
  where lobbies.id::text = p_lobby_id
    and lobbies.round_id = v_round.id
  for update;

  if not found then
    raise exception 'Lobby was not found in this tournament.';
  end if;

  select tournaments.format_config -> 'placementPoints'
  into v_placement_points
  from public.tournaments tournaments
  where tournaments.id = v_tournament.id;

  if jsonb_typeof(v_placement_points) <> 'object' then
    raise exception 'Tournament format does not define placement points.';
  end if;

  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'Lobby results must be an array.';
  end if;

  select count(*)::integer
  into v_participant_count
  from public.lobby_participants lobby_participants
  where lobby_participants.lobby_id = v_lobby.id;

  select count(*)::integer
  into v_result_count
  from jsonb_array_elements(p_results);

  if v_participant_count = 0 or v_result_count <> v_participant_count then
    raise exception 'Submit one result for every lobby player.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_results) result(value)
    where jsonb_typeof(result.value) <> 'object'
      or coalesce(result.value ->> 'participantId', '') = ''
      or coalesce(result.value ->> 'placement', '') !~ '^\d+$'
  ) then
    raise exception 'Every result needs a valid player and placement.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_results) result(value)
    where (result.value ->> 'placement')::numeric < 1
      or (result.value ->> 'placement')::numeric > v_participant_count
  ) then
    raise exception 'Every result needs a valid player and placement.';
  end if;

  if (
    select count(distinct result.value ->> 'participantId')
    from jsonb_array_elements(p_results) result(value)
  ) <> v_result_count then
    raise exception 'Each lobby player must appear exactly once.';
  end if;

  if (
    select count(distinct (result.value ->> 'placement')::integer)
    from jsonb_array_elements(p_results) result(value)
  ) <> v_result_count then
    raise exception 'Each player must have a unique placement.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_results) result(value)
    where not exists (
      select 1
      from public.lobby_participants lobby_participants
      where lobby_participants.lobby_id = v_lobby.id
        and lobby_participants.participant_id::text =
          result.value ->> 'participantId'
    )
  ) then
    raise exception 'A submitted player does not belong to this lobby.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_results) result(value)
    where coalesce(
      v_placement_points ->> (result.value ->> 'placement'),
      ''
    ) !~ '^\d+$'
  ) then
    raise exception 'Tournament format has an invalid placement point value.';
  end if;

  with parsed_results as (
    select
      result.value ->> 'participantId' as participant_id,
      (result.value ->> 'placement')::integer as placement,
      (
        v_placement_points ->> (result.value ->> 'placement')
      )::integer as points
    from jsonb_array_elements(p_results) result(value)
  )
  update public.lobby_participants lobby_participants
  set placement = parsed_results.placement,
      points = parsed_results.points,
      result_status = case
        when lobby_participants.result_status = 'pending' then 'confirmed'
        else 'corrected'
      end,
      updated_at = now()
  from parsed_results
  where lobby_participants.lobby_id = v_lobby.id
    and lobby_participants.participant_id::text = parsed_results.participant_id;

  update public.participant_round_scores scores
  set score = coalesce((
        select sum(lobby_participants.points)
        from public.lobbies lobbies
        join public.lobby_participants lobby_participants
          on lobby_participants.lobby_id = lobbies.id
        where lobbies.round_id = scores.round_id
          and lobby_participants.participant_id = scores.participant_id
          and lobby_participants.result_status in ('confirmed', 'corrected')
      ), 0),
      updated_at = now()
  where scores.round_id = v_round.id;

  update public.lobbies
  set updated_at = now()
  where id = v_lobby.id;

  -- The round lock makes this idempotent and prevents concurrent block writes.
  perform public.generate_round_lobbies(v_round.id::text);

  return query
  select v_lobby.id::text, v_participant_count;
end;
$$;

drop function if exists public.progress_tournament_round(text);

create function public.progress_tournament_round(p_tournament_id text)
returns table (
  transition_type text,
  completed_round_id text,
  new_round_id text,
  advanced_player_count integer
)
language plpgsql
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_round public.rounds%rowtype;
  v_round_config jsonb;
  v_destination_config jsonb;
  v_destination_round_id text;
  v_new_round_id public.rounds.id%type;
  v_games integer;
  v_advance_count integer;
  v_available_count integer;
begin
  select *
  into v_tournament
  from public.tournaments tournaments
  where tournaments.id::text = p_tournament_id
  for update;

  if not found then
    raise exception 'Tournament was not found.';
  end if;

  if v_tournament.status = 'completed' then
    return query
    select
      'tournament_completed',
      v_tournament.current_round_id::text,
      null::text,
      0;
    return;
  end if;

  if v_tournament.status <> 'in_progress' or v_tournament.current_round_id is null then
    raise exception 'Tournament is not in progress.';
  end if;

  select rounds.*
  into v_round
  from public.rounds rounds
  where rounds.id = v_tournament.current_round_id
    and rounds.tournament_id = v_tournament.id
  for update;

  if not found then
    raise exception 'The active tournament round was not found.';
  end if;

  if v_round.status <> 'active' then
    raise exception 'The active tournament round is not available for progression.';
  end if;

  select configured_round.value
  into v_round_config
  from jsonb_array_elements(v_tournament.format_config -> 'rounds')
    as configured_round(value)
  where configured_round.value ->> 'id' = v_round.format_round_id
  limit 1;

  if v_round_config is null then
    raise exception 'Tournament format configuration for the active round was not found.';
  end if;

  v_games := case
    when v_round_config ->> 'games' ~ '^\d+$'
      then (v_round_config ->> 'games')::integer
    else 6
  end;

  if exists (
    select 1
    from generate_series(1, v_games) as expected_game(game_number)
    where not exists (
      select 1
      from public.lobbies lobbies
      where lobbies.round_id = v_round.id
        and lobbies.game_number = expected_game.game_number
    )
  ) then
    raise exception 'Complete every configured game before progressing the tournament.';
  end if;

  if exists (
    select 1
    from public.lobbies lobbies
    left join public.lobby_participants lobby_participants
      on lobby_participants.lobby_id = lobbies.id
    where lobbies.round_id = v_round.id
      and (
        lobby_participants.id is null
        or lobby_participants.result_status not in ('confirmed', 'corrected')
      )
  ) then
    raise exception 'Complete every lobby result before progressing the tournament.';
  end if;

  select count(*)::integer
  into v_available_count
  from public.participant_round_scores scores
  where scores.round_id = v_round.id;

  if v_available_count = 0 then
    raise exception 'The active round has no participants.';
  end if;

  v_destination_round_id := v_round_config -> 'advancement' ->> 'destinationRoundId';

  if v_destination_round_id is null or v_destination_round_id = '' then
    update public.rounds
    set status = 'completed', updated_at = now()
    where id = v_round.id;

    update public.tournaments
    set status = 'completed', updated_at = now()
    where id = v_tournament.id;

    return query
    select 'tournament_completed', v_round.id::text, null::text, 0;
    return;
  end if;

  select configured_round.value
  into v_destination_config
  from jsonb_array_elements(v_tournament.format_config -> 'rounds')
    as configured_round(value)
  where configured_round.value ->> 'id' = v_destination_round_id
  limit 1;

  if v_destination_config is null then
    raise exception 'Advancement destination round % was not found.',
      v_destination_round_id;
  end if;

  v_advance_count := case
    when v_round_config -> 'advancement' ->> 'count' ~ '^\d+$'
      then least(
        (v_round_config -> 'advancement' ->> 'count')::integer,
        v_available_count
      )
    else 0
  end;

  if v_advance_count <= 0 then
    raise exception 'Advancement count must be positive.';
  end if;

  select rounds.id
  into v_new_round_id
  from public.rounds rounds
  where rounds.tournament_id = v_tournament.id
    and rounds.format_round_id = v_destination_round_id
  for update;

  if v_new_round_id is null then
    insert into public.rounds (
      tournament_id,
      round_number,
      format_round_id,
      status
    )
    values (
      v_tournament.id,
      v_round.round_number + 1,
      v_destination_round_id,
      'active'
    )
    on conflict (tournament_id, round_number) do nothing;

    select rounds.id
    into v_new_round_id
    from public.rounds rounds
    where rounds.tournament_id = v_tournament.id
      and rounds.format_round_id = v_destination_round_id
    for update;
  end if;

  insert into public.participant_round_scores (
    participant_id,
    round_id,
    round_seed_number,
    score
  )
  with ranked_participants as (
    select
      scores.participant_id,
      row_number() over (
        order by
          scores.score desc,
          count(*) filter (
            where lobby_participants.placement = 1
              and lobby_participants.result_status in ('confirmed', 'corrected')
          ) desc,
          scores.round_seed_number asc,
          participants.display_name_at_start asc,
          participants.id::text asc
      )::integer as next_seed
    from public.participant_round_scores scores
    join public.tournament_participants participants
      on participants.id = scores.participant_id
    left join public.lobbies lobbies
      on lobbies.round_id = scores.round_id
    left join public.lobby_participants lobby_participants
      on lobby_participants.lobby_id = lobbies.id
        and lobby_participants.participant_id = scores.participant_id
    where scores.round_id = v_round.id
    group by
      scores.participant_id,
      scores.score,
      scores.round_seed_number,
      participants.display_name_at_start,
      participants.id
  )
  select
    ranked_participants.participant_id,
    v_new_round_id,
    ranked_participants.next_seed,
    0
  from ranked_participants
  where ranked_participants.next_seed <= v_advance_count
  on conflict (participant_id, round_id) do update
    set round_seed_number = excluded.round_seed_number,
        score = 0,
        updated_at = now();

  update public.rounds
  set status = 'completed', updated_at = now()
  where id = v_round.id;

  perform public.generate_round_lobbies(v_new_round_id::text);

  update public.tournaments
  set current_round_id = v_new_round_id,
      updated_at = now()
  where id = v_tournament.id;

  return query
  select
    'round_created',
    v_round.id::text,
    v_new_round_id::text,
    v_advance_count;
end;
$$;

notify pgrst, 'reload schema';
