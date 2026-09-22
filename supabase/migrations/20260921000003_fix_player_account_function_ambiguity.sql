-- claim_or_create_player_by_discord and link_riot_account_to_player both use
-- `returns table(id bigint, ..., discord_user_id text, ...)`. In plpgsql, every
-- column named in a RETURNS TABLE clause is implicitly declared as an OUT
-- variable inside the function body. The original bodies referenced columns
-- like `discord_user_id`, `id`, and `riot_puuid` unqualified, which collided
-- with those OUT variables and made every call fail with:
--   ERROR: column reference "discord_user_id" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
-- This broke player Discord sign-in entirely -- the very first call
-- (claim_or_create_player_by_discord) always errored, so the callback route
-- caught the failure and bounced the player back to the sign-in page instead
-- of creating their account. Qualifying every column reference with the
-- `pa` table alias removes the ambiguity.

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

  select pa.* into v_player
  from public.player_accounts pa
  where pa.discord_user_id = p_discord_user_id
  for update;

  if not found then
    insert into public.player_accounts as pa (discord_user_id, discord_username, discord_avatar)
    values (p_discord_user_id, nullif(trim(coalesce(p_discord_username, '')), ''), nullif(trim(coalesce(p_discord_avatar, '')), ''))
    on conflict (discord_user_id) do update
      set discord_username = coalesce(excluded.discord_username, pa.discord_username),
          discord_avatar = coalesce(excluded.discord_avatar, pa.discord_avatar)
    returning pa.* into v_player;
  else
    update public.player_accounts pa
    set discord_username = coalesce(nullif(trim(coalesce(p_discord_username, '')), ''), pa.discord_username),
        discord_avatar = coalesce(nullif(trim(coalesce(p_discord_avatar, '')), ''), pa.discord_avatar),
        updated_at = now()
    where pa.id = v_player.id
    returning pa.* into v_player;
  end if;

  return query select v_player.id, v_player.auth_user_id, v_player.discord_user_id,
    v_player.discord_username, v_player.discord_avatar, v_player.riot_puuid,
    v_player.riot_game_tag, v_player.email, v_player.created_at, v_player.updated_at;
end;
$$;

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
  select pa.* into v_player
  from public.player_accounts pa
  where pa.id::text = p_player_account_id
  for update;
  if not found then raise exception 'Player account was not found.'; end if;

  if p_riot_puuid is null or length(trim(p_riot_puuid)) = 0 then
    raise exception 'A Riot puuid is required.';
  end if;

  select pa.id into v_conflict_id
  from public.player_accounts pa
  where pa.riot_puuid = p_riot_puuid and pa.id <> v_player.id
  limit 1;
  if found then raise exception 'That Riot account is already linked to another player.'; end if;

  update public.player_accounts pa
  set riot_puuid = p_riot_puuid,
      riot_game_tag = nullif(trim(coalesce(p_riot_game_tag, '')), ''),
      updated_at = now()
  where pa.id = v_player.id
  returning pa.* into v_player;

  return query select v_player.id, v_player.auth_user_id, v_player.discord_user_id,
    v_player.discord_username, v_player.discord_avatar, v_player.riot_puuid,
    v_player.riot_game_tag, v_player.email, v_player.created_at, v_player.updated_at;
end;
$$;

notify pgrst, 'reload schema';
