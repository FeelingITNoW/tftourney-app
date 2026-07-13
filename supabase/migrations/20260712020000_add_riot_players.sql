create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  riot_puuid text,
  game_name text,
  tag_line text,
  game_tag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.players
  add column if not exists riot_puuid text,
  add column if not exists game_name text,
  add column if not exists tag_line text,
  add column if not exists game_tag text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists players_riot_puuid_unique_idx
  on public.players(riot_puuid);

create unique index if not exists players_riot_id_unique_idx
  on public.players(lower(game_name), lower(tag_line));

alter table public.tournament_players
  add column if not exists riot_puuid text;

create unique index if not exists tournament_players_unique_riot_puuid_idx
  on public.tournament_players(tournament_id, riot_puuid)
  where riot_puuid is not null;
