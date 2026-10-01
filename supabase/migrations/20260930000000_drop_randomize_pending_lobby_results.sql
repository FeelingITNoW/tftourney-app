-- randomize_pending_lobby_results was a testing-only RPC (fills every
-- pending lobby in the active block with random placements) used by a
-- "Randomize pending block (test)" button in the tournament UI. That button
-- and its server action have been removed; drop the function along with it.
-- It was already locked down to service_role only in
-- 20260926000003_lock_down_ungranted_rpcs.sql, so this is a clean removal
-- with no grants to revoke first.
drop function if exists public.randomize_pending_lobby_results(text, text);
