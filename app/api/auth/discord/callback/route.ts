import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getAppOrigin } from "../../../../../lib/app-url";
import { getHostUserId } from "../../../../../lib/auth/session";
import { supabaseRestRequest } from "../../../../../lib/db/supabase-rest/api";
import { getTournamentDiscordConfig } from "../../../../../lib/discord/api";
import {
  completePlayerDiscordSignIn,
  PLAYER_DISCORD_RETURN_TO_COOKIE,
  PLAYER_DISCORD_STATE_COOKIE,
  safePlayerReturnPath,
} from "../../../../../lib/auth/player-discord-oauth";
import { PLAYER_SESSION_COOKIE_NAME } from "../../../../../lib/auth/player-session";

export const runtime = "nodejs";

function cookieValue(request: Request, name: string): string {
  return request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] ?? "";
}

function clearPlayerCookies(response: NextResponse): NextResponse {
  for (const name of [PLAYER_DISCORD_STATE_COOKIE, PLAYER_DISCORD_RETURN_TO_COOKIE]) {
    response.cookies.set(name, "", { maxAge: 0, path: "/api/auth/discord" });
  }
  return response;
}

function playerFail(request: Request, message: string): Response {
  const returnTo = safePlayerReturnPath(cookieValue(request, PLAYER_DISCORD_RETURN_TO_COOKIE));
  const destination = new URL("/player/signin", request.url);
  destination.searchParams.set("playerAuthError", message);
  destination.searchParams.set("returnTo", returnTo);
  return clearPlayerCookies(NextResponse.redirect(destination));
}

// Player sign-in reuses this route's already-registered redirect URI (adding a
// second one requires a Discord Developer Portal change and otherwise fails
// with "invalid oauth2 redirect_uri"). The player authorize route is the only
// one that sets the player state cookie, so its presence selects this branch.
async function handlePlayerCallback(request: Request, url: URL): Promise<Response> {
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const expectedState = cookieValue(request, PLAYER_DISCORD_STATE_COOKIE);
  if (!code || !state || !expectedState || state !== expectedState) return playerFail(request, "discord_state_invalid");
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return playerFail(request, "discord_oauth_not_configured");
  if (!process.env.PLAYER_SESSION_SECRET) return playerFail(request, "player_session_not_configured");
  const appUrl = getAppOrigin(request);
  const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${appUrl.replace(/\/$/, "")}/api/auth/discord/callback`,
    }),
  });
  if (!tokenResponse.ok) return playerFail(request, "discord_oauth_failed");
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) return playerFail(request, "discord_oauth_failed");
  const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userResponse.ok) return playerFail(request, "discord_identity_failed");
  const discordUser = (await userResponse.json()) as { id?: string; username?: string; avatar?: string | null };
  if (!discordUser.id) return playerFail(request, "discord_identity_failed");

  let completed;
  try {
    completed = await completePlayerDiscordSignIn({ id: discordUser.id, username: discordUser.username, avatar: discordUser.avatar });
  } catch {
    return playerFail(request, "player_account_failed");
  }
  // Always land on the player home after signing in. Redirecting to a stored
  // returnTo previously produced a blank white screen when the stored path
  // resolved somewhere the freshly-set player session was not honored; the
  // player home is the canonical post-sign-in destination.
  const destination = new URL("/player", request.url);
  destination.searchParams.set("playerAuth", "success");
  const response = clearPlayerCookies(NextResponse.redirect(destination));
  response.cookies.set(PLAYER_SESSION_COOKIE_NAME, completed.sessionToken, completed.sessionCookie);
  return response;
}

function clearCookies(response: NextResponse): NextResponse {
  for (const name of ["tftourney-discord-state", "tftourney-discord-invite", "tftourney-discord-return-to"]) response.cookies.set(name, "", { maxAge: 0, path: "/api/auth/discord" });
  return response;
}

function fail(request: Request, message: string): Response {
  const response = NextResponse.redirect(new URL(`/signin?authError=${encodeURIComponent(message)}`, request.url));
  return clearCookies(response);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (cookieValue(request, PLAYER_DISCORD_STATE_COOKIE)) return handlePlayerCallback(request, url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const expectedState = cookieValue(request, "tftourney-discord-state");
  const inviteToken = cookieValue(request, "tftourney-discord-invite");
  const hostUserId = await getHostUserId(request);
  if (!code || !state || !expectedState || state !== expectedState || !inviteToken || !hostUserId) return fail(request, "discord_invite_auth_required");
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!clientId || !clientSecret || !botToken) return fail(request, "discord_oauth_not_configured");
  const appUrl = getAppOrigin(request);
  const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", code, redirect_uri: `${appUrl.replace(/\/$/, "")}/api/auth/discord/callback` }),
  });
  if (!tokenResponse.ok) return fail(request, "discord_oauth_failed");
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) return fail(request, "discord_oauth_failed");
  const userResponse = await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (!userResponse.ok) return fail(request, "discord_identity_failed");
  const discordUser = await userResponse.json() as { id?: string };
  if (!discordUser.id) return fail(request, "discord_identity_failed");
  const hash = createHash("sha256").update(inviteToken).digest("hex");
  const inviteRows = await supabaseRestRequest<Array<{ id: string; tournament_id: string }>>("tournament_manager_invites", {
    query: { select: "id,tournament_id", token_hash: `eq.${hash}`, claimed_at: "is.null", revoked_at: "is.null", expires_at: `gt.${new Date().toISOString()}`, limit: "1" },
  });
  const invite = inviteRows[0];
  if (!invite) return fail(request, "discord_invite_invalid");
  const config = await getTournamentDiscordConfig(invite.tournament_id);
  if (!config?.managerRoleId) return fail(request, "discord_tournament_not_provisioned");

  const addMember = await fetch(`https://discord.com/api/v10/guilds/${config.guildId}/members/${discordUser.id}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: token.access_token }),
  });
  if (!addMember.ok && addMember.status !== 204) return fail(request, "discord_guild_join_failed");
  const roleResponse = await fetch(`https://discord.com/api/v10/guilds/${config.guildId}/members/${discordUser.id}/roles/${config.managerRoleId}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!roleResponse.ok) return fail(request, "discord_role_assignment_failed");
  const claimed = await supabaseRestRequest<Array<{ tournament_id: string }>>("tournament_manager_invites", {
    method: "PATCH",
    query: { token_hash: `eq.${hash}`, claimed_at: "is.null", revoked_at: "is.null" },
    prefer: "return=representation",
    body: { claimed_at: new Date().toISOString(), claimed_by_user_id: hostUserId, claimed_discord_user_id: discordUser.id },
  });
  if (!claimed[0]) return fail(request, "discord_invite_already_claimed");
  await supabaseRestRequest("tournament_managers", {
    method: "POST",
    query: { on_conflict: "tournament_id,user_id" },
    prefer: "resolution=merge-duplicates,return=minimal",
    body: { tournament_id: invite.tournament_id, user_id: hostUserId, discord_user_id: discordUser.id, revoked_at: null },
  });
  const destination = new URL(`/tournaments/${invite.tournament_id}?discordManager=granted`, request.url);
  return clearCookies(NextResponse.redirect(destination));
}
