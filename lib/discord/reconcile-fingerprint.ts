// Pure helpers for deciding whether a connected tournament's Discord
// provisioning (category, channels, manager role, signup/check-in panels)
// needs to be redone on a given reconcile tick, or is already known-correct
// and the tick can skip straight to lobby-thread sync. No imports: this
// module is shared between the bot process and (if ever needed) Next.js
// route handlers, following the same discipline as cooldown.ts.
//
// The fingerprint only needs to cover state that changes what
// provisionTournament would write to Discord: the tournament name (category
// and manager-role names), the fields that drive the two panel messages'
// content and disabled state (status, checkInStatus, checkedInCount), and
// every provisioned Discord ID (so a config write that changes/loses one is
// caught immediately rather than waiting for the next self-heal pass).

export type ReconcileFingerprintInput = {
  name: string;
  status: string;
  checkInStatus: string;
  checkedInCount: number;
  config: {
    guild_id: string;
    category_id: string | null;
    signup_channel_id: string | null;
    checkin_channel_id: string | null;
    score_channel_id: string | null;
    manager_role_id: string | null;
    signup_message_id: string | null;
    checkin_message_id: string | null;
  };
};

/** A stable string that changes if, and only if, provisioning-relevant state changes. */
export function computeReconcileFingerprint(input: ReconcileFingerprintInput): string {
  return JSON.stringify([
    input.name,
    input.status,
    input.checkInStatus,
    input.checkedInCount,
    input.config.guild_id,
    input.config.category_id,
    input.config.signup_channel_id,
    input.config.checkin_channel_id,
    input.config.score_channel_id,
    input.config.manager_role_id,
    input.config.signup_message_id,
    input.config.checkin_message_id,
  ]);
}

/** Whether every Discord ID provisionTournament is responsible for creating is present. */
export function hasAllProvisionedIds(config: ReconcileFingerprintInput["config"]): boolean {
  return Boolean(
    config.category_id &&
      config.signup_channel_id &&
      config.checkin_channel_id &&
      config.score_channel_id &&
      config.manager_role_id &&
      config.signup_message_id &&
      config.checkin_message_id,
  );
}

export type ProvisionCacheEntry = {
  fingerprint: string;
  /** Epoch ms of the last time provisioning actually ran (fingerprint mismatch, missing IDs, or self-heal). */
  lastCheckedAt: number;
};

/**
 * Whether this tick can skip provisionTournament entirely for a tournament,
 * given its cached state from the last tick that actually ran it.
 *
 * Requires: the config is already "active", every provisioned ID is present,
 * the fingerprint matches the cached one, and the self-heal interval (which
 * catches drift provisionTournament wouldn't otherwise notice, such as a
 * channel deleted directly in Discord) has not yet elapsed.
 */
export function canSkipProvisioning(
  state: string,
  input: ReconcileFingerprintInput,
  cached: ProvisionCacheEntry | undefined,
  now: number,
  selfHealIntervalMs: number,
): boolean {
  if (state !== "active") return false;
  if (!hasAllProvisionedIds(input.config)) return false;
  if (!cached) return false;
  if (cached.fingerprint !== computeReconcileFingerprint(input)) return false;
  return now - cached.lastCheckedAt < selfHealIntervalMs;
}
