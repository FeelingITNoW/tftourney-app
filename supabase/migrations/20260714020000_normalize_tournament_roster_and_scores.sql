create extension if not exists pgcrypto;

-- Keep the existing rows, but give each table one clear responsibility.
do $$
begin
  if to_regclass('public.tournament_players') is not null
    and to_regclass('public.tournament_registrations') is null then
    alter table public.tournament_players rename to tournament_registrations;
  end if;

  if to_regclass('public.tournament_entries') is not null
    and to_regclass('public.tournament_participants') is null then
    alter table public.tournament_entries rename to tournament_participants;
  end if;

  if to_regclass('public.tournament_scores') is not null
    and to_regclass('public.participant_round_scores') is null then
    alter table public.tournament_scores rename to participant_round_scores;
  end if;

  if to_regclass('public.lobby_players') is not null
    and to_regclass('public.lobby_participants') is null then
    alter table public.lobby_players rename to lobby_participants;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournaments'
      and column_name = 'player_count'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournaments'
      and column_name = 'max_players'
  ) then
    alter table public.tournaments rename column player_count to max_players;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournament_registrations'
      and column_name = 'status'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournament_registrations'
      and column_name = 'registration_status'
  ) then
    alter table public.tournament_registrations
      rename column status to registration_status;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournament_participants'
      and column_name = 'tournament_player_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournament_participants'
      and column_name = 'registration_id'
  ) then
    alter table public.tournament_participants
      rename column tournament_player_id to registration_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournament_participants'
      and column_name = 'display_name'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournament_participants'
      and column_name = 'display_name_at_start'
  ) then
    alter table public.tournament_participants
      rename column display_name to display_name_at_start;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'participant_round_scores'
      and column_name = 'tournament_entry_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'participant_round_scores'
      and column_name = 'participant_id'
  ) then
    alter table public.participant_round_scores
      rename column tournament_entry_id to participant_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'participant_round_scores'
      and column_name = 'round_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'participant_round_scores'
      and column_name = 'format_round_id'
  ) then
    alter table public.participant_round_scores
      rename column round_id to format_round_id;
  end if;
end $$;

alter table public.tournaments
  add column if not exists started_at timestamptz,
  add column if not exists current_round_number integer;

alter table public.tournament_registrations
  add column if not exists registration_status text,
  add column if not exists updated_at timestamptz not null default now();

update public.tournament_registrations
set registration_status = case
  when registration_status in ('registered', 'checked_in') then 'registered'
  else 'registered'
end
where registration_status is null
   or registration_status not in ('registered', 'waitlisted', 'entered', 'withdrawn');

update public.tournament_registrations
set display_name = coalesce(display_name, riot_puuid, id::text)
where display_name is null;

alter table public.tournament_registrations
  alter column registration_status set default 'registered',
  alter column registration_status set not null,
  alter column display_name set not null;

alter table public.tournament_registrations
  drop constraint if exists tournament_players_status_check,
  drop constraint if exists tournament_registrations_status_check;

do $$
declare
  status_constraint record;
begin
  for status_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.tournament_registrations'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format(
      'alter table public.tournament_registrations drop constraint %I',
      status_constraint.conname
    );
  end loop;
end $$;

alter table public.tournament_registrations
  add constraint tournament_registrations_status_check check (
    registration_status in ('registered', 'waitlisted', 'entered', 'withdrawn')
  );

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournament_registrations'
      and column_name = 'seed'
  ) then
    alter table public.tournament_registrations drop column seed;
  end if;
end $$;

drop index if exists public.tournament_players_unique_display_name_idx;
drop index if exists public.tournament_players_unique_riot_puuid_idx;
drop index if exists public.tournament_players_tournament_id_idx;

create index if not exists tournament_registrations_tournament_id_idx
  on public.tournament_registrations(tournament_id);

create unique index if not exists tournament_registrations_unique_riot_puuid_idx
  on public.tournament_registrations(tournament_id, riot_puuid)
  where riot_puuid is not null;

create unique index if not exists tournament_registrations_id_tournament_id_idx
  on public.tournament_registrations(id, tournament_id);

create or replace function public.prevent_registration_after_start()
returns trigger
language plpgsql
as $$
declare
  registration_tournament_id text;
  tournament_status text;
begin
  registration_tournament_id := case
    when tg_op = 'DELETE' then old.tournament_id::text
    else new.tournament_id::text
  end;

  select t.status
  into tournament_status
  from public.tournaments t
  where t.id::text = registration_tournament_id
  for key share;

  if tournament_status is null then
    raise exception 'Tournament was not found.';
  end if;

  if tournament_status <> 'accepting_players' then
    raise exception 'Registration is closed because the tournament has started.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists tournament_registrations_lock_after_start
  on public.tournament_registrations;

create trigger tournament_registrations_lock_after_start
before insert or delete or update of tournament_id
on public.tournament_registrations
for each row
execute function public.prevent_registration_after_start();

alter table public.tournament_participants
  add column if not exists display_name_at_start text;

update public.tournament_participants
set display_name_at_start = coalesce(display_name_at_start, 'Unknown player')
where display_name_at_start is null;

alter table public.tournament_participants
  alter column display_name_at_start set not null;

drop index if exists public.tournament_entries_unique_player_idx;
drop index if exists public.tournament_entries_unique_seed_idx;
drop index if exists public.tournament_entries_tournament_id_idx;

create unique index if not exists tournament_participants_unique_registration_idx
  on public.tournament_participants(tournament_id, registration_id);

create unique index if not exists tournament_participants_unique_seed_idx
  on public.tournament_participants(tournament_id, seed_number);

create index if not exists tournament_participants_tournament_id_idx
  on public.tournament_participants(tournament_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tournament_participants_registration_tournament_fk'
      and conrelid = 'public.tournament_participants'::regclass
  ) then
    alter table public.tournament_participants
      add constraint tournament_participants_registration_tournament_fk
      foreign key (registration_id, tournament_id)
      references public.tournament_registrations(id, tournament_id);
  end if;
end $$;

-- These tables were present in the database snapshot but were missing from
-- the repository migrations. Create them for fresh environments as well.
do $$
declare
  tournament_id_type text;
  round_id_definition text;
begin
  if to_regclass('public.rounds') is null then
    select format_type(a.atttypid, a.atttypmod)
    into tournament_id_type
    from pg_attribute a
    where a.attrelid = 'public.tournaments'::regclass
      and a.attname = 'id'
      and not a.attisdropped;

    if tournament_id_type = 'uuid' then
      round_id_definition := 'uuid primary key default gen_random_uuid()';
    else
      round_id_definition := format('%s generated always as identity primary key', tournament_id_type);
    end if;

    execute format($sql$
      create table public.rounds (
        id %s,
        tournament_id %s not null references public.tournaments(id) on delete cascade,
        round_number integer not null check (round_number > 0),
        format_round_id text,
        stage_name text,
        status text not null default 'pending' check (
          status in ('pending', 'active', 'completed', 'cancelled')
        ),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    $sql$, round_id_definition, tournament_id_type);
  end if;
end $$;

alter table public.rounds
  add column if not exists format_round_id text;

create unique index if not exists rounds_unique_tournament_number_idx
  on public.rounds(tournament_id, round_number);

create unique index if not exists rounds_unique_tournament_format_id_idx
  on public.rounds(tournament_id, format_round_id)
  where format_round_id is not null;

do $$
declare
  round_id_type text;
  lobby_id_definition text;
begin
  if to_regclass('public.lobbies') is null then
    select format_type(a.atttypid, a.atttypmod)
    into round_id_type
    from pg_attribute a
    where a.attrelid = 'public.rounds'::regclass
      and a.attname = 'id'
      and not a.attisdropped;

    if round_id_type = 'uuid' then
      lobby_id_definition := 'uuid primary key default gen_random_uuid()';
    else
      lobby_id_definition := format('%s generated always as identity primary key', round_id_type);
    end if;

    execute format($sql$
      create table public.lobbies (
        id %s,
        round_id %s not null references public.rounds(id) on delete cascade,
        lobby_number integer not null check (lobby_number > 0),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    $sql$, lobby_id_definition, round_id_type);
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournaments'
      and column_name = 'current_round_id'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournaments'
      and column_name = 'current_round_key'
  ) then
    alter table public.tournaments rename column current_round_id to current_round_key;
  elsif not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournaments'
      and column_name = 'current_round_key'
  ) then
    alter table public.tournaments add column current_round_key text;
  end if;
end $$;

update public.rounds r
set format_round_id = coalesce(r.format_round_id, t.current_round_key)
from public.tournaments t
where r.tournament_id = t.id
  and r.round_number = coalesce(t.current_round_number, 1)
  and t.current_round_key is not null;

insert into public.rounds (
  tournament_id,
  round_number,
  format_round_id,
  status
)
select
  t.id,
  coalesce(t.current_round_number, 1),
  coalesce(t.current_round_key, 'opening-round'),
  'active'
from public.tournaments t
where t.status = 'in_progress'
  and not exists (
    select 1
    from public.rounds r
    where r.tournament_id = t.id
      and r.round_number = coalesce(t.current_round_number, 1)
  );

do $$
declare
  round_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
  into round_id_type
  from pg_attribute a
  where a.attrelid = 'public.rounds'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  execute format(
    'alter table public.tournaments add column if not exists current_round_ref_id %s',
    round_id_type
  );

  execute $sql$
    update public.tournaments t
    set current_round_ref_id = r.id
    from public.rounds r
    where r.tournament_id = t.id
      and r.round_number = coalesce(t.current_round_number, 1)
      and t.current_round_key is not null
  $sql$;
end $$;

alter table public.tournaments
  drop constraint if exists tournaments_current_round_number_check,
  drop column if exists current_round_key,
  drop column if exists current_round_number,
  drop column if exists has_started;

alter table public.tournaments
  rename column current_round_ref_id to current_round_id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tournaments_current_round_id_fkey'
      and conrelid = 'public.tournaments'::regclass
  ) then
    alter table public.tournaments
      add constraint tournaments_current_round_id_fkey
      foreign key (current_round_id)
      references public.rounds(id)
      on delete set null;
  end if;
end $$;

-- Convert score rows to reference real rounds. The old format-level key is
-- retained on rounds.format_round_id during this migration.
do $$
declare
  score_round record;
begin
  for score_round in
    select distinct p.tournament_id, s.format_round_id
    from public.participant_round_scores s
    join public.tournament_participants p on p.id = s.participant_id
    where s.format_round_id is not null
      and not exists (
        select 1
        from public.rounds r
        where r.tournament_id = p.tournament_id
          and r.format_round_id = s.format_round_id
      )
  loop
    insert into public.rounds (
      tournament_id,
      round_number,
      format_round_id,
      status
    )
    select
      score_round.tournament_id,
      coalesce(max(r.round_number), 0) + 1,
      score_round.format_round_id,
      'completed'
    from public.rounds r
    where r.tournament_id = score_round.tournament_id;
  end loop;
end $$;

do $$
declare
  round_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
  into round_id_type
  from pg_attribute a
  where a.attrelid = 'public.rounds'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  execute format(
    'alter table public.participant_round_scores add column if not exists round_ref_id %s',
    round_id_type
  );

  execute $sql$
    update public.participant_round_scores s
    set round_ref_id = r.id
    from public.tournament_participants p
      cross join public.rounds r
    where p.id = s.participant_id
      and r.tournament_id = p.tournament_id
      and r.format_round_id = s.format_round_id
  $sql$;
end $$;

do $$
begin
  if exists (
    select 1 from public.participant_round_scores
    where round_ref_id is null
  ) then
    raise exception 'Could not map every participant score to a round.';
  end if;
end $$;

alter table public.participant_round_scores
  drop constraint if exists tournament_scores_unique_entry_round_idx,
  drop column if exists tournament_id,
  drop column format_round_id;

alter table public.participant_round_scores
  rename column round_ref_id to round_id;

drop index if exists public.tournament_scores_unique_entry_round_idx;
drop index if exists public.tournament_scores_tournament_id_idx;

create unique index if not exists participant_round_scores_unique_participant_round_idx
  on public.participant_round_scores(participant_id, round_id);

create index if not exists participant_round_scores_round_id_idx
  on public.participant_round_scores(round_id);

alter table public.participant_round_scores
  add constraint participant_round_scores_round_fk
  foreign key (round_id) references public.rounds(id) on delete cascade;

-- Lobby tables should attach gameplay rows to frozen participants, not to
-- registration records.
do $$
declare
  participant_id_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
  into participant_id_type
  from pg_attribute a
  where a.attrelid = 'public.tournament_participants'::regclass
    and a.attname = 'id'
    and not a.attisdropped;

  if to_regclass('public.lobby_participants') is null then
    execute format($sql$
      create table public.lobby_participants (
        id uuid primary key default gen_random_uuid(),
        lobby_id %s not null references public.lobbies(id) on delete cascade,
        participant_id %s not null references public.tournament_participants(id) on delete cascade,
        slot_number integer check (slot_number is null or slot_number > 0),
        placement integer check (placement is null or placement > 0),
        points integer check (points is null or points >= 0),
        result_status text not null default 'pending' check (
          result_status in ('pending', 'confirmed', 'corrected', 'disputed')
        ),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    $sql$, format_type(
      (select a.atttypid from pg_attribute a
       where a.attrelid = 'public.lobbies'::regclass
         and a.attname = 'id' and not a.attisdropped),
      -1
    ), participant_id_type);
  end if;
end $$;

do $$
declare
  participant_id_type text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lobby_participants'
      and column_name = 'tournament_player_id'
  ) then
    select format_type(a.atttypid, a.atttypmod)
    into participant_id_type
    from pg_attribute a
    where a.attrelid = 'public.tournament_participants'::regclass
      and a.attname = 'id'
      and not a.attisdropped;

    execute format(
      'alter table public.lobby_participants add column if not exists participant_ref_id %s',
      participant_id_type
    );

    update public.lobby_participants lp
    set participant_ref_id = p.id
    from public.tournament_participants p
    where p.registration_id = lp.tournament_player_id;

    if exists (
      select 1 from public.lobby_participants
      where participant_ref_id is null
    ) then
      raise exception 'Could not map every lobby player to a tournament participant.';
    end if;

    alter table public.lobby_participants
      drop column tournament_player_id;

    alter table public.lobby_participants
      rename column participant_ref_id to participant_id;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lobbies'
      and column_name = 'tournament_id'
  ) then
    alter table public.lobbies drop column tournament_id;
  end if;
end $$;

create unique index if not exists lobbies_unique_round_number_idx
  on public.lobbies(round_id, lobby_number);

create unique index if not exists lobby_participants_unique_lobby_participant_idx
  on public.lobby_participants(lobby_id, participant_id);

create unique index if not exists lobby_participants_unique_lobby_slot_idx
  on public.lobby_participants(lobby_id, slot_number)
  where slot_number is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'lobby_participants_participant_fk'
      and conrelid = 'public.lobby_participants'::regclass
  ) then
    alter table public.lobby_participants
      add constraint lobby_participants_participant_fk
      foreign key (participant_id)
      references public.tournament_participants(id)
      on delete cascade;
  end if;
end $$;

update public.tournament_registrations r
set registration_status = case
  when exists (
    select 1 from public.tournament_participants p
    where p.registration_id = r.id
  ) then 'entered'
  else 'waitlisted'
end
where exists (
  select 1 from public.tournaments t
  where t.id = r.tournament_id
    and t.status <> 'accepting_players'
);

update public.tournaments
set started_at = coalesce(started_at, updated_at, created_at)
where status <> 'accepting_players';

drop function if exists public.start_tournament(uuid);
drop function if exists public.start_tournament(bigint);
drop function if exists public.start_tournament(text);

create or replace function public.start_tournament(p_tournament_id text)
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
