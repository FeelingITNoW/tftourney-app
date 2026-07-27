-- Multi-game rounds reuse lobby numbers for each game. The legacy schema
-- allowed only one lobby number per round, which makes starting a two-game
-- tournament fail on the second game.

alter table if exists public.lobbies
  add column if not exists game_number integer;

update public.lobbies
set game_number = 1
where game_number is null;

alter table if exists public.lobbies
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

alter table if exists public.lobbies
  drop constraint if exists lobbies_unique_lobby_number;

alter table if exists public.lobbies
  drop constraint if exists lobbies_unique_round_number;

drop index if exists public.lobbies_unique_lobby_number;
drop index if exists public.lobbies_unique_round_number_idx;
drop index if exists public.lobbies_unique_round_game_number_idx;

create unique index if not exists lobbies_unique_round_game_number_idx
  on public.lobbies(round_id, game_number, lobby_number);
