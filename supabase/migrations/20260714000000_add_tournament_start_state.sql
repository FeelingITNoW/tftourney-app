alter table public.tournaments
  add column if not exists current_round_id text,
  add column if not exists current_round_number integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tournaments_current_round_number_check'
      and conrelid = 'public.tournaments'::regclass
  ) then
    alter table public.tournaments
      add constraint tournaments_current_round_number_check check (
        current_round_number is null
        or current_round_number > 0
      );
  end if;
end $$;

do $$
declare
  tournament_id_type text;
  tournament_player_id_type text;
begin
  select format_type(columns.atttypid, columns.atttypmod)
  into tournament_id_type
  from pg_attribute columns
  where columns.attrelid = 'public.tournaments'::regclass
    and columns.attname = 'id'
    and not columns.attisdropped;

  select format_type(columns.atttypid, columns.atttypmod)
  into tournament_player_id_type
  from pg_attribute columns
  where columns.attrelid = 'public.tournament_players'::regclass
    and columns.attname = 'id'
    and not columns.attisdropped;

  if tournament_id_type is null or tournament_player_id_type is null then
    raise exception 'Could not determine tournament table id types.';
  end if;

  execute format(
    $sql$
      create table if not exists public.tournament_entries (
        id uuid primary key default gen_random_uuid(),
        tournament_id %s not null references public.tournaments(id) on delete cascade,
        tournament_player_id %s not null references public.tournament_players(id) on delete cascade,
        seed_number integer not null check (seed_number > 0),
        display_name text not null,
        created_at timestamptz not null default now()
      )
    $sql$,
    tournament_id_type,
    tournament_player_id_type
  );
end $$;

create unique index if not exists tournament_entries_unique_player_idx
  on public.tournament_entries(tournament_id, tournament_player_id);

create unique index if not exists tournament_entries_unique_seed_idx
  on public.tournament_entries(tournament_id, seed_number);

create index if not exists tournament_entries_tournament_id_idx
  on public.tournament_entries(tournament_id);

do $$
declare
  tournament_id_type text;
begin
  select format_type(columns.atttypid, columns.atttypmod)
  into tournament_id_type
  from pg_attribute columns
  where columns.attrelid = 'public.tournaments'::regclass
    and columns.attname = 'id'
    and not columns.attisdropped;

  if tournament_id_type is null then
    raise exception 'Could not determine tournaments.id type.';
  end if;

  execute format(
    $sql$
      create table if not exists public.tournament_scores (
        id uuid primary key default gen_random_uuid(),
        tournament_id %s not null references public.tournaments(id) on delete cascade,
        tournament_entry_id uuid not null references public.tournament_entries(id) on delete cascade,
        round_id text not null,
        score integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    $sql$,
    tournament_id_type
  );
end $$;

create unique index if not exists tournament_scores_unique_entry_round_idx
  on public.tournament_scores(tournament_id, tournament_entry_id, round_id);

create index if not exists tournament_scores_tournament_id_idx
  on public.tournament_scores(tournament_id);

drop trigger if exists tournament_scores_set_updated_at on public.tournament_scores;

create trigger tournament_scores_set_updated_at
before update on public.tournament_scores
for each row
execute function public.set_updated_at();

drop function if exists public.start_tournament(uuid);
drop function if exists public.start_tournament(bigint);

create or replace function public.start_tournament(p_tournament_id text)
returns table (
  tournament_id text,
  entrant_count integer,
  current_round_id text,
  current_round_number integer
)
language plpgsql
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_current_round_id text;
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
  from public.tournament_players
  where tournament_players.tournament_id::text = p_tournament_id;

  if v_entrant_count = 0 then
    raise exception 'Register at least one player before starting the tournament.';
  end if;

  v_current_round_id := coalesce(
    v_tournament.format_config #>> '{rounds,0,id}',
    'opening-round'
  );

  with selected_players as (
    select
      tournament_players.id,
      coalesce(
        tournament_players.display_name,
        tournament_players.riot_puuid,
        tournament_players.id::text
      ) as display_name,
      (row_number() over (
        order by tournament_players.created_at asc, tournament_players.id asc
      ))::integer as seed_number
    from public.tournament_players
    where tournament_players.tournament_id::text = p_tournament_id
    order by tournament_players.created_at asc, tournament_players.id asc
    limit v_tournament.player_count
  ),
  inserted_entries as (
    insert into public.tournament_entries (
      tournament_id,
      tournament_player_id,
      seed_number,
      display_name
    )
    select
      v_tournament.id,
      selected_players.id,
      selected_players.seed_number,
      selected_players.display_name
    from selected_players
    on conflict (tournament_id, tournament_player_id) do update
      set display_name = excluded.display_name
    returning id
  )
  insert into public.tournament_scores (
    tournament_id,
    tournament_entry_id,
    round_id,
    score
  )
  select
    v_tournament.id,
    inserted_entries.id,
    v_current_round_id,
    0
  from inserted_entries
  on conflict (tournament_id, tournament_entry_id, round_id) do nothing;

  update public.tournaments
  set
    status = 'in_progress',
    has_started = true,
    current_round_id = v_current_round_id,
    current_round_number = 1
  where id::text = p_tournament_id;

  select count(*)::integer
  into v_entrant_count
  from public.tournament_entries
  where tournament_entries.tournament_id::text = p_tournament_id;

  return query
  select p_tournament_id, v_entrant_count, v_current_round_id, 1;
end;
$$;
