import { NextResponse } from "next/server";
import { appRedirect } from "../../../../../lib/app-url";
import { errorLogFields } from "../../../../../lib/auth/log";
import { encryptGoogleRefreshToken } from "../../../../../lib/sheets/crypto";
import { supabaseRestRequest } from "../../../../../lib/db/supabase-rest/api";
import { claimOrCreateOrganizer } from "../../../../../lib/db/users/api";
import {
  encodeSessionCookie,
  sessionCookieOptions,
} from "../../../../../lib/auth/session";

export const runtime = "nodejs";

function cookieValue(request: Request, name: string): string | undefined {
  return request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
}

function intentValue(request: Request): "signin" | "sheets" {
  return cookieValue(request, "tftourney-google-intent") === "sheets" ? "sheets" : "signin";
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

function clearGoogleCookies(response: NextResponse): NextResponse {
  response.cookies.set("tftourney-google-pkce", "", { maxAge: 0, path: "/api/auth/google" });
  response.cookies.set("tftourney-google-return-to", "", { maxAge: 0, path: "/api/auth/google" });
  response.cookies.set("tftourney-google-intent", "", { maxAge: 0, path: "/api/auth/google" });
  return response;
}

function authRedirect(request: Request, params: Record<string, string>): NextResponse {
  const returnTo = safeReturnPath(cookieValue(request, "tftourney-google-return-to"));
  return clearGoogleCookies(appRedirect(returnTo, params));
}

function failureRedirect(request: Request, error: string): NextResponse {
  if (intentValue(request) === "sheets") return authRedirect(request, { authError: error });
  const returnTo = safeReturnPath(cookieValue(request, "tftourney-google-return-to"));
  return clearGoogleCookies(appRedirect("/signin", { authError: error, returnTo }));
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const verifier = cookieValue(request, "tftourney-google-pkce");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const encryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  const intent = intentValue(request);
  if (intent === "sheets" && !encryptionKey) {
    return failureRedirect(request, "google_token_encryption_missing");
  }
  if (!code || !verifier || !supabaseUrl || !supabaseKey) {
    return failureRedirect(request, "google_oauth_failed");
  }

  const tokenResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: { apikey: supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ auth_code: code, code_verifier: decodeURIComponent(verifier) }),
  });
  if (!tokenResponse.ok) return failureRedirect(request, "google_oauth_failed");
  const token = (await tokenResponse.json()) as { access_token?: string; refresh_token?: string; provider_refresh_token?: string; user?: { id: string; email?: string } };
  if (!token.access_token || !token.refresh_token || (intent === "sheets" && !token.provider_refresh_token)) {
    return failureRedirect(request, intent === "sheets" ? "google_refresh_token_missing" : "google_oauth_failed");
  }

  const userResponse = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${token.access_token}` },
  });
  if (!userResponse.ok) return failureRedirect(request, "google_user_failed");
  const user = (await userResponse.json()) as { id: string; email?: string };
  let organizer: Awaited<ReturnType<typeof claimOrCreateOrganizer>>;
  try {
    organizer = await claimOrCreateOrganizer({
      authUserId: user.id,
      email: user.email ?? `${user.id}@invalid.local`,
    });
  } catch (error) {
    console.error("[google-auth] Organizer profile linking failed", errorLogFields(error));
    return failureRedirect(request, "user_profile_failed");
  }

  if (intent === "sheets") {
    try {
      await supabaseRestRequest("organizer_google_connections", {
        method: "POST",
        query: { on_conflict: "user_id" },
        prefer: "resolution=merge-duplicates,return=minimal",
        body: {
          user_id: organizer.id,
          google_email: user.email ?? null,
          scopes: ["https://www.googleapis.com/auth/drive.file"],
          encrypted_refresh_token: encryptGoogleRefreshToken(token.provider_refresh_token as string, encryptionKey as string),
          status: "connected",
          last_error_code: null,
          last_error_message: null,
        },
      });
    } catch (error) {
      console.error("[google-auth] Google connection save failed", errorLogFields(error));
      return failureRedirect(request, "user_profile_failed");
    }
  }

  const response = authRedirect(request, { authSuccess: intent === "sheets" ? "google_sheets" : "google" });
  response.cookies.set("tftourney-session", encodeSessionCookie({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  }), sessionCookieOptions());
  return response;
}

export async function GET(request: Request): Promise<Response> {
  try {
    return await handle(request);
  } catch (error) {
    console.error("[google-auth] Callback failed unexpectedly", errorLogFields(error));
    return failureRedirect(request, "google_oauth_failed");
  }
}
