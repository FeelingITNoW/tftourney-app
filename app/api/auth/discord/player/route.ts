import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getAppOrigin } from "../../../../../lib/app-url";

export const runtime = "nodejs";

function safeReturnTo(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/player";
}

// Player sign-in with Discord. Unlike the organizer manager-invite flow
// (/api/auth/discord), this only requests `identify`: a player only needs a
// stable Discord identity the bot can message and match to a lobby, not the
// ability to join a guild or receive a manager role.
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
  // Reuse the already-registered /api/auth/discord/callback redirect URI. A new
  // path would require adding another redirect URL in the Discord Developer
  // Portal, which is what produced "invalid oauth2 redirect_uri". The callback
  // tells the player flow apart by the tftourney-player-discord-state cookie set
  // below, which the organizer manager flow never sets.
  authorize.searchParams.set("redirect_uri", `${appUrl.replace(/\/$/, "")}/api/auth/discord/callback`);
  authorize.searchParams.set("scope", "identify");
  authorize.searchParams.set("state", state);
  const response = NextResponse.redirect(authorize);
  const cookieBase = {
    httpOnly: true,
    maxAge: 600,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/discord",
  };
  response.cookies.set("tftourney-player-discord-state", state, cookieBase);
  response.cookies.set("tftourney-player-discord-return-to", safeReturnTo(url.searchParams.get("returnTo")), cookieBase);
  return response;
}