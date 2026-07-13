alter table public.tournament_players
  add column if not exists riot_puuid text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournament_players'
      and column_name = 'player_id'
  ) then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'tournament_players'
        and column_name = 'display_name'
    ) then
      update public.tournament_players
      set display_name = coalesce(display_name, player_id::text)
      where display_name is null;
    end if;

    alter table public.tournament_players
      drop column player_id;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournament_players'
      and column_name = 'display_name'
  ) then
    alter table public.tournament_players
      alter column display_name drop not null;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tournament_players'
      and column_name = 'discord_id'
  ) then
    alter table public.tournament_players
      alter column discord_id drop not null;
  end if;
end $$;

drop table if exists public.players cascade;

create unique index if not exists tournament_players_unique_riot_puuid_idx
  on public.tournament_players(tournament_id, riot_puuid)
  where riot_puuid is not null;
