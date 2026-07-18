-- Apply checkmate behavior to databases where the earlier round RPC migration
-- has already been applied. The fixed-game implementations are retained under
-- private names and the public RPCs dispatch by winCondition.type.

drop function if exists public.checkmate_decisive_game(bigint, integer);

create or replace function public.checkmate_decisive_game(
  p_round_id text,
  p_threshold integer
)
returns integer
language sql
stable
as $$
  select min(lobbies.game_number)::integer
  from public.lobbies lobbies
  join public.lobby_participants winners
    on winners.lobby_id = lobbies.id
   and winners.placement = 1
   and winners.result_status in ('confirmed', 'corrected')
  where lobbies.round_id::text = p_round_id
    and coalesce((
      select sum(previous_participants.points)::integer
      from public.lobbies previous_lobbies
      join public.lobby_participants previous_participants
        on previous_participants.lobby_id = previous_lobbies.id
       and previous_participants.participant_id = winners.participant_id
       and previous_participants.result_status in ('confirmed', 'corrected')
      where previous_lobbies.round_id::text = p_round_id
        and previous_lobbies.game_number < lobbies.game_number
    ), 0) > p_threshold;
$$;

alter function public.generate_round_lobbies(text)
  rename to generate_fixed_round_lobbies;

create function public.generate_round_lobbies(p_round_id text)
returns table (
  generated_lobby_count integer,
  assigned_participant_count integer
)
language plpgsql
as $$
declare
  v_round public.rounds%rowtype;
  v_config jsonb;
  v_is_checkmate boolean;
  v_threshold integer;
  v_max_games integer;
  v_current_game integer;
  v_next_game integer;
begin
  select rounds.* into v_round
  from public.rounds rounds
  where rounds.id::text = p_round_id
  for update;

  if not found then
    raise exception 'Round was not found.';
  end if;

  select configured_round.value into v_config
  from public.tournaments tournaments
  cross join lateral jsonb_array_elements(tournaments.format_config -> 'rounds') configured_round(value)
  where tournaments.id = v_round.tournament_id
    and configured_round.value ->> 'id' = v_round.format_round_id
  limit 1;

  if v_config is null then
    raise exception 'Tournament format configuration for the active round was not found.';
  end if;

  v_is_checkmate := v_config -> 'winCondition' ->> 'type' = 'checkmate';
  if not v_is_checkmate then
    return query select * from public.generate_fixed_round_lobbies(p_round_id);
    return;
  end if;

  if v_round.status = 'completed' then
    return query select 0, 0;
    return;
  end if;

  if (select count(*) from public.participant_round_scores scores where scores.round_id = v_round.id) <> 8 then
    raise exception 'Checkmate rounds require exactly eight participants.';
  end if;

  v_threshold := coalesce((v_config -> 'winCondition' ->> 'threshold')::integer, 0);
  v_max_games := case
    when v_config -> 'winCondition' ->> 'maxGames' ~ '^\d+$'
      then (v_config -> 'winCondition' ->> 'maxGames')::integer
    else null
  end;
  select coalesce(max(lobbies.game_number), 0) into v_current_game
  from public.lobbies lobbies where lobbies.round_id = v_round.id;

  if public.checkmate_decisive_game(v_round.id::text, v_threshold) is not null
    or (v_max_games is not null and v_current_game >= v_max_games) then
    return query select 0, 0;
    return;
  end if;

  v_next_game := v_current_game + 1;
  insert into public.lobbies (round_id, game_number, lobby_number)
  values (v_round.id, v_next_game, 1)
  on conflict (round_id, game_number, lobby_number) do nothing;

  insert into public.lobby_participants (lobby_id, participant_id, slot_number)
  select lobbies.id, scores.participant_id,
    row_number() over (
      order by
        case when v_config ->> 'lobbySeeding' = 'random' then random() end,
        scores.round_seed_number,
        participants.display_name_at_start,
        participants.id::text
    )::integer
  from public.lobbies lobbies
  join public.participant_round_scores scores on scores.round_id = v_round.id
  join public.tournament_participants participants on participants.id = scores.participant_id
  where lobbies.round_id = v_round.id
    and lobbies.game_number = v_next_game
    and lobbies.lobby_number = 1
  on conflict (lobby_id, participant_id) do nothing;

  return query select 1, 8;
end;
$$;

alter function public.progress_tournament_round(text)
  rename to progress_fixed_tournament_round;

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
  v_config jsonb;
  v_destination_config jsonb;
  v_destination_id text;
  v_new_round_id public.rounds.id%type;
  v_threshold integer;
  v_max_games integer;
  v_decisive_game integer;
  v_required_game integer;
  v_available_count integer;
  v_advance_count integer;
begin
  select tournaments.* into v_tournament
  from public.tournaments tournaments
  where tournaments.id::text = p_tournament_id
  for update;

  if not found then raise exception 'Tournament was not found.'; end if;
  if v_tournament.status = 'completed' then
    return query select 'tournament_completed', v_tournament.current_round_id::text, null::text, 0;
    return;
  end if;
  if v_tournament.status <> 'in_progress' or v_tournament.current_round_id is null then
    raise exception 'Tournament is not in progress.';
  end if;

  select rounds.* into v_round
  from public.rounds rounds
  where rounds.id = v_tournament.current_round_id
    and rounds.tournament_id = v_tournament.id
  for update;
  if not found or v_round.status <> 'active' then
    raise exception 'The active tournament round is not available for progression.';
  end if;

  select configured_round.value into v_config
  from jsonb_array_elements(v_tournament.format_config -> 'rounds') configured_round(value)
  where configured_round.value ->> 'id' = v_round.format_round_id
  limit 1;

  if v_config is null then
    raise exception 'Tournament format configuration for the active round was not found.';
  end if;

  if v_config -> 'winCondition' ->> 'type' <> 'checkmate' then
    return query select * from public.progress_fixed_tournament_round(p_tournament_id);
    return;
  end if;

  if (select count(*) from public.participant_round_scores scores where scores.round_id = v_round.id) <> 8 then
    raise exception 'Checkmate rounds require exactly eight participants.';
  end if;
  v_threshold := coalesce((v_config -> 'winCondition' ->> 'threshold')::integer, 0);
  v_max_games := case
    when v_config -> 'winCondition' ->> 'maxGames' ~ '^\d+$'
      then (v_config -> 'winCondition' ->> 'maxGames')::integer
    else null
  end;
  v_decisive_game := public.checkmate_decisive_game(v_round.id::text, v_threshold);
  select max(lobbies.game_number)::integer into v_required_game
  from public.lobbies lobbies where lobbies.round_id = v_round.id;
  if v_decisive_game is not null then
    v_required_game := v_decisive_game;
  elsif v_max_games is not null and v_required_game >= v_max_games then
    v_required_game := v_max_games;
  else
    raise exception 'Checkmate has not been achieved and the configured game limit has not been reached.';
  end if;

  if exists (
    select 1 from generate_series(1, v_required_game) expected_game(game_number)
    where not exists (
      select 1 from public.lobbies lobbies
      where lobbies.round_id = v_round.id and lobbies.game_number = expected_game.game_number
    )
  ) or exists (
    select 1
    from public.lobbies lobbies
    left join public.lobby_participants lobby_participants on lobby_participants.lobby_id = lobbies.id
    where lobbies.round_id = v_round.id
      and lobbies.game_number <= v_required_game
      and (lobby_participants.id is null or lobby_participants.result_status not in ('confirmed', 'corrected'))
  ) then
    raise exception 'Complete every checkmate game before progressing the tournament.';
  end if;

  update public.participant_round_scores scores
  set score = coalesce((
    select sum(lobby_participants.points)::integer
    from public.lobbies lobbies
    join public.lobby_participants lobby_participants on lobby_participants.lobby_id = lobbies.id
    where lobbies.round_id = v_round.id
      and lobbies.game_number <= v_required_game
      and lobby_participants.participant_id = scores.participant_id
      and lobby_participants.result_status in ('confirmed', 'corrected')
  ), 0), updated_at = now()
  where scores.round_id = v_round.id;

  v_destination_id := v_config -> 'advancement' ->> 'destinationRoundId';
  if v_destination_id is null or v_destination_id = '' then
    update public.rounds set status = 'completed', updated_at = now() where id = v_round.id;
    update public.tournaments set status = 'completed', updated_at = now() where id = v_tournament.id;
    return query select 'tournament_completed', v_round.id::text, null::text, 0;
    return;
  end if;

  select configured_round.value into v_destination_config
  from jsonb_array_elements(v_tournament.format_config -> 'rounds') configured_round(value)
  where configured_round.value ->> 'id' = v_destination_id limit 1;
  if v_destination_config is null then raise exception 'Advancement destination round was not found.'; end if;

  v_available_count := (select count(*)::integer from public.participant_round_scores scores where scores.round_id = v_round.id);
  v_advance_count := least(coalesce((v_config -> 'advancement' ->> 'count')::integer, 0), v_available_count);
  if v_advance_count <= 0 then raise exception 'Advancement count must be positive.'; end if;

  select rounds.id into v_new_round_id
  from public.rounds rounds
  where rounds.tournament_id = v_tournament.id and rounds.format_round_id = v_destination_id
  for update;
  if v_new_round_id is null then
    insert into public.rounds (tournament_id, round_number, format_round_id, status)
    values (v_tournament.id, v_round.round_number + 1, v_destination_id, 'active')
    on conflict (tournament_id, round_number) do nothing;
    select rounds.id into v_new_round_id
    from public.rounds rounds
    where rounds.tournament_id = v_tournament.id and rounds.format_round_id = v_destination_id
    for update;
  end if;

  insert into public.participant_round_scores (participant_id, round_id, round_seed_number, score)
  with ranked as (
    select scores.participant_id,
      row_number() over (
        order by
          case when exists (
            select 1 from public.lobbies decisive_lobbies
            join public.lobby_participants decisive_participants on decisive_participants.lobby_id = decisive_lobbies.id
            where decisive_lobbies.round_id = v_round.id
              and decisive_lobbies.game_number = v_decisive_game
              and decisive_participants.participant_id = scores.participant_id
              and decisive_participants.placement = 1
              and decisive_participants.result_status in ('confirmed', 'corrected')
          ) then 0 else 1 end,
          scores.score desc,
          scores.round_seed_number asc,
          participants.display_name_at_start asc,
          participants.id::text asc
      )::integer as next_seed
    from public.participant_round_scores scores
    join public.tournament_participants participants on participants.id = scores.participant_id
    where scores.round_id = v_round.id
  )
  select ranked.participant_id, v_new_round_id, ranked.next_seed, 0
  from ranked where ranked.next_seed <= v_advance_count
  on conflict (participant_id, round_id) do update
    set round_seed_number = excluded.round_seed_number, score = 0, updated_at = now();

  update public.rounds set status = 'completed', updated_at = now() where id = v_round.id;
  perform public.generate_round_lobbies(v_new_round_id::text);
  update public.tournaments set current_round_id = v_new_round_id, updated_at = now() where id = v_tournament.id;
  return query select 'round_created', v_round.id::text, v_new_round_id::text, v_advance_count;
end;
$$;

notify pgrst, 'reload schema';
