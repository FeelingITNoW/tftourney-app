import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { appRedirect, getAppOrigin } from "../../../../lib/app-url";
import { errorLogFields } from "../../../../lib/auth/log";

export const runtime = "nodejs";

function base64Url(value: Buffer): string {
  return value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeReturnPath(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value
    : "/";
}

function authIntent(value: string | null): "signin" | "sheets" {
  return value === "sheets" ? "sheets" : "signin";
}

async function handle(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return Response.json({ error: "Supabase Auth is not configured." }, { status: 503 });

  const returnTo = safeReturnPath(requestUrl.searchParams.get("returnTo"));
  const intent = authIntent(requestUrl.searchParams.get("intent"));
  if (intent === "sheets" && !process.env.GOOGLE_TOKEN_ENCRYPTION_KEY) {
    return appRedirect(returnTo, { authError: "google_token_encryption_missing" });
  }

  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const callback = new URL("/api/auth/google/callback", getAppOrigin(request)).toString();
  const authorize = new URL(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/authorize`);
  authorize.searchParams.set("provider", "google");
  authorize.searchParams.set("redirect_to", callback);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  if (intent === "sheets") {
    authorize.searchParams.set("scopes", "https://www.googleapis.com/auth/drive.file");
    authorize.searchParams.set("access_type", "offline");
    authorize.searchParams.set("prompt", "consent");
  }

  const response = NextResponse.redirect(authorize);
  response.cookies.set("tftourney-google-pkce", verifier, {
    httpOnly: true,
    maxAge: 600,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
  });
  response.cookies.set("tftourney-google-return-to", returnTo, {
    httpOnly: true,
    maxAge: 600,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
  });
  response.cookies.set("tftourney-google-intent", intent, {
    httpOnly: true,
    maxAge: 600,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
  });
  return response;
}

export async function GET(request: Request): Promise<Response> {
  try {
    return await handle(request);
  } catch (error) {
    console.error("[google-auth] Authorize failed unexpectedly", errorLogFields(error));
    return appRedirect("/signin", { authError: "google_oauth_failed" });
  }
}
