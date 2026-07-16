-- Existing lobby rows represent game 1. Preserve them and their results while
-- adding an explicit game dimension for multi-game rounds.
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

-- Align stored copies of the built-in default format with the new two-game
-- default. Custom formats retain their configured game counts.
update public.tournaments tournaments
set format_config = jsonb_set(
  tournaments.format_config,
  '{rounds}',
  (
    select jsonb_agg(
      case
        when jsonb_typeof(configured_round.value -> 'winCondition') = 'object'
          then jsonb_set(
            jsonb_set(configured_round.value, '{games}', '2'::jsonb, true),
            '{winCondition,games}',
            '2'::jsonb,
            true
          )
        else jsonb_set(
          configured_round.value,
          '{games}',
          '2'::jsonb,
          true
        )
      end
      order by configured_round.position
    )
    from jsonb_array_elements(tournaments.format_config -> 'rounds')
      with ordinality as configured_round(value, position)
  ),
  true
)
where tournaments.format_id = 'default'
  and jsonb_typeof(tournaments.format_config -> 'rounds') = 'array';

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
  v_game_count integer;
begin
  select rounds.*
  into v_round
  from public.rounds rounds
  where rounds.id::text = p_round_id
  for update;

  if not found then
    raise exception 'Round was not found.';
  end if;

  select configured_round.value
  into v_round_config
  from public.tournaments tournaments
  cross join lateral jsonb_array_elements(tournaments.format_config -> 'rounds')
    as configured_round(value)
  where tournaments.id = v_round.tournament_id
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

  if coalesce(v_round_config ->> 'games', '') !~ '^\d+$' then
    raise exception 'Round games must be a whole number between 1 and 100.';
  end if;

  if (v_round_config ->> 'games')::numeric < 1
    or (v_round_config ->> 'games')::numeric > 100 then
    raise exception 'Round games must be a whole number between 1 and 100.';
  end if;

  v_game_count := (v_round_config ->> 'games')::integer;

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

  insert into public.lobbies (round_id, lobby_number, game_number)
  select v_round.id, lobby_number, game_number
  from generate_series(1, v_game_count) as game_number
  cross join generate_series(1, v_lobby_count) as lobby_number;

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
  select v_lobby_count * v_game_count, v_participant_count;
end;
$$;

-- Add missing games to already-started rounds by copying game 1 assignments.
-- Existing game 1 placements and points remain untouched.
with configured_rounds as (
  select
    rounds.id as round_id,
    (configured_round.value ->> 'games')::integer as game_count
  from public.rounds rounds
  join public.tournaments tournaments
    on tournaments.id = rounds.tournament_id
  cross join lateral jsonb_array_elements(tournaments.format_config -> 'rounds')
    as configured_round(value)
  where configured_round.value ->> 'id' = rounds.format_round_id
    and case
      when coalesce(configured_round.value ->> 'games', '') ~ '^\d+$'
        then (configured_round.value ->> 'games')::numeric between 1 and 100
      else false
    end
),
game_one_lobbies as (
  select
    lobbies.id,
    lobbies.round_id,
    lobbies.lobby_number,
    configured_rounds.game_count
  from public.lobbies lobbies
  join configured_rounds
    on configured_rounds.round_id = lobbies.round_id
  where lobbies.game_number = 1
)
insert into public.lobbies (round_id, lobby_number, game_number)
select
  game_one_lobbies.round_id,
  game_one_lobbies.lobby_number,
  game_number
from game_one_lobbies
cross join lateral generate_series(2, game_one_lobbies.game_count)
  as game_number
on conflict (round_id, game_number, lobby_number) do nothing;

insert into public.lobby_participants (
  lobby_id,
  participant_id,
  slot_number
)
select
  target_lobbies.id,
  source_participants.participant_id,
  source_participants.slot_number
from public.lobbies target_lobbies
join public.lobbies source_lobbies
  on source_lobbies.round_id = target_lobbies.round_id
  and source_lobbies.lobby_number = target_lobbies.lobby_number
  and source_lobbies.game_number = 1
join public.lobby_participants source_participants
  on source_participants.lobby_id = source_lobbies.id
where target_lobbies.game_number > 1
on conflict (lobby_id, participant_id) do nothing;

notify pgrst, 'reload schema';
