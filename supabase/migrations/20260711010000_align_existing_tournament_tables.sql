create extension if not exists pgcrypto;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournaments'
      and column_name = 'max_players'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournaments'
      and column_name = 'player_count'
  ) then
    alter table public.tournaments rename column max_players to player_count;
  end if;
end $$;

alter table public.tournaments
  add column if not exists host_user_id bigint not null default 1,
  add column if not exists player_count integer,
  add column if not exists format_id text not null default 'default',
  add column if not exists format_config jsonb not null default '{}'::jsonb,
  add column if not exists has_started boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

update public.tournaments
set player_count = 8
where player_count is null;

alter table public.tournaments
  alter column player_count set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tournaments_player_count_check'
      and conrelid = 'public.tournaments'::regclass
  ) then
    alter table public.tournaments
      add constraint tournaments_player_count_check check (
        player_count >= 8
        and player_count <= 512
        and player_count % 8 = 0
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tournaments_status_check'
      and conrelid = 'public.tournaments'::regclass
  ) then
    alter table public.tournaments
      add constraint tournaments_status_check check (
        status in ('accepting_players', 'in_progress', 'completed', 'cancelled')
      );
  end if;
end $$;

alter table public.tournament_players
  add column if not exists display_name text,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournament_players'
      and column_name = 'player_id'
  ) then
    update public.tournament_players
    set display_name = coalesce(display_name, player_id::text, id::text)
    where display_name is null;
  else
    update public.tournament_players
    set display_name = coalesce(display_name, id::text)
    where display_name is null;
  end if;
end $$;

alter table public.tournament_players
  alter column display_name set not null;

create index if not exists tournament_players_tournament_id_idx
  on public.tournament_players(tournament_id);

create unique index if not exists tournament_players_unique_display_name_idx
  on public.tournament_players(tournament_id, lower(display_name));

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tournaments_set_updated_at on public.tournaments;

create trigger tournaments_set_updated_at
before update on public.tournaments
for each row
execute function public.set_updated_at();
