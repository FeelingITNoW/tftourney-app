-- Extends the player dashboard read model with the account's own
-- profile fields (username/email/Discord/Riot) and, per tournament, whether
-- the player's registration is checked in and whether they actually played
-- (a tournament_participants row exists for their registration). The account
-- page and the new web check-in button both read this in one round trip
-- rather than adding separate queries.

create or replace function public.get_player_dashboard_view_model(
  p_player_account_id text
)
returns table(view_model jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'player_account_id', accounts.id::text,
    'username', accounts.username,
    'email', accounts.email,
    'discord_user_id', accounts.discord_user_id,
    'discord_username', accounts.discord_username,
    'discord_avatar', accounts.discord_avatar,
    'riot_puuid', accounts.riot_puuid,
    'riot_game_tag', accounts.riot_game_tag,
    'tournaments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tournaments.id::text,
        'name', tournaments.name,
        'status', tournaments.status,
        'check_in_status', coalesce(tournaments.check_in_status, 'not_started'),
        'registered_player_count', (select count(*)::int from public.tournament_registrations counted where counted.tournament_id = tournaments.id and counted.registration_status = 'registered'),
        'max_players', tournaments.max_players,
        'registered', exists (
          select 1 from public.tournament_registrations mine
          where mine.tournament_id = tournaments.id
            and mine.player_account_id = accounts.id
            and mine.registration_status in ('registered', 'waitlisted', 'entered')
        ),
        'registration_status', (
          select mine.registration_status
          from public.tournament_registrations mine
          where mine.tournament_id = tournaments.id and mine.player_account_id = accounts.id
          order by mine.created_at asc, mine.id asc
          limit 1
        ),
        'checked_in', exists (
          select 1 from public.tournament_registrations mine
          where mine.tournament_id = tournaments.id
            and mine.player_account_id = accounts.id
            and mine.checked_in_at is not null
        ),
        'participated', exists (
          select 1 from public.tournament_registrations mine
          join public.tournament_participants participants
            on participants.registration_id = mine.id and participants.tournament_id = mine.tournament_id
          where mine.tournament_id = tournaments.id and mine.player_account_id = accounts.id
        ),
        'created_at', tournaments.created_at
      ) order by tournaments.created_at desc, tournaments.id desc)
      from public.tournaments tournaments
      where tournaments.status in ('accepting_players', 'in_progress', 'completed')
    ), '[]'::jsonb)
  )
  from public.player_accounts accounts
  where accounts.id::text = p_player_account_id;
$$;

revoke execute on function public.get_player_dashboard_view_model(text) from public, anon, authenticated;
grant execute on function public.get_player_dashboard_view_model(text) to service_role;

notify pgrst, 'reload schema';
