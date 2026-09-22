import { NextResponse } from "next/server";
import { appRedirect, getAppOrigin } from "../../../../../../lib/app-url";
import { errorLogFields } from "../../../../../../lib/auth/log";
import {
  completePlayerDiscordSignIn,
  PLAYER_DISCORD_CALLBACK_PATH,
  PLAYER_DISCORD_COOKIE_PATH,
  PLAYER_DISCORD_RETURN_TO_COOKIE,
  PLAYER_DISCORD_STATE_COOKIE,
  safePlayerReturnPath,
} from "../../../../../../lib/auth/player-discord-oauth";
import {
  PLAYER_SESSION_COOKIE_NAME,
  playerSessionSecretAvailable,
} from "../../../../../../lib/auth/player-session";

export const runtime = "nodejs";

function cookieValue(request: Request, name: string): string {
  return request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] ?? "";
}

function clearPlayerCookies(response: NextResponse): NextResponse {
  for (const name of [PLAYER_DISCORD_STATE_COOKIE, PLAYER_DISCORD_RETURN_TO_COOKIE]) {
    response.cookies.set(name, "", { maxAge: 0, path: PLAYER_DISCORD_COOKIE_PATH });
  }
  return response;
}

function playerFail(request: Request, message: string): NextResponse {
  const returnTo = safePlayerReturnPath(cookieValue(request, PLAYER_DISCORD_RETURN_TO_COOKIE));
  return clearPlayerCookies(appRedirect("/player/signin", { playerAuthError: message, returnTo }, { fallback: "/player/signin" }));
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const expectedState = cookieValue(request, PLAYER_DISCORD_STATE_COOKIE);
  if (!code || !state || !expectedState || state !== expectedState) return playerFail(request, "discord_state_invalid");
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return playerFail(request, "discord_oauth_not_configured");
  if (!playerSessionSecretAvailable()) return playerFail(request, "player_session_not_configured");
  const appUrl = getAppOrigin(request);
  const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${appUrl.replace(/\/$/, "")}${PLAYER_DISCORD_CALLBACK_PATH}`,
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
  } catch (error) {
    console.error("[discord-auth] Player account linking failed", errorLogFields(error));
    return playerFail(request, "player_account_failed");
  }
  // Always land on the player home after signing in. Redirecting to a stored
  // returnTo previously produced a blank white screen when the stored path
  // resolved somewhere the freshly-set player session was not honored; the
  // player home is the canonical post-sign-in destination.
  const response = clearPlayerCookies(appRedirect("/player", { playerAuth: "success" }));
  response.cookies.set(PLAYER_SESSION_COOKIE_NAME, completed.sessionToken, completed.sessionCookie);
  return response;
}

export async function GET(request: Request): Promise<Response> {
  try {
    return await handle(request);
  } catch (error) {
    console.error("[discord-auth] Player callback failed unexpectedly", errorLogFields(error));
    return playerFail(request, "discord_oauth_failed");
  }
}
