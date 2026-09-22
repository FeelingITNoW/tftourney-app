import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getAppOrigin } from "../../../../../lib/app-url";
import {
  PLAYER_DISCORD_CALLBACK_PATH,
  PLAYER_DISCORD_COOKIE_PATH,
  PLAYER_DISCORD_RETURN_TO_COOKIE,
  PLAYER_DISCORD_STATE_COOKIE,
} from "../../../../../lib/auth/player-discord-oauth";

export const runtime = "nodejs";

function safeReturnTo(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/player";
}

// Player sign-in with Discord. Unlike the organizer manager-invite flow
// (/api/auth/discord), this only requests `identify`: a player only needs a
// stable Discord identity the bot can message and match to a lobby, not the
// ability to join a guild or receive a manager role. It also uses its own
// callback route/redirect URI (PLAYER_DISCORD_CALLBACK_PATH) so it can never
// be confused with the manager-invite flow.
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const state = randomBytes(32).toString("base64url");
  const appUrl = getAppOrigin(request);
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId || !process.env.DISCORD_CLIENT_SECRET) {
    return Response.json({ error: "Discord OAuth is not configured." }, { status: 503 });
  }
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", `${appUrl.replace(/\/$/, "")}${PLAYER_DISCORD_CALLBACK_PATH}`);
  authorize.searchParams.set("scope", "identify");
  authorize.searchParams.set("state", state);
  const response = NextResponse.redirect(authorize);
  const cookieBase = {
    httpOnly: true,
    maxAge: 600,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: PLAYER_DISCORD_COOKIE_PATH,
  };
  response.cookies.set(PLAYER_DISCORD_STATE_COOKIE, state, cookieBase);
  response.cookies.set(PLAYER_DISCORD_RETURN_TO_COOKIE, safeReturnTo(url.searchParams.get("returnTo")), cookieBase);
  return response;
}
