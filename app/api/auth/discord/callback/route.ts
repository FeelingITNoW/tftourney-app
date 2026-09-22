import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { appRedirect, getAppOrigin } from "../../../../../lib/app-url";
import { errorLogFields } from "../../../../../lib/auth/log";
import { getHostUserId } from "../../../../../lib/auth/session";
import { supabaseRestRequest } from "../../../../../lib/db/supabase-rest/api";
import { getTournamentDiscordConfig } from "../../../../../lib/discord/api";

export const runtime = "nodejs";

// Organizer manager-invite claim callback. Player sign-in has its own
// redirect URI and route (/api/auth/discord/player/callback) so the two
// flows can never be confused by a shared cookie.

function cookieValue(request: Request, name: string): string {
  return request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] ?? "";
}

function clearCookies(response: NextResponse): NextResponse {
  for (const name of ["tftourney-discord-state", "tftourney-discord-invite", "tftourney-discord-return-to"]) response.cookies.set(name, "", { maxAge: 0, path: "/api/auth/discord" });
  return response;
}

function fail(request: Request, message: string): NextResponse {
  return clearCookies(appRedirect("/signin", { authError: message }));
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
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
  return clearCookies(appRedirect(`/tournaments/${invite.tournament_id}`, { discordManager: "granted" }));
}

export async function GET(request: Request): Promise<Response> {
  try {
    return await handle(request);
  } catch (error) {
    console.error("[discord-auth] Manager invite callback failed unexpectedly", errorLogFields(error));
    return fail(request, "discord_callback_failed");
  }
}
