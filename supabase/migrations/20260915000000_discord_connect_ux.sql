-- Adds a human-readable guild name so the tournament page can show "Connected
-- to <server name>" instead of a raw Discord snowflake. Populated by the bot
-- on each provisioning tick (bot/index.ts provisionTournament).

alter table public.tournament_discord_configs
  add column if not exists guild_name text;

notify pgrst, 'reload schema';
