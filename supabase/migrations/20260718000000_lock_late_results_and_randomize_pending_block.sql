-- Keep reseeded lobby assignments consistent with the results that created them.
-- The test helper randomizes one pending block at a time in a single transaction.

create or replace function public.prevent_late_lobby_result_edits()
returns trigger
language plpgsql
as $$
declare
  v_round_id public.rounds.id%type;
  v_game_number integer;
  v_format_round_id text;
  v_format_config jsonb;
  v_round_config jsonb;
  v_block_size integer;
  v_block_end_game integer;
begin
  if old.placement is not distinct from new.placement
    and old.points is not distinct from new.points
    and old.result_status is not distinct from new.result_status then
    return new;
  end if;

  select lobbies.round_id,
    lobbies.game_number,
    rounds.format_round_id,
    tournaments.format_config
  into v_round_id, v_game_number, v_format_round_id, v_format_config
  from public.lobbies lobbies
  join public.rounds rounds on rounds.id = lobbies.round_id
  join public.tournaments tournaments on tournaments.id = rounds.tournament_id
  where lobbies.id = new.lobby_id;

  if v_round_id is null then
    return new;
  end if;

  select configured_round.value
  into v_round_config
  from jsonb_array_elements(v_format_config -> 'rounds') configured_round(value)
  where configured_round.value ->> 'id' = v_format_round_id
  limit 1;

  if coalesce(v_round_config -> 'winCondition' ->> 'type', '') = 'checkmate' then
    v_block_size := 1;
  elsif (v_round_config ->> 'reseed') ~ '^\d+$'
    and (v_round_config ->> 'reseed')::integer > 0 then
    v_block_size := (v_round_config ->> 'reseed')::integer;
  elsif (v_round_config ->> 'games') ~ '^\d+$'
    and (v_round_config ->> 'games')::integer > 0 then
    v_block_size := (v_round_config ->> 'games')::integer;
  else
    v_block_size := 1;
  end if;

  v_block_end_game := ((v_game_number - 1) / v_block_size + 1) * v_block_size;

  if exists (
    select 1
    from public.lobbies later_lobbies
    where later_lobbies.round_id = v_round_id
      and later_lobbies.game_number > v_block_end_game
  ) then
    raise exception
      'Results for game % cannot be edited after a later reseeded game has been generated.',
      v_game_number;
  end if;

  return new;
end;
$$;

drop trigger if exists lobby_participants_prevent_late_result_edits
  on public.lobby_participants;

create trigger lobby_participants_prevent_late_result_edits
before update of placement, points, result_status
on public.lobby_participants
for each row
execute function public.prevent_late_lobby_result_edits();

drop function if exists public.randomize_pending_lobby_results(text);

create function public.randomize_pending_lobby_results(
  p_tournament_id text
)
returns table (
  randomized_lobby_count integer,
  randomized_participant_count integer
)
language plpgsql
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_round public.rounds%rowtype;
  v_round_config jsonb;
  v_block_size integer;
  v_first_pending_game integer;
  v_block_start_game integer;
  v_block_end_game integer;
  v_lobby record;
  v_results jsonb;
  v_lobby_count integer := 0;
  v_participant_count integer := 0;
begin
  select tournaments.*
  into v_tournament
  from public.tournaments tournaments
  where tournaments.id::text = p_tournament_id
  for update;

  if not found then
    raise exception 'Tournament was not found.';
  end if;

  if v_tournament.status = 'completed' then
    raise exception 'Completed tournaments are read-only.';
  end if;

  if v_tournament.current_round_id is null then
    raise exception 'No active tournament round is available.';
  end if;

  select rounds.*
  into v_round
  from public.rounds rounds
  where rounds.id = v_tournament.current_round_id
    and rounds.tournament_id = v_tournament.id
  for update;

  if not found or v_round.status <> 'active' then
    raise exception 'No active tournament round is available.';
  end if;

  select configured_round.value
  into v_round_config
  from jsonb_array_elements(v_tournament.format_config -> 'rounds') configured_round(value)
  where configured_round.value ->> 'id' = v_round.format_round_id
  limit 1;

  if v_round_config is null then
    raise exception 'Tournament format configuration for the active round was not found.';
  end if;

  if coalesce(v_round_config -> 'winCondition' ->> 'type', '') = 'checkmate' then
    v_block_size := 1;
  elsif (v_round_config ->> 'reseed') ~ '^\d+$'
    and (v_round_config ->> 'reseed')::integer > 0 then
    v_block_size := (v_round_config ->> 'reseed')::integer;
  elsif (v_round_config ->> 'games') ~ '^\d+$'
    and (v_round_config ->> 'games')::integer > 0 then
    v_block_size := (v_round_config ->> 'games')::integer;
  else
    v_block_size := 1;
  end if;

  select min(lobbies.game_number)
  into v_first_pending_game
  from public.lobbies lobbies
  join public.lobby_participants lobby_participants
    on lobby_participants.lobby_id = lobbies.id
  where lobbies.round_id = v_round.id
    and lobby_participants.result_status = 'pending';

  if v_first_pending_game is null then
    raise exception 'There are no pending lobbies in the active game block.';
  end if;

  v_block_start_game :=
    ((v_first_pending_game - 1) / v_block_size) * v_block_size + 1;
  v_block_end_game := v_block_start_game + v_block_size - 1;

  for v_lobby in
    select lobbies.id
    from public.lobbies lobbies
    where lobbies.round_id = v_round.id
      and lobbies.game_number between v_block_start_game and v_block_end_game
      and exists (
        select 1
        from public.lobby_participants pending_participants
        where pending_participants.lobby_id = lobbies.id
      )
      and not exists (
        select 1
        from public.lobby_participants scored_participants
        where scored_participants.lobby_id = lobbies.id
          and scored_participants.result_status <> 'pending'
      )
    order by lobbies.game_number, lobbies.lobby_number
    for update of lobbies
  loop
    select jsonb_agg(
      jsonb_build_object(
        'participantId', randomized.participant_id::text,
        'placement', randomized.placement
      )
      order by randomized.participant_id
    )
    into v_results
    from (
      select lobby_participants.participant_id,
        row_number() over (order by random())::integer as placement
      from public.lobby_participants lobby_participants
      where lobby_participants.lobby_id = v_lobby.id
    ) randomized;

    perform public.update_lobby_results(
      v_tournament.id::text,
      v_lobby.id::text,
      v_results
    );

    v_lobby_count := v_lobby_count + 1;
    v_participant_count := v_participant_count + jsonb_array_length(v_results);
  end loop;

  if v_lobby_count = 0 then
    raise exception 'There are no pending lobbies in the active game block.';
  end if;

  return query select v_lobby_count, v_participant_count;
end;
$$;

notify pgrst, 'reload schema';
