// Player Discord sign-in now reuses the already-registered
// /api/auth/discord/callback redirect URI (see lib/auth/player-discord-oauth.ts),
// because Discord rejects an unregistered redirect URI with
// "invalid oauth2 redirect_uri". This path is kept as a thin re-export so any
// in-flight player authorization that still points here keeps working.
export const runtime = "nodejs";
export { GET } from "../../callback/route";