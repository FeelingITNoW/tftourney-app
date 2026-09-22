-- Player accounts become a first-class identity: a player can create their
-- own account with a username and password instead of being required to sign
-- in with Discord. Discord and Riot stay optional links on the account (see
-- 20260922000001_link_discord_to_player.sql for the Discord link/unlink and
-- account-keyed check-in). A bot-created account (via
-- claim_or_create_player_by_discord) still has a null username/password_hash
-- until the player signs in on the web and claims it with set_player_credentials.

alter table public.player_accounts
  add column if not exists username text,
  add column if not exists password_hash text,
  add column if not exists last_signed_in_at timestamptz;

create unique index if not exists player_accounts_username_idx
  on public.player_accounts (lower(username))
  where username is not null;

create unique index if not exists player_accounts_email_idx
  on public.player_accounts (lower(email))
  where email is not null;

-- Creates a brand-new player account from a username/password, optionally
-- carrying a Discord identity the player is signing up with (the
-- needs-signup branch of the player Discord OAuth callback). Raises a
-- distinct message per conflicting field so the sign-up form can show a
-- field-specific error instead of a generic failure.
create or replace function public.create_player_account(
  p_username text,
  p_password_hash text,
  p_email text default null,
  p_discord_user_id text default null,
  p_discord_username text default null,
  p_discord_avatar text default null
)
returns table(
  id bigint,
  auth_user_id uuid,
  username text,
  discord_user_id text,
  discord_username text,
  discord_avatar text,
  riot_puuid text,
  riot_game_tag text,
  email text,
  created_at timestamptz,
  updated_at timestamptz,
  last_signed_in_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text;
  v_player public.player_accounts%rowtype;
begin
  v_username := nullif(trim(coalesce(p_username, '')), '');
  if v_username is null then
    raise exception 'A username is required.';
  end if;
  if p_password_hash is null or length(trim(p_password_hash)) = 0 then
    raise exception 'A password is required.';
  end if;

  if exists (select 1 from public.player_accounts pa where lower(pa.username) = lower(v_username)) then
    raise exception 'That username is already taken.';
  end if;

  if p_discord_user_id is not null and exists (
    select 1 from public.player_accounts pa where pa.discord_user_id = p_discord_user_id
  ) then
    raise exception 'That Discord account is already linked to another player.';
  end if;

  insert into public.player_accounts as pa (
    username, password_hash, email, discord_user_id, discord_username, discord_avatar, last_signed_in_at
  )
  values (
    v_username, p_password_hash, nullif(trim(coalesce(p_email, '')), ''),
    p_discord_user_id, nullif(trim(coalesce(p_discord_username, '')), ''), nullif(trim(coalesce(p_discord_avatar, '')), ''),
    now()
  )
  returning pa.* into v_player;

  return query select v_player.id, v_player.auth_user_id, v_player.username, v_player.discord_user_id,
    v_player.discord_username, v_player.discord_avatar, v_player.riot_puuid, v_player.riot_game_tag,
    v_player.email, v_player.created_at, v_player.updated_at, v_player.last_signed_in_at;
end;
$$;

-- Looks a player account up by username, including the password hash, so
-- sign-in can verify credentials. Distinct from every other player_accounts
-- read helper (which never return password_hash) -- callers must not expose
-- this row shape outside the sign-in service.
create or replace function public.find_player_account_by_username(
  p_username text
)
returns table(
  id bigint,
  auth_user_id uuid,
  username text,
  password_hash text,
  discord_user_id text,
  discord_username text,
  discord_avatar text,
  riot_puuid text,
  riot_game_tag text,
  email text,
  created_at timestamptz,
  updated_at timestamptz,
  last_signed_in_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select pa.id, pa.auth_user_id, pa.username, pa.password_hash, pa.discord_user_id,
    pa.discord_username, pa.discord_avatar, pa.riot_puuid, pa.riot_game_tag,
    pa.email, pa.created_at, pa.updated_at, pa.last_signed_in_at
  from public.player_accounts pa
  where lower(pa.username) = lower(p_username)
  limit 1;
$$;

-- Records a successful sign-in. Kept separate from find_player_account_by_username
-- (a stable read function) so a read can never have the side effect of writing.
create or replace function public.touch_player_account_last_signed_in(
  p_player_account_id text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.player_accounts pa
  set last_signed_in_at = now()
  where pa.id::text = p_player_account_id;
$$;

-- Sets or changes a player's username/password/email. Used both to claim a
-- credential-less (bot-created, Discord-only) account and to let a player
-- change their password later. A null argument leaves that column untouched
-- so a password-only change does not require re-sending the username.
create or replace function public.set_player_credentials(
  p_player_account_id text,
  p_username text default null,
  p_password_hash text default null,
  p_email text default null
)
returns table(
  id bigint,
  auth_user_id uuid,
  username text,
  discord_user_id text,
  discord_username text,
  discord_avatar text,
  riot_puuid text,
  riot_game_tag text,
  email text,
  created_at timestamptz,
  updated_at timestamptz,
  last_signed_in_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_username text;
  v_email text;
  v_player public.player_accounts%rowtype;
begin
  select pa.* into v_player from public.player_accounts pa where pa.id::text = p_player_account_id for update;
  if not found then raise exception 'Player account was not found.'; end if;

  if p_username is not null then
    v_username := nullif(trim(p_username), '');
    if v_username is null then raise exception 'A username is required.'; end if;
    if exists (
      select 1 from public.player_accounts pa
      where lower(pa.username) = lower(v_username) and pa.id <> v_player.id
    ) then
      raise exception 'That username is already taken.';
    end if;
  end if;

  if p_email is not null then
    v_email := nullif(trim(p_email), '');
    if v_email is not null and exists (
      select 1 from public.player_accounts pa
      where lower(pa.email) = lower(v_email) and pa.id <> v_player.id
    ) then
      raise exception 'That email is already in use by another player.';
    end if;
  end if;

  update public.player_accounts pa
  set username = coalesce(v_username, pa.username),
      password_hash = coalesce(p_password_hash, pa.password_hash),
      email = case when p_email is not null then v_email else pa.email end,
      updated_at = now()
  where pa.id = v_player.id
  returning pa.* into v_player;

  return query select v_player.id, v_player.auth_user_id, v_player.username, v_player.discord_user_id,
    v_player.discord_username, v_player.discord_avatar, v_player.riot_puuid, v_player.riot_game_tag,
    v_player.email, v_player.created_at, v_player.updated_at, v_player.last_signed_in_at;
end;
$$;

revoke execute on function public.create_player_account(text, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.find_player_account_by_username(text) from public, anon, authenticated;
revoke execute on function public.touch_player_account_last_signed_in(text) from public, anon, authenticated;
revoke execute on function public.set_player_credentials(text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_player_account(text, text, text, text, text, text) to service_role;
grant execute on function public.find_player_account_by_username(text) to service_role;
grant execute on function public.touch_player_account_last_signed_in(text) to service_role;
grant execute on function public.set_player_credentials(text, text, text, text) to service_role;

notify pgrst, 'reload schema';
