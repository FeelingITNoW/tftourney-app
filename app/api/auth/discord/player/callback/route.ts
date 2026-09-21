import { NextResponse } from "next/server";
import { claimOrCreatePlayerByDiscord } from "../../../../../../lib/db/players/api";
import {
  createPlayerSessionToken,
  PLAYER_SESSION_COOKIE_NAME,
  playerSessionCookieOptions,
} from "../../../../../../lib/auth/player-session";

export const runtime = "nodejs";

function cookieValue(request: Request, name: string): string {
  return request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1] ?? "";
}

const CLEAR_COOKIES = ["tftourney-player-discord-state", "tftourney-player-discord-return-to"];

function clearCookies(response: NextResponse): NextResponse {
  for (const name of CLEAR_COOKIES) {
    response.cookies.set(name, "", { maxAge: 0, path: "/api/auth/discord/player" });
  }
  return response;
}

function safeReturnPath(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    return decoded.startsWith("/") && !decoded.startsWith("//") && !decoded.includes("\\") ? decoded : "/player";
  } catch {
    return "/player";
  }
}

function fail(request: Request, error: string): Response {
  const returnTo = safeReturnPath(cookieValue(request, "tftourney-player-discord-return-to"));
  const destination = new URL("/player/signin", request.url);
  destination.searchParams.set("playerAuthError", error);
  destination.searchParams.set("returnTo", returnTo);
  return clearCookies(NextResponse.redirect(destination));
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const expectedState = cookieValue(request, "tftourney-player-discord-state");
  const returnTo = safeReturnPath(cookieValue(request, "tftourney-player-discord-return-to"));
  if (!code || !state || !expectedState || state !== expectedState) {
    return fail(request, "discord_state_invalid");
  }
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const sessionSecret = process.env.PLAYER_SESSION_SECRET;
  if (!clientId || !clientSecret) return fail(request, "discord_oauth_not_configured");
  if (!sessionSecret) return fail(request, "player_session_not_configured");
  const appUrl = process.env.TFTOURNEY_APP_URL ?? url.origin;
  const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${appUrl.replace(/\/$/, "")}/api/auth/discord/player/callback`,
    }),
  });
  if (!tokenResponse.ok) return fail(request, "discord_oauth_failed");
  const token = (await tokenResponse.json()) as { access_token?: string };
  if (!token.access_token) return fail(request, "discord_oauth_failed");
  const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userResponse.ok) return fail(request, "discord_identity_failed");
  const discordUser = (await userResponse.json()) as { id?: string; username?: string; avatar?: string | null };
  if (!discordUser.id) return fail(request, "discord_identity_failed");

  let player;
  try {
    player = await claimOrCreatePlayerByDiscord({
      discordUserId: discordUser.id,
      discordUsername: discordUser.username ?? null,
      discordAvatar: discordUser.avatar ?? null,
    });
  } catch {
    return fail(request, "player_account_failed");
  }

  const destination = new URL(returnTo.startsWith("/") ? returnTo : "/player", request.url);
  destination.searchParams.set("playerAuth", "success");
  const response = clearCookies(NextResponse.redirect(destination));
  response.cookies.set(
    PLAYER_SESSION_COOKIE_NAME,
    createPlayerSessionToken({ playerAccountId: player.id, discordUserId: player.discordUserId }),
    playerSessionCookieOptions(),
  );
  return response;
}