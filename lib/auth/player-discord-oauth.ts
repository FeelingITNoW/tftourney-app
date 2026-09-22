import { claimOrCreatePlayerByDiscord } from "../db/players/api";
import {
  createPlayerSessionToken,
  playerSessionCookieOptions,
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

export type CompletedPlayerDiscordSignIn = {
  playerAccountId: string;
  discordUserId: string | null;
  sessionToken: string;
  sessionCookie: {
    httpOnly: boolean;
    maxAge: number;
    sameSite: "lax";
    secure: boolean;
    path: string;
  };
};

// Claims/creates the player account for the Discord identity and mints the
// player session cookie.
export async function completePlayerDiscordSignIn(
  discordUser: PlayerDiscordIdentity,
): Promise<CompletedPlayerDiscordSignIn> {
  const player = await claimOrCreatePlayerByDiscord({
    discordUserId: discordUser.id,
    discordUsername: discordUser.username ?? null,
    discordAvatar: discordUser.avatar ?? null,
  });
  return {
    playerAccountId: player.id,
    discordUserId: player.discordUserId,
    sessionToken: createPlayerSessionToken({ playerAccountId: player.id, discordUserId: player.discordUserId }),
    sessionCookie: playerSessionCookieOptions(),
  };
}