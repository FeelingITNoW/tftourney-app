-- Expose the durable player account id on each reconcile lobby participant so
-- the Discord bot (and any back-end verification) can confirm a member belongs
-- to the lobby by account identity, not just by a per-tournament registration
-- row. This replaces get_discord_reconcile_view_model with an identical payload
-- plus a new `playerAccountId` field on every active lobby participant.
--
-- The bot reads participants by index and ignores unknown fields, so adding a
-- field is backwards compatible with a bot deployed before this migration.

create or replace function public.get_discord_reconcile_view_model()
returns table(view_model jsonb)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('tournaments', coalesce(jsonb_agg(jsonb_build_object(
    'tournamentId', tournaments.id::text,
    'name', tournaments.name,
    'status', tournaments.status,
    'checkInStatus', coalesce(tournaments.check_in_status, 'not_started'),
    'registeredCount', (select count(*)::int from public.tournament_registrations registrations where registrations.tournament_id = tournaments.id and registrations.registration_status = 'registered'),
    'checkedInCount', (select count(*)::int from public.tournament_registrations registrations where registrations.tournament_id = tournaments.id and registrations.checked_in_at is not null and registrations.registration_status in ('registered', 'waitlisted')),
    'config', jsonb_build_object('tournament_id', configs.tournament_id::text, 'guild_id', configs.guild_id, 'category_id', configs.category_id, 'signup_channel_id', configs.signup_channel_id, 'checkin_channel_id', configs.checkin_channel_id, 'score_channel_id', configs.score_channel_id, 'manager_role_id', configs.manager_role_id, 'signup_message_id', configs.signup_message_id, 'checkin_message_id', configs.checkin_message_id, 'state', configs.state, 'last_error', configs.last_error, 'score_cooldown_seconds', configs.score_cooldown_seconds),
    'activeLobbies', coalesce((select jsonb_agg(jsonb_build_object('id', lobbies.id::text, 'roundId', lobbies.round_id::text, 'gameNumber', lobbies.game_number, 'lobbyNumber', lobbies.lobby_number, 'participants', coalesce((select jsonb_agg(jsonb_build_object('discordUserId', nullif(registrations.discord_user_id, ''), 'displayName', coalesce(participants.display_name_at_start, 'Unknown player'), 'playerAccountId', registrations.player_account_id::text) order by lobby_participants.slot_number, lobby_participants.id) from public.lobby_participants lobby_participants join public.tournament_participants participants on participants.id = lobby_participants.participant_id and participants.tournament_id = tournaments.id left join public.tournament_registrations registrations on registrations.id = participants.registration_id where lobby_participants.lobby_id = lobbies.id), '[]'::jsonb)) order by lobbies.game_number, lobbies.lobby_number, lobbies.id) from public.lobbies lobbies join public.rounds active_rounds on active_rounds.id = lobbies.round_id and active_rounds.tournament_id = tournaments.id where active_rounds.status = 'active'), '[]'::jsonb),
    'threads', coalesce((select jsonb_agg(jsonb_build_object('roundId', lobby_threads.round_id::text, 'lobbyNumber', lobby_threads.lobby_number, 'threadId', lobby_threads.thread_id, 'acceptedImageCount', coalesce(lobby_threads.accepted_image_count, 0), 'state', lobby_threads.state, 'lastGameNumber', lobby_threads.last_game_number) order by lobby_threads.round_id, lobby_threads.lobby_number) from public.discord_lobby_threads lobby_threads join public.rounds rounds on rounds.id = lobby_threads.round_id and rounds.tournament_id = tournaments.id), '[]'::jsonb)
  ) order by tournaments.name, tournaments.id), '[]'::jsonb))
  from public.tournament_discord_configs configs
  join public.tournaments tournaments on tournaments.id = configs.tournament_id
  where configs.state <> 'disabled'
    and (tournaments.status not in ('completed', 'cancelled') or exists (
      select 1 from public.discord_lobby_threads pending_threads
      join public.rounds pending_rounds on pending_rounds.id = pending_threads.round_id
      where pending_rounds.tournament_id = tournaments.id and pending_threads.state = 'active'));
$$;

revoke execute on function public.get_discord_reconcile_view_model() from public, anon, authenticated;
grant execute on function public.get_discord_reconcile_view_model() to service_role;

notify pgrst, 'reload schema';