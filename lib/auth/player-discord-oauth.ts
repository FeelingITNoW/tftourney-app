import { getPlayerAccountByDiscordUserId, linkDiscordAccountToPlayer } from "../db/players/api";
import {
  createPlayerSessionToken,
  createSignedPlayerToken,
  playerSessionCookieOptions,
  verifySignedPlayerToken,
  type PlayerSession,
} from "./player-session";

// Player sign-in with Discord has its own OAuth redirect URI, separate from
// the organizer manager-invite flow's /api/auth/discord/callback, so the two
// flows can never be confused by a stale cookie. Register this path in the
// Discord Developer Portal's OAuth2 redirect list alongside the manager one.
export const PLAYER_DISCORD_CALLBACK_PATH = "/api/auth/discord/player/callback";
export const PLAYER_DISCORD_COOKIE_PATH = "/api/auth/discord/player";

// Cookie names for the player Discord sign-in flow.
export const PLAYER_DISCORD_STATE_COOKIE = "tftourney-player-discord-state";
export const PLAYER_DISCORD_RETURN_TO_COOKIE = "tftourney-player-discord-return-to";
// "signin" (default): resolve/create an account from the Discord identity.
// "link": attach this Discord identity to the currently signed-in account
// (used from /player/account's "Link Discord" button).
export const PLAYER_DISCORD_MODE_COOKIE = "tftourney-player-discord-mode";

// Carries a Discord identity that has no matching player account yet, from
// the callback to /player/signup, so signup can finish account creation
// without a second Discord round trip.
export const PLAYER_PENDING_DISCORD_COOKIE = "tftourney-player-pending-discord";
// Scoped to /player (not just /player/signup) so it is also readable if the
// player navigates within the player area before finishing signup.
export const PLAYER_PENDING_DISCORD_COOKIE_PATH = "/player";
const PENDING_DISCORD_TTL_SECONDS = 600;

export function safePlayerReturnPath(value: string | undefined): string {
  if (!value) return "/player";
  try {
    const decoded = decodeURIComponent(value);
    return decoded.startsWith("/") && !decoded.startsWith("//") && !decoded.includes("\\") ? decoded : "/player";
  } catch {
    return "/player";
  }
}

export type PlayerDiscordIdentity = {
  id: string;
  username?: string | null;
  avatar?: string | null;
};

export type PendingPlayerDiscordIdentity = {
  discordUserId: string;
  discordUsername: string | null;
  discordAvatar: string | null;
};

type PlayerSessionCookie = ReturnType<typeof playerSessionCookieOptions>;

export type PlayerDiscordResolution =
  | { kind: "signed-in"; playerAccountId: string; sessionToken: string; sessionCookie: PlayerSessionCookie }
  | { kind: "needs-signup"; pendingToken: string }
  | { kind: "linked"; playerAccountId: string };

// Mints a short-lived signed token carrying a Discord identity with no
// matching account, so /player/signup can create the account without asking
// Discord again. Built on the generic signed-token primitives in
// player-session.ts rather than a second HMAC scheme.
export function createPendingPlayerDiscordToken(identity: PlayerDiscordIdentity): string {
  return createSignedPlayerToken(
    {
      discordUserId: identity.id,
      discordUsername: identity.username ?? null,
      discordAvatar: identity.avatar ?? null,
    },
    PENDING_DISCORD_TTL_SECONDS,
  );
}

export function readPendingPlayerDiscordToken(token: string | undefined): PendingPlayerDiscordIdentity | null {
  const parsed = verifySignedPlayerToken(token);
  if (!parsed) return null;
  const discordUserId = parsed.discordUserId;
  if (typeof discordUserId !== "string" || discordUserId.length === 0) return null;
  return {
    discordUserId,
    discordUsername: typeof parsed.discordUsername === "string" ? parsed.discordUsername : null,
    discordAvatar: typeof parsed.discordAvatar === "string" ? parsed.discordAvatar : null,
  };
}

// Resolves a Discord identity from the OAuth callback into one of three
// outcomes: the Discord id is already linked to a player account (sign in);
// the caller asked to link this identity onto an already-signed-in account
// (mode "link"); or the identity has no account yet, in which case a
// short-lived pending token is returned for /player/signup to consume.
//
// Deliberately does NOT auto-create an account the way the old
// completePlayerDiscordSignIn did -- accounts are now created explicitly via
// player signup (with a username/password), never implicitly from an OAuth
// round trip alone. The Discord bot's own sign-up flow is unaffected: it
// still calls claim_or_create_player_by_discord directly (see
// app/api/internal/discord/signup/route.ts), which is unrelated to this web
// sign-in path.
export async function resolvePlayerDiscordSignIn(
  discordUser: PlayerDiscordIdentity,
  options: { mode?: "signin" | "link"; activeSession?: PlayerSession | null } = {},
): Promise<PlayerDiscordResolution> {
  if (options.mode === "link" && options.activeSession) {
    const linked = await linkDiscordAccountToPlayer({
      playerAccountId: options.activeSession.playerAccountId,
      discordUserId: discordUser.id,
      discordUsername: discordUser.username ?? null,
      discordAvatar: discordUser.avatar ?? null,
    });
    return { kind: "linked", playerAccountId: linked.id };
  }

  const existing = await getPlayerAccountByDiscordUserId(discordUser.id);
  if (existing) {
    return {
      kind: "signed-in",
      playerAccountId: existing.id,
      sessionToken: createPlayerSessionToken({ playerAccountId: existing.id }),
      sessionCookie: playerSessionCookieOptions(),
    };
  }

  return { kind: "needs-signup", pendingToken: createPendingPlayerDiscordToken(discordUser) };
}
