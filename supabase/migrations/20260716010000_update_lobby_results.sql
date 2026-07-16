create or replace function public.update_lobby_results(
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
  v_lobby public.lobbies%rowtype;
  v_participant_count integer;
  v_result_count integer;
begin
  select lobbies.*
  into v_lobby
  from public.lobbies lobbies
  join public.rounds rounds on rounds.id = lobbies.round_id
  join public.tournaments tournaments
    on tournaments.id = rounds.tournament_id
  where lobbies.id::text = p_lobby_id
    and tournaments.id::text = p_tournament_id
  for update of lobbies;

  if not found then
    raise exception 'Lobby was not found in this tournament.';
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
      or coalesce(result.value ->> 'points', '') !~ '^\d+$'
  ) then
    raise exception 'Every result needs a valid player, placement, and score.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_results) result(value)
    where (result.value ->> 'placement')::numeric < 1
      or (result.value ->> 'placement')::numeric > v_participant_count
      or (result.value ->> 'points')::numeric > 2147483647
  ) then
    raise exception 'Every result needs a valid player, placement, and score.';
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

  with parsed_results as (
    select
      result.value ->> 'participantId' as participant_id,
      (result.value ->> 'placement')::integer as placement,
      (result.value ->> 'points')::integer as points
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
    and lobby_participants.participant_id::text =
      parsed_results.participant_id;

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
  where scores.round_id = v_lobby.round_id;

  update public.lobbies
  set updated_at = now()
  where id = v_lobby.id;

  return query
  select v_lobby.id::text, v_participant_count;
end;
$$;

notify pgrst, 'reload schema';
