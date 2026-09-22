import { NextResponse } from "next/server";
import { appRedirect, getAppOrigin } from "../../../../../../lib/app-url";
import { errorLogFields } from "../../../../../../lib/auth/log";
import {
  PLAYER_DISCORD_CALLBACK_PATH,
  PLAYER_DISCORD_COOKIE_PATH,
  PLAYER_DISCORD_MODE_COOKIE,
  PLAYER_DISCORD_RETURN_TO_COOKIE,
  PLAYER_DISCORD_STATE_COOKIE,
  PLAYER_PENDING_DISCORD_COOKIE,
  PLAYER_PENDING_DISCORD_COOKIE_PATH,
  resolvePlayerDiscordSignIn,
  safePlayerReturnPath,
} from "../../../../../../lib/auth/player-discord-oauth";
import {
  PLAYER_SESSION_COOKIE_NAME,
  playerSessionFromToken,
  playerSessionSecretAvailable,
} from "../../../../../../lib/auth/player-session";

export const runtime = "nodejs";

function cookieValue(request: Request, name: string): string {
  return request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] ?? "";
}

function clearPlayerDiscordCookies(response: NextResponse): NextResponse {
  for (const name of [PLAYER_DISCORD_STATE_COOKIE, PLAYER_DISCORD_RETURN_TO_COOKIE, PLAYER_DISCORD_MODE_COOKIE]) {
    response.cookies.set(name, "", { maxAge: 0, path: PLAYER_DISCORD_COOKIE_PATH });
  }
  return response;
}

function playerFail(request: Request, message: string): NextResponse {
  const returnTo = safePlayerReturnPath(cookieValue(request, PLAYER_DISCORD_RETURN_TO_COOKIE));
  return clearPlayerDiscordCookies(
    appRedirect("/player/signin", { playerAuthError: message, returnTo }, { fallback: "/player/signin" }),
  );
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

  const mode = cookieValue(request, PLAYER_DISCORD_MODE_COOKIE) === "link" ? "link" : "signin";
  const activeSession = playerSessionFromToken(cookieValue(request, PLAYER_SESSION_COOKIE_NAME) || undefined);
  // mode=link only ever comes from an already-signed-in player's "Link
  // Discord" button (see /player/account). If their session expired mid-flow,
  // fail explicitly -- before spending a Discord round trip -- instead of
  // silently falling back to a plain sign-in/signup, which would link (or
  // create) the wrong account without the player realizing their original
  // intent was ignored.
  if (mode === "link" && !activeSession) return playerFail(request, "discord_link_requires_session");

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

  let resolution;
  try {
    resolution = await resolvePlayerDiscordSignIn(
      { id: discordUser.id, username: discordUser.username, avatar: discordUser.avatar },
      { mode, activeSession },
    );
  } catch (error) {
    console.error("[discord-auth] Player Discord resolution failed", errorLogFields(error));
    return playerFail(request, "player_account_failed");
  }

  if (resolution.kind === "linked") {
    return clearPlayerDiscordCookies(appRedirect("/player/account", { accountUpdated: "discord" }));
  }

  if (resolution.kind === "needs-signup") {
    const response = clearPlayerDiscordCookies(appRedirect("/player/signup", { playerAuth: "discord" }));
    response.cookies.set(PLAYER_PENDING_DISCORD_COOKIE, resolution.pendingToken, {
      httpOnly: true,
      maxAge: 600,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: PLAYER_PENDING_DISCORD_COOKIE_PATH,
    });
    return response;
  }

  // Always land on the player home after signing in. Redirecting to a stored
  // returnTo previously produced a blank white screen when the stored path
  // resolved somewhere the freshly-set player session was not honored; the
  // player home is the canonical post-sign-in destination.
  const response = clearPlayerDiscordCookies(appRedirect("/player", { playerAuth: "success" }));
  response.cookies.set(PLAYER_SESSION_COOKIE_NAME, resolution.sessionToken, resolution.sessionCookie);
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
