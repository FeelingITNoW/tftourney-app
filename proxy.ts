import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  decodeSessionCookie,
  encodeSessionCookie,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "./lib/auth/session";

type RefreshedToken = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

function needsRefresh(expiresAt: number | undefined): boolean {
  return expiresAt !== undefined && expiresAt <= Math.floor(Date.now() / 1000) + 60;
}

async function refreshSession(session: ReturnType<typeof decodeSessionCookie>) {
  if (!session?.refreshToken) return null;
  const config = supabaseConfig();
  if (!config) return null;
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: config.key, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
    cache: "no-store",
  });
  if (!response.ok) return null;
  const token = (await response.json()) as RefreshedToken;
  if (!token.access_token) return null;
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? session.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + (token.expires_in ?? 3600),
  };
}

export async function proxy(request: NextRequest) {
  // Several /api/auth/* routes (Discord account-link callback, the Discord
  // bot-install OAuth flow and its callback) read the session cookie to
  // identify the current host via getHostUserId(request) -- they need a
  // refreshed token exactly like any page does. A session cookie only
  // exists here at all once someone is signed in, and needsRefresh() below
  // is a no-op otherwise, so there's no reason to special-case this prefix:
  // doing so silently treated a signed-in host as logged out whenever their
  // access token was near/past expiry (e.g. the "Add bot to your Discord
  // server" button would bounce them to /signin and back with no visible
  // error, since /signin itself sits outside this prefix and refreshes the
  // session before redirecting home).
  const session = decodeSessionCookie(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!session || !needsRefresh(session.expiresAt)) return NextResponse.next();

  const refreshed = await refreshSession(session);
  if (!refreshed) {
    request.cookies.delete(SESSION_COOKIE_NAME);
    const response = NextResponse.next({ request });
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  request.cookies.set(SESSION_COOKIE_NAME, encodeSessionCookie(refreshed));
  const response = NextResponse.next({ request });
  response.cookies.set(SESSION_COOKIE_NAME, encodeSessionCookie(refreshed), sessionCookieOptions());
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
