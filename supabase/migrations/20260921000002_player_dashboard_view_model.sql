-- Player dashboard read model: one round trip returning every tournament a
-- player can see plus which ones the given player account has already signed up
-- for. Mirrors the route-scoped read-model pattern used elsewhere (single
-- service-role JSON function) so the player page does not fan out per row.

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
    'riot_game_tag', accounts.riot_game_tag,
    'tournaments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tournaments.id::text,
        'name', tournaments.name,
        'status', tournaments.status,
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