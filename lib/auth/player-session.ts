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

function resolveSecret(options: PlayerSessionOptions = {}): string | null {
  const secret = options.secret ?? process.env.PLAYER_SESSION_SECRET;
  return secret && secret.length > 0 ? secret : null;
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