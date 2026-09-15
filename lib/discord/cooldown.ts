// Pure helpers for the per-lobby-thread Discord score cooldown. No imports:
// this module is shared between Next.js route handlers and the standalone
// bot process (bot/index.ts), which compiles bot/ plus whatever it imports
// under its own tsconfig and must not pull in the Supabase/Next code paths.

export const SCORE_COOLDOWN_DEFAULT_SECONDS = 60;
export const SCORE_COOLDOWN_MAX_SECONDS = 3600;
export const REJECTED_COOLDOWN_STATUS = "rejected_cooldown" as const;

/**
 * Validates a candidate cooldown duration. Only a whole number of seconds in
 * [0, SCORE_COOLDOWN_MAX_SECONDS] is accepted; 0 disables the cooldown.
 * Returns null for anything else, including numeric strings.
 */
export function parseCooldownSeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value > SCORE_COOLDOWN_MAX_SECONDS) return null;
  return value;
}

/** Renders a cooldown duration for chat, e.g. "1 minute 30 seconds". */
export function formatCooldownDuration(seconds: number): string {
  if (seconds <= 0) return "disabled";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** The reply posted to a screenshot rejected because its lobby is on cooldown. */
export function cooldownRejectionMessage(retryAfterSeconds: number): string {
  const wait = formatCooldownDuration(Math.max(retryAfterSeconds, 1));
  return `⏳ Skipped: this lobby's last game was recorded moments ago. If this screenshot is a new game, resend it in ${wait}.`;
}
