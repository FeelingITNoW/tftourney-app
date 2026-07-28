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
  return encodeURIComponent(JSON.stringify(session));
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
}

function localOrganizer(): OrganizerSession {
  return {
    authUserId: "local",
    hostUserId: LOCAL_HOST_USER_ID,
    email: "Local organizer",
    isLocal: true,
  };
}

export async function getOrganizerSessionFromRequest(request: Request): Promise<OrganizerSession | null> {
  const rawSession = sessionFromRequest(request);
  if (!rawSession) return process.env.TFT_REQUIRE_AUTH === "false" ? localOrganizer() : null;
  return organizerFromStoredSession(rawSession);
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

export async function getHostUserId(request: Request): Promise<string | null> {
  const organizer = await getOrganizerSessionFromRequest(request);
  return organizer?.hostUserId ?? null;
}
