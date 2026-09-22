import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const PLAYER_SESSION_COOKIE_NAME = "tftourney-player-session";
export const PLAYER_SESSION_DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

export type PlayerSessionPayload = {
  playerAccountId: string;
  discordUserId: string | null;
  expiresAt: number;
};

export type PlayerSessionOptions = {
  secret?: string;
  ttlSeconds?: number;
  now?: number;
};

export type PlayerSession = {
  playerAccountId: string;
  discordUserId: string | null;
};

// Label for the derived-key HMAC below. Versioned so a future change to the
// derivation (a different label, or dropping this fallback) can be
// distinguished from today's keys without ambiguity.
const DERIVED_SECRET_LABEL = "tftourney:player-session:v1";

let warnedMissingPlayerSessionSecret = false;

// PLAYER_SESSION_SECRET is the preferred signing key, but requiring it as a
// hard prerequisite means every new environment (a fresh Railway service, a
// contributor's local setup) silently breaks player sign-in until someone
// remembers to provision one more secret. Fall back to deriving a key from
// SUPABASE_SERVICE_ROLE_KEY, which the app cannot run without anyway, so
// sign-in works out of the box anywhere the app itself is configured.
//
// This must derive ONLY from SUPABASE_SERVICE_ROLE_KEY, never from
// SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY (unlike the `??` chains
// in lib/db/supabase-rest/api.ts and lib/auth/session.ts) -- the anon key is
// public, and a signing key derived from a public value is forgeable by
// anyone who can read it out of the client bundle.
//
// Trade-off: rotating SUPABASE_SERVICE_ROLE_KEY invalidates outstanding
// player session cookies when no explicit PLAYER_SESSION_SECRET is set.
// That's acceptable -- players just sign in again -- but it's why an
// explicit secret remains preferred and recommended in the docs.
function derivedSecret(): string | null {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return null;
  if (!warnedMissingPlayerSessionSecret) {
    warnedMissingPlayerSessionSecret = true;
    console.warn(
      "[player-session] PLAYER_SESSION_SECRET is not set; deriving a player session signing key from " +
        "SUPABASE_SERVICE_ROLE_KEY instead. Set PLAYER_SESSION_SECRET explicitly (openssl rand -base64 32) " +
        "so player sessions survive a service-role-key rotation.",
    );
  }
  return createHmac("sha256", serviceRoleKey).update(DERIVED_SECRET_LABEL).digest("base64url");
}

function resolveSecret(options: PlayerSessionOptions = {}): string | null {
  const secret = options.secret ?? process.env.PLAYER_SESSION_SECRET;
  if (secret && secret.length > 0) return secret;
  return derivedSecret();
}

// Whether player session tokens can currently be signed/verified at all --
// either via an explicit PLAYER_SESSION_SECRET or the SUPABASE_SERVICE_ROLE_KEY
// fallback above. Route handlers use this to fail fast with a clear error
// before attempting an OAuth round trip.
export function playerSessionSecretAvailable(): boolean {
  return resolveSecret() !== null;
}

function sign(payloadPart: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadPart).digest("base64url");
}

function constantTimeEqual(first: string, second: string): boolean {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  if (firstBuffer.length !== secondBuffer.length) return false;
  return timingSafeEqual(firstBuffer, secondBuffer);
}

// A stateless, HMAC-signed player session. The payload is intentionally minimal
// (player account id + Discord id + expiry) so a player cookie can identify
// someone for the web dashboard without carrying personal data, and so no extra
// dependency is required beyond node:crypto.
export function createPlayerSessionToken(
  session: { playerAccountId: string; discordUserId: string | null },
  options: PlayerSessionOptions = {},
): string {
  const secret = resolveSecret(options);
  if (!secret) throw new Error("PLAYER_SESSION_SECRET is not configured.");
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? PLAYER_SESSION_DEFAULT_TTL_SECONDS;
  const payload: PlayerSessionPayload = {
    playerAccountId: session.playerAccountId,
    discordUserId: session.discordUserId,
    expiresAt: now + ttl,
  };
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadPart}.${sign(payloadPart, secret)}`;
}

export function verifyPlayerSessionToken(
  token: string | undefined,
  options: PlayerSessionOptions = {},
): PlayerSessionPayload | null {
  if (!token) return null;
  const secret = resolveSecret(options);
  if (!secret) return null;
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) return null;
  const payloadPart = token.slice(0, separatorIndex);
  const signaturePart = token.slice(separatorIndex + 1);
  if (!constantTimeEqual(sign(payloadPart, secret), signaturePart)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payloadPart, "base64url").toString("utf8"),
    ) as Partial<PlayerSessionPayload>;
    if (typeof parsed.playerAccountId !== "string" || parsed.playerAccountId.length === 0) {
      return null;
    }
    if (typeof parsed.expiresAt !== "number") return null;
    const now = options.now ?? Math.floor(Date.now() / 1000);
    if (parsed.expiresAt <= now) return null;
    return {
      playerAccountId: parsed.playerAccountId,
      discordUserId: typeof parsed.discordUserId === "string" ? parsed.discordUserId : null,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function cookieValueFromHeader(rawCookie: string | null, name: string): string | undefined {
  return rawCookie?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
}

export function playerSessionFromRequest(
  request: Request,
  options: PlayerSessionOptions = {},
): PlayerSession | null {
  const token = cookieValueFromHeader(
    request.headers.get("cookie"),
    PLAYER_SESSION_COOKIE_NAME,
  );
  return playerSessionFromToken(token, options);
}

export function playerSessionFromToken(
  token: string | undefined,
  options: PlayerSessionOptions = {},
): PlayerSession | null {
  const payload = verifyPlayerSessionToken(token, options);
  if (!payload) return null;
  return {
    playerAccountId: payload.playerAccountId,
    discordUserId: payload.discordUserId,
  };
}

export function playerSessionCookieOptions(
  options: PlayerSessionOptions = {},
): {
  httpOnly: boolean;
  maxAge: number;
  sameSite: "lax";
  secure: boolean;
  path: string;
} {
  return {
    httpOnly: true,
    maxAge: options.ttlSeconds ?? PLAYER_SESSION_DEFAULT_TTL_SECONDS,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export async function getPlayerSession(): Promise<PlayerSession | null> {
  const token = (await cookies()).get(PLAYER_SESSION_COOKIE_NAME)?.value;
  return playerSessionFromToken(token);
}

export async function requirePlayer(returnTo = "/player"): Promise<PlayerSession> {
  const session = await getPlayerSession();
  if (session) return session;
  redirect(`/player/signin?returnTo=${encodeURIComponent(returnTo)}`);
}