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
  if (request.nextUrl.pathname.startsWith("/api/auth/")) return NextResponse.next();

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
