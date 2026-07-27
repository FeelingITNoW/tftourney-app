import { NextResponse } from "next/server";
import { encryptGoogleRefreshToken } from "../../../../../lib/sheets/crypto";
import { supabaseRestRequest } from "../../../../../lib/db/supabase-rest/api";

export const runtime = "nodejs";

function cookieValue(request: Request, name: string): string | undefined {
  return request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
}

function safeReturnPath(value: string | undefined): string {
  if (!value) return "/";
  try {
    const decoded = decodeURIComponent(value);
    return decoded.startsWith("/") && !decoded.startsWith("//") && !decoded.includes("\\")
      ? decoded
      : "/";
  } catch {
    return "/";
  }
}

function returnUrl(request: Request, params: Record<string, string> = {}): URL {
  const returnTo = safeReturnPath(cookieValue(request, "tftourney-google-return-to"));
  const destination = new URL(returnTo, request.url);
  for (const [key, value] of Object.entries(params)) destination.searchParams.set(key, value);
  return destination;
}

function authRedirect(request: Request, params: Record<string, string>): NextResponse {
  const response = NextResponse.redirect(returnUrl(request, params));
  response.cookies.set("tftourney-google-pkce", "", { maxAge: 0, path: "/api/auth/google" });
  response.cookies.set("tftourney-google-return-to", "", { maxAge: 0, path: "/api/auth/google" });
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const verifier = cookieValue(request, "tftourney-google-pkce");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const encryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return authRedirect(request, { authError: "google_token_encryption_missing" });
  }
  if (!code || !verifier || !supabaseUrl || !supabaseKey) {
    return authRedirect(request, { authError: "google_oauth_failed" });
  }

  const tokenResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: { apikey: supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ auth_code: code, code_verifier: decodeURIComponent(verifier) }),
  });
  if (!tokenResponse.ok) return authRedirect(request, { authError: "google_oauth_failed" });
  const token = (await tokenResponse.json()) as { access_token?: string; refresh_token?: string; provider_refresh_token?: string; user?: { id: string; email?: string } };
  if (!token.access_token || !token.refresh_token || !token.provider_refresh_token) {
    return authRedirect(request, { authError: "google_refresh_token_missing" });
  }

  const userResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${token.access_token}` },
  });
  if (!userResponse.ok) return authRedirect(request, { authError: "google_user_failed" });
  const user = (await userResponse.json()) as { id: string; email?: string };
  const existing = await supabaseRestRequest<Array<{ id: string | number }>>("users", {
    query: { select: "id", auth_user_id: `eq.${user.id}`, limit: "1" },
  });
  const unclaimed = existing[0]
    ? []
    : await supabaseRestRequest<Array<{ id: string | number }>>("users", {
        query: { select: "id", auth_user_id: "is.null", order: "id.asc", limit: "1" },
      });
  const userRow = existing[0]
    ? existing
    : unclaimed[0]
      ? await supabaseRestRequest<Array<{ id: string | number }>>("users", {
          method: "PATCH",
          query: { id: `eq.${unclaimed[0].id}`, select: "id" },
          prefer: "return=representation",
          body: { auth_user_id: user.id, email: user.email ?? `${user.id}@invalid.local` },
        })
      : await supabaseRestRequest<Array<{ id: string | number }>>("users", {
          method: "POST",
          prefer: "return=representation",
          body: { auth_user_id: user.id, email: user.email ?? `${user.id}@invalid.local` },
        });
  const hostUserId = userRow[0]?.id;
  if (hostUserId === undefined) return authRedirect(request, { authError: "user_profile_failed" });

  await supabaseRestRequest("organizer_google_connections", {
    method: "POST",
    query: { on_conflict: "user_id" },
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      user_id: hostUserId,
      google_email: user.email ?? null,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
      encrypted_refresh_token: encryptGoogleRefreshToken(token.provider_refresh_token, encryptionKey),
      status: "connected",
      last_error_code: null,
      last_error_message: null,
    },
  });

  const response = authRedirect(request, { authSuccess: "google" });
  response.cookies.set("tftourney-session", encodeURIComponent(JSON.stringify({ accessToken: token.access_token, refreshToken: token.refresh_token })), {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return response;
}
