// Pure helpers for rendering a Discord identity in the player UI. No imports
// from the Discord bot or Next runtime so these stay trivially testable.

const DISCORD_CDN_BASE = "https://cdn.discordapp.com";
const MIN_AVATAR_SIZE = 16;
const MAX_AVATAR_SIZE = 1024;

/**
 * Builds a Discord CDN avatar URL. Returns null when the account has no avatar
 * (id or hash missing) so callers can render a fallback instead of a broken
 * image. Animated avatars have an `a_` hash prefix and must use `.gif`.
 */
export function discordAvatarUrl(
  discordUserId: string | null | undefined,
  avatarHash: string | null | undefined,
  size = 64,
): string | null {
  const userId = discordUserId?.trim();
  const hash = avatarHash?.trim();
  if (!userId || !hash) return null;
  const clampedSize = Math.min(MAX_AVATAR_SIZE, Math.max(MIN_AVATAR_SIZE, Math.floor(size)));
  const extension = hash.startsWith("a_") ? "gif" : "png";
  return `${DISCORD_CDN_BASE}/avatars/${userId}/${hash}.${extension}?size=${clampedSize}`;
}

/** A safe display name for a player's Discord identity. */
export function discordDisplayName(username: string | null | undefined): string {
  const trimmed = username?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Discord player";
}