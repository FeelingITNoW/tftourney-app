-- Player accounts: a persistent identity for tournament participants that is
-- separate from organizer `users`. A player account links a Discord identity
-- (the bot's contact + lobby-thread membership key) and a verified Riot
-- identity (puuid + GameName#TAG) so sign-up can be seamless on both the web
-- and the Discord bot.
--
-- Registrations keep their existing flat display_name/riot_puuid/discord_user_id
-- columns for backwards compatibility; player_account_id is added alongside them
-- so lobby membership can be verified against a stable identity.

create table if not exists public.player_accounts (
  id bigint generated always as identity not null,
  auth_user_id uuid unique,
  discord_user_id text unique,
  discord_username text,
  discord_avatar text,
  riot_puuid text,
  riot_game_tag text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_accounts_pkey primary key (id)
);

create unique index if not exists player_accounts_auth_user_id_idx
  on public.player_accounts(auth_user_id)
  where auth_user_id is not null;

create unique index if not exists player_accounts_discord_user_id_idx
  on public.player_accounts(discord_user_id)
  where discord_user_id is not null;

create index if not exists player_accounts_riot_puuid_idx
  on public.player_accounts(riot_puuid)
  where riot_puuid is not null;

alter table public.player_accounts enable row level security;

alter table public.tournament_registrations
  add column if not exists player_account_id bigint references public.player_accounts(id) on delete set null;

create unique index if not exists tournament_registrations_player_account_idx
  on public.tournament_registrations(tournament_id, player_account_id)
  where player_account_id is not null;

-- Idempotently claim the player account for a Discord user. The first caller
-- creates it; later callers refresh the cached username/avatar and receive the
-- same row, so a re-run can never fork a Discord identity into two accounts.
create or replace function public.claim_or_create_player_by_discord(
  p_discord_user_id text,
  p_discord_username text default null,
  p_discord_avatar text default null
)
returns table(
  id bigint,
  auth_user_id uuid,
  discord_user_id text,
  discord_username text,
  discord_avatar text,
  riot_puuid text,
  riot_game_tag text,
  email text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player public.player_accounts%rowtype;
begin
  if p_discord_user_id is null or length(trim(p_discord_user_id)) = 0 then
    raise exception 'A Discord user id is required.';
  end if;

  select * into v_player
  from public.player_accounts
  where discord_user_id = p_discord_user_id
  for update;

  if not found then
    insert into public.player_accounts(discord_user_id, discord_username, discord_avatar)
    values (p_discord_user_id, nullif(trim(coalesce(p_discord_username, '')), ''), nullif(trim(coalesce(p_discord_avatar, '')), ''))
    on conflict (discord_user_id) do update
      set discord_username = coalesce(excluded.discord_username, public.player_accounts.discord_username),
          discord_avatar = coalesce(excluded.discord_avatar, public.player_accounts.discord_avatar)
    returning * into v_player;
  else
    update public.player_accounts
    set discord_username = coalesce(nullif(trim(coalesce(p_discord_username, '')), ''), discord_username),
        discord_avatar = coalesce(nullif(trim(coalesce(p_discord_avatar, '')), ''), discord_avatar),
        updated_at = now()
    where id = v_player.id
    returning * into v_player;
  end if;

  return query select v_player.id, v_player.auth_user_id, v_player.discord_user_id,
    v_player.discord_username, v_player.discord_avatar, v_player.riot_puuid,
    v_player.riot_game_tag, v_player.email, v_player.created_at, v_player.updated_at;
end;
$$;

-- Attach (or replace) a verified Riot identity on a player account. Refuses to
-- move a puuid that is already linked to a different account so one Riot
-- account cannot be claimed twice.
create or replace function public.link_riot_account_to_player(
  p_player_account_id text,
  p_riot_puuid text,
  p_riot_game_tag text
)
returns table(
  id bigint,
  auth_user_id uuid,
  discord_user_id text,
  discord_username text,
  discord_avatar text,
  riot_puuid text,
  riot_game_tag text,
  email text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player public.player_accounts%rowtype;
  v_conflict_id public.player_accounts.id%type;
begin
  select * into v_player
  from public.player_accounts
  where id::text = p_player_account_id
  for update;
  if not found then raise exception 'Player account was not found.'; end if;

  if p_riot_puuid is null or length(trim(p_riot_puuid)) = 0 then
    raise exception 'A Riot puuid is required.';
  end if;

  select id into v_conflict_id
  from public.player_accounts
  where riot_puuid = p_riot_puuid and id <> v_player.id
  limit 1;
  if found then raise exception 'That Riot account is already linked to another player.'; end if;

  update public.player_accounts
  set riot_puuid = p_riot_puuid,
      riot_game_tag = nullif(trim(coalesce(p_riot_game_tag, '')), ''),
      updated_at = now()
  where id = v_player.id
  returning * into v_player;

  return query select v_player.id, v_player.auth_user_id, v_player.discord_user_id,
    v_player.discord_username, v_player.discord_avatar, v_player.riot_puuid,
    v_player.riot_game_tag, v_player.email, v_player.created_at, v_player.updated_at;
end;
$$;

revoke execute on function public.claim_or_create_player_by_discord(text, text, text) from public, anon, authenticated;
revoke execute on function public.link_riot_account_to_player(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_or_create_player_by_discord(text, text, text) to service_role;
grant execute on function public.link_riot_account_to_player(text, text, text) to service_role;

notify pgrst, 'reload schema';