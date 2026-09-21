import { NextResponse } from "next/server";
import { sessionCookieOptions } from "../../../../lib/auth/session";
import {
  PLAYER_SESSION_COOKIE_NAME,
  playerSessionCookieOptions,
} from "../../../../lib/auth/player-session";

function safeReturnPath(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const destination = new URL(safeReturnPath(requestUrl.searchParams.get("returnTo")), request.url);
  const response = NextResponse.redirect(destination);
  response.cookies.set("tftourney-session", "", { ...sessionCookieOptions(), maxAge: 0 });
  // Clear the stateless player cookie too, so a shared "sign out" link also
  // ends a player session and not just the organizer one.
  response.cookies.set(PLAYER_SESSION_COOKIE_NAME, "", { ...playerSessionCookieOptions(), maxAge: 0 });
  return response;
}
