import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseRestRequest } from "../db/supabase-rest/api";

export const SESSION_COOKIE_NAME = "tftourney-session";
const LOCAL_HOST_USER_ID = "1";

export type OrganizerSession = {
  authUserId: string;
  hostUserId: string;
  email: string;
  isLocal: boolean;
};

export type StoredSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

type SupabaseUser = {
  id: string;
  email?: string;
};

type OrganizerRow = {
  id: string | number;
  email: string;
  auth_user_id?: string | null;
};

function sessionValueFromCookieHeader(rawCookie: string | null): string | undefined {
  return rawCookie?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`))?.[1];
}

// Next's own cookie APIs (cookies(), NextRequest.cookies, NextResponse.cookies) already
// encodeURIComponent a cookie's value when writing it and decodeURIComponent it when
// reading it back (see stringifyCookie/parseCookie in @edge-runtime/cookies), so a
// value read through those APIs arrives here already decoded -- decodeURIComponent is
// a harmless no-op on it (there's no "%" left to unescape). A value read straight off
// the raw `Cookie` header (sessionFromRequest below) has NOT been through that
// automatic decode, so it still needs exactly one here. Keeping exactly one
// decodeURIComponent call handles both sources correctly -- but only because
// encodeSessionCookie below does NOT also encode. It used to, which put two layers of
// encoding on the wire (its own, plus Next's automatic one from cookies().set()); the
// cookies()-based read path silently canceled both layers out, while the raw-header
// path only had this single decodeURIComponent to undo them, leaving one layer behind
// and JSON.parse failing on it -- which silently treated a valid, signed-in session as
// absent in every Route Handler that read the session via the raw header (the Discord
// "Add bot to your Discord server" flow among them).
export function decodeSessionCookie(value: string | undefined): StoredSession | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<StoredSession>;
    if (typeof parsed.accessToken !== "string" || parsed.accessToken.length === 0) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : undefined,
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : undefined,
    };
  } catch {
    return null;
  }
}

export function encodeSessionCookie(session: StoredSession): string {
  return JSON.stringify(session);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export function sessionFromRequest(request: Request): StoredSession | null {
  return decodeSessionCookie(sessionValueFromCookieHeader(request.headers.get("cookie")));
}

export function sessionFromCookieValue(value: string | undefined): StoredSession | null {
  return decodeSessionCookie(value);
}

function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}

async function getSupabaseUser(accessToken: string): Promise<SupabaseUser | null> {
  const config = supabaseConfig();
  if (!config) return null;
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.key, Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  return (await response.json()) as SupabaseUser;
}

async function getOrganizerForAuthUser(user: SupabaseUser): Promise<OrganizerRow | null> {
  const rows = await supabaseRestRequest<OrganizerRow[]>("users", {
    query: { select: "id,email,auth_user_id", auth_user_id: `eq.${user.id}`, limit: "1" },
  });
  if (rows[0]) return rows[0];

  if (!user.email) return null;
  const emailRows = await supabaseRestRequest<OrganizerRow[]>("users", {
    query: { select: "id,email,auth_user_id", email: `eq.${user.email}`, limit: "1" },
  });
  return emailRows[0] ?? null;
}

async function organizerFromStoredSession(session: StoredSession): Promise<OrganizerSession | null> {
  // getSupabaseUser and getOrganizerForAuthUser call supabaseRestRequest, which
  // throws on any non-2xx response (DatabaseRequestError) or on a network
  // failure. Uncaught, that surfaced as an opaque HTTP 500 on every page that
  // resolves a session (/, /signin, /dashboard) instead of the page simply
  // rendering as signed-out. Treat any lookup failure as "not signed in".
  try {
    const user = await getSupabaseUser(session.accessToken);
    if (!user) return null;
    const organizer = await getOrganizerForAuthUser(user);
    if (!organizer) return null;
    return {
      authUserId: user.id,
      hostUserId: String(organizer.id),
      email: organizer.email || user.email || "Google organizer",
      isLocal: false,
    };
  } catch (error) {
    console.error("[organizer-session] Organizer lookup failed; treating session as signed out", {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : undefined,
    });
    return null;
  }
}

function localOrganizer(): OrganizerSession {
  return {
    authUserId: "local",
    hostUserId: LOCAL_HOST_USER_ID,
    email: "Local organizer",
    isLocal: true,
  };
}

export async function getOrganizerSession(): Promise<OrganizerSession | null> {
  const rawSession = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = decodeSessionCookie(rawSession);
  if (!session) return process.env.TFT_REQUIRE_AUTH === "false" ? localOrganizer() : null;
  return organizerFromStoredSession(session);
}

export async function requireOrganizer(returnTo = "/dashboard"): Promise<OrganizerSession> {
  const organizer = await getOrganizerSession();
  if (organizer) return organizer;
  redirect(`/signin?returnTo=${encodeURIComponent(returnTo)}`);
}

export async function getOrganizerSessionFromRequest(request: Request): Promise<OrganizerSession | null> {
  const rawSession = sessionFromRequest(request);
  if (!rawSession) return process.env.TFT_REQUIRE_AUTH === "false" ? localOrganizer() : null;
  return organizerFromStoredSession(rawSession);
}

export async function getHostUserId(request: Request): Promise<string | null> {
  const organizer = await getOrganizerSessionFromRequest(request);
  return organizer?.hostUserId ?? null;
}
