-- Lets an already-signed-in player (via username/password) link or unlink a
-- Discord identity from their account page, mirroring the existing
-- link_riot_account_to_player conflict check. Also adds an account-keyed
-- check-in RPC: check_in_discord_player (20260914000000) only matches a
-- registration by discord_user_id, so a player who never linked Discord could
-- register for a tournament and then have no way to check in. This is the
-- web check-in path; the bot's Discord-keyed check-in is unchanged.

create or replace function public.link_discord_account_to_player(
  p_player_account_id text,
  p_discord_user_id text,
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
  v_player public.player_accounts%rowtype;
  v_conflict_id public.player_accounts.id%type;
begin
  select pa.* into v_player from public.player_accounts pa where pa.id::text = p_player_account_id for update;
  if not found then raise exception 'Player account was not found.'; end if;

  if p_discord_user_id is null or length(trim(p_discord_user_id)) = 0 then
    raise exception 'A Discord user id is required.';
  end if;

  select pa.id into v_conflict_id
  from public.player_accounts pa
  where pa.discord_user_id = p_discord_user_id and pa.id <> v_player.id
  limit 1;
  if found then raise exception 'That Discord account is already linked to another player.'; end if;

  update public.player_accounts pa
  set discord_user_id = p_discord_user_id,
      discord_username = coalesce(nullif(trim(coalesce(p_discord_username, '')), ''), pa.discord_username),
      discord_avatar = coalesce(nullif(trim(coalesce(p_discord_avatar, '')), ''), pa.discord_avatar),
      updated_at = now()
  where pa.id = v_player.id
  returning pa.* into v_player;

  return query select v_player.id, v_player.auth_user_id, v_player.username, v_player.discord_user_id,
    v_player.discord_username, v_player.discord_avatar, v_player.riot_puuid, v_player.riot_game_tag,
    v_player.email, v_player.created_at, v_player.updated_at, v_player.last_signed_in_at;
end;
$$;

create or replace function public.unlink_discord_account_from_player(
  p_player_account_id text
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
  v_player public.player_accounts%rowtype;
begin
  select pa.* into v_player from public.player_accounts pa where pa.id::text = p_player_account_id for update;
  if not found then raise exception 'Player account was not found.'; end if;

  update public.player_accounts pa
  set discord_user_id = null,
      discord_username = null,
      discord_avatar = null,
      updated_at = now()
  where pa.id = v_player.id
  returning pa.* into v_player;

  return query select v_player.id, v_player.auth_user_id, v_player.username, v_player.discord_user_id,
    v_player.discord_username, v_player.discord_avatar, v_player.riot_puuid, v_player.riot_game_tag,
    v_player.email, v_player.created_at, v_player.updated_at, v_player.last_signed_in_at;
end;
$$;

-- Web check-in, keyed on the durable player account id instead of Discord.
-- Same guards as check_in_discord_player (20260914000000): check-in must be
-- open, and the registration must be registered/waitlisted.
create or replace function public.check_in_player_account(
  p_tournament_id text,
  p_player_account_id text
)
returns table(registration_id text, display_name text, checked_in_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tournament public.tournaments%rowtype;
  v_registration public.tournament_registrations%rowtype;
begin
  select * into v_tournament from public.tournaments
  where id::text = p_tournament_id for update;
  if not found then raise exception 'Tournament was not found.'; end if;
  if v_tournament.check_in_status <> 'open' then raise exception 'Check-in is not currently open.'; end if;

  select * into v_registration from public.tournament_registrations
  where tournament_id = v_tournament.id and player_account_id::text = p_player_account_id
    and registration_status in ('registered', 'waitlisted')
  for update;
  if not found then raise exception 'You must sign up before checking in.'; end if;

  update public.tournament_registrations registrations
  set checked_in_at = coalesce(registrations.checked_in_at, now()), updated_at = now()
  where registrations.id = v_registration.id
  returning * into v_registration;

  return query select v_registration.id::text, v_registration.display_name, v_registration.checked_in_at;
end;
$$;

revoke execute on function public.link_discord_account_to_player(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.unlink_discord_account_from_player(text) from public, anon, authenticated;
revoke execute on function public.check_in_player_account(text, text) from public, anon, authenticated;
grant execute on function public.link_discord_account_to_player(text, text, text, text) to service_role;
grant execute on function public.unlink_discord_account_from_player(text) to service_role;
grant execute on function public.check_in_player_account(text, text) to service_role;

notify pgrst, 'reload schema';
