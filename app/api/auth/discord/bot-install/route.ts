import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getAppOrigin } from "../../../../../lib/app-url";
import { getHostUserId } from "../../../../../lib/auth/session";
import { assertTournamentHost } from "../../../../../lib/db/tournaments/api";

export const runtime = "nodejs";

// Bitwise OR of: MANAGE_CHANNELS (1<<4), VIEW_CHANNEL (1<<10), SEND_MESSAGES (1<<11),
// ATTACH_FILES (1<<15), MANAGE_ROLES (1<<28), MANAGE_THREADS (1<<34),
// CREATE_PRIVATE_THREADS (1<<36), SEND_MESSAGES_IN_THREADS (1<<38) -- the same
// permission set documented in docs/discord-bot.md's manual installation steps.
// Computed as a plain constant (rather than importing discord.js's
// PermissionsBitField) so this route doesn't pull the Gateway/WS stack -- and its
// optional native zlib-sync addon -- into the Next.js server bundle.
const BOT_INVITE_PERMISSIONS = "361045724176";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const tournamentId = url.searchParams.get("tournamentId") ?? "";
  const returnTo = tournamentId ? `/tournaments/${tournamentId}` : "/";
  if (!tournamentId) return NextResponse.redirect(new URL("/", request.url));

  const hostUserId = await getHostUserId(request);
  if (!hostUserId) {
    return NextResponse.redirect(new URL(`/signin?returnTo=${encodeURIComponent(returnTo)}`, request.url));
  }
  try {
    await assertTournamentHost(tournamentId, hostUserId);
  } catch {
    return NextResponse.redirect(
      new URL(`${returnTo}?discordError=${encodeURIComponent("Only the tournament host can connect Discord.")}`, request.url),
    );
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(
      new URL(`${returnTo}?discordError=${encodeURIComponent("Discord is not configured.")}`, request.url),
    );
  }

  const appUrl = getAppOrigin(request);
  const state = randomBytes(32).toString("base64url");
  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("scope", "bot applications.commands");
  authorize.searchParams.set("permissions", BOT_INVITE_PERMISSIONS);
  authorize.searchParams.set("redirect_uri", `${appUrl.replace(/\/$/, "")}/api/auth/discord/bot-install/callback`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("state", state);

  const response = NextResponse.redirect(authorize);
  response.cookies.set("tftourney-discord-bot-state", state, {
    httpOnly: true,
    maxAge: 600,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/discord/bot-install",
  });
  response.cookies.set("tftourney-discord-bot-tournament", tournamentId, {
    httpOnly: true,
    maxAge: 600,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/discord/bot-install",
  });
  return response;
}
