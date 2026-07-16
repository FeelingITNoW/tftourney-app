-- Every configured round must declare how its lobby roster is seeded.
-- Existing formats predate this field, so preserve their behavior with snake
-- seeding as the backwards-compatible default.
update public.tournaments t
set format_config = jsonb_set(
  t.format_config,
  '{rounds}',
  (
    select jsonb_agg(
      case
        when configured_round.value ? 'lobbySeeding'
          then configured_round.value
        else configured_round.value || jsonb_build_object('lobbySeeding', 'snake')
      end
      order by configured_round.position
    )
    from jsonb_array_elements(t.format_config -> 'rounds')
      with ordinality as configured_round(value, position)
  )
)
where jsonb_typeof(t.format_config -> 'rounds') = 'array'
  and exists (
    select 1
    from jsonb_array_elements(t.format_config -> 'rounds') as configured_round(value)
    where not (configured_round.value ? 'lobbySeeding')
  );

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
  v_players_per_lobby constant integer := 8;
  v_participant_count integer;
  v_lobby_count integer;
begin
  select r.*
  into v_round
  from public.rounds r
  where r.id::text = p_round_id
  for update;

  if not found then
    raise exception 'Round was not found.';
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

  v_lobby_seeding := v_round_config ->> 'lobbySeeding';

  if v_lobby_seeding is null
    or v_lobby_seeding not in ('snake', 'random') then
    raise exception 'Lobby seeding must be snake or random.';
  end if;

  select count(distinct scores.participant_id)::integer
  into v_participant_count
  from public.participant_round_scores scores
  join public.tournament_participants participants
    on participants.id = scores.participant_id
  where scores.round_id = v_round.id
    and participants.tournament_id = v_round.tournament_id;

  if v_participant_count = 0 then
    raise exception 'Add round participants before generating lobbies.';
  end if;

  v_lobby_count := ceil(
    v_participant_count::numeric / v_players_per_lobby
  )::integer;

  delete from public.lobbies
  where round_id = v_round.id;

  insert into public.lobbies (round_id, lobby_number)
  select v_round.id, lobby_number
  from generate_series(1, v_lobby_count) as lobby_number;

  with ordered_participants as (
    select
      scores.participant_id,
      row_number() over (
        order by
          case when v_lobby_seeding = 'random' then random() end,
          case when v_lobby_seeding = 'snake' then participants.seed_number end,
          participants.seed_number
      ) - 1 as position
    from public.participant_round_scores scores
    join public.tournament_participants participants
      on participants.id = scores.participant_id
    where scores.round_id = v_round.id
      and participants.tournament_id = v_round.tournament_id
  ),
  assigned_participants as (
    select
      ordered_participants.participant_id,
      case
        when v_lobby_seeding = 'snake'
          and (
            (ordered_participants.position / v_lobby_count) % 2
          ) = 1
          then v_lobby_count
            - (ordered_participants.position % v_lobby_count)::integer
        else
          (ordered_participants.position % v_lobby_count)::integer + 1
      end as lobby_number,
      (ordered_participants.position / v_lobby_count)::integer + 1
        as slot_number
    from ordered_participants
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
    and lobbies.lobby_number = assigned_participants.lobby_number;

  return query
  select v_lobby_count, v_participant_count;
end;
$$;

-- Repair rounds that were started before lobby generation was installed. Only
-- rounds with a usable format strategy and an existing score roster qualify.
do $$
declare
  existing_round record;
begin
  for existing_round in
    select r.id
    from public.rounds r
    join public.tournaments t on t.id = r.tournament_id
    cross join lateral jsonb_array_elements(t.format_config -> 'rounds')
      as configured_round(value)
    where configured_round.value ->> 'id' = r.format_round_id
      and configured_round.value ->> 'lobbySeeding' in ('snake', 'random')
      and exists (
        select 1
        from public.participant_round_scores scores
        where scores.round_id = r.id
      )
      and not exists (
        select 1
        from public.lobbies lobbies
        where lobbies.round_id = r.id
      )
  loop
    perform public.generate_round_lobbies(existing_round.id::text);
  end loop;
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
  from public.tournament_registrations r
  where r.tournament_id = v_tournament.id
    and r.registration_status = 'registered';

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
      r.id,
      r.display_name,
      row_number() over (order by r.created_at asc, r.id asc)::integer as seed_number
    from public.tournament_registrations r
    where r.tournament_id = v_tournament.id
      and r.registration_status = 'registered'
    order by r.created_at asc, r.id asc
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

  update public.tournament_registrations r
  set registration_status = case
    when exists (
      select 1 from public.tournament_participants p
      where p.registration_id = r.id
        and p.tournament_id = v_tournament.id
    ) then 'entered'
    else 'waitlisted'
  end
  where r.tournament_id = v_tournament.id
    and r.registration_status = 'registered';

  insert into public.participant_round_scores (
    participant_id,
    round_id,
    score
  )
  select p.id, v_round_id, 0
  from public.tournament_participants p
  where p.tournament_id = v_tournament.id
  on conflict (participant_id, round_id) do nothing;

  perform public.generate_round_lobbies(v_round_id::text);

  update public.tournaments
  set status = 'in_progress',
      started_at = coalesce(started_at, now()),
      current_round_id = v_round_id
  where id = v_tournament.id;

  select count(*)::integer
  into v_entrant_count
  from public.tournament_participants p
  where p.tournament_id = v_tournament.id;

  return query
  select v_tournament.id::text, v_entrant_count, v_round_id::text, 1;
end;
$$;

notify pgrst, 'reload schema';
