import { claimOrCreatePlayerByDiscord } from "../db/players/api";
import {
  createPlayerSessionToken,
  playerSessionCookieOptions,
} from "./player-session";

// Cookie names for the player Discord sign-in flow. The flow reuses the
// already-registered /api/auth/discord/callback redirect URI (adding a new one
// requires a Discord Developer Portal change and otherwise fails with
// "invalid oauth2 redirect_uri"), so the player authorize route sets a player
// state cookie that the shared callback uses to tell the flows apart.
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
// player session cookie. Shared by the reused /api/auth/discord/callback route.
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