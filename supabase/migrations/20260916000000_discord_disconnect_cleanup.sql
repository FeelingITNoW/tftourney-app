-- Lets a host choose, when disconnecting a tournament from Discord, whether
-- the bot archives (locks read-only, renames) or permanently deletes the
-- category/channels/role it provisioned. The bot picks up the request the
-- next time it polls /api/internal/discord/cleanup (state stays "disabled"
-- immediately -- the actual Discord-side cleanup happens asynchronously and
-- is marked done via cleanup_completed_at).

alter table public.tournament_discord_configs
  add column if not exists cleanup_action text check (cleanup_action in ('archive', 'delete')),
  add column if not exists cleanup_requested_at timestamptz,
  add column if not exists cleanup_completed_at timestamptz;

notify pgrst, 'reload schema';
