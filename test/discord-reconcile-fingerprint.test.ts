import assert from "node:assert/strict";
import test from "node:test";
import {
  canSkipProvisioning,
  computeReconcileFingerprint,
  hasAllProvisionedIds,
  type ReconcileFingerprintInput,
} from "../lib/discord/reconcile-fingerprint";

function baseInput(overrides: Partial<ReconcileFingerprintInput> = {}): ReconcileFingerprintInput {
  return {
    name: "Winter Cup",
    status: "accepting_players",
    checkInStatus: "not_started",
    checkedInCount: 0,
    config: {
      guild_id: "guild-1",
      category_id: "cat-1",
      signup_channel_id: "signup-1",
      checkin_channel_id: "checkin-1",
      score_channel_id: "score-1",
      manager_role_id: "role-1",
      signup_message_id: "signup-msg-1",
      checkin_message_id: "checkin-msg-1",
    },
    ...overrides,
  };
}

test("computeReconcileFingerprint is stable across equal inputs and changes when provisioning-relevant fields change", () => {
  const input = baseInput();
  assert.equal(computeReconcileFingerprint(input), computeReconcileFingerprint(baseInput()));

  const changes: Array<Partial<ReconcileFingerprintInput>> = [
    { name: "Spring Cup" },
    { status: "in_progress" },
    { checkInStatus: "open" },
    { checkedInCount: 3 },
  ];
  for (const change of changes) {
    assert.notEqual(
      computeReconcileFingerprint(baseInput(change)),
      computeReconcileFingerprint(input),
      `expected fingerprint to change for ${JSON.stringify(change)}`,
    );
  }

  const configChanges: Array<Partial<ReconcileFingerprintInput["config"]>> = [
    { guild_id: "guild-2" },
    { category_id: "cat-2" },
    { signup_channel_id: "signup-2" },
    { checkin_channel_id: "checkin-2" },
    { score_channel_id: "score-2" },
    { manager_role_id: "role-2" },
    { signup_message_id: "signup-msg-2" },
    { checkin_message_id: "checkin-msg-2" },
  ];
  for (const change of configChanges) {
    const changed = baseInput({ config: { ...input.config, ...change } });
    assert.notEqual(
      computeReconcileFingerprint(changed),
      computeReconcileFingerprint(input),
      `expected fingerprint to change for config ${JSON.stringify(change)}`,
    );
  }
});

test("hasAllProvisionedIds requires every provisioned Discord ID", () => {
  assert.equal(hasAllProvisionedIds(baseInput().config), true);
  const idFields = [
    "category_id",
    "signup_channel_id",
    "checkin_channel_id",
    "score_channel_id",
    "manager_role_id",
    "signup_message_id",
    "checkin_message_id",
  ] as const;
  for (const field of idFields) {
    assert.equal(
      hasAllProvisionedIds({ ...baseInput().config, [field]: null }),
      false,
      `expected hasAllProvisionedIds to be false when ${field} is missing`,
    );
  }
});

test("canSkipProvisioning requires active state, complete IDs, a matching fingerprint, and a fresh self-heal window", () => {
  const input = baseInput();
  const now = 1_000_000;
  const selfHealIntervalMs = 5 * 60_000;
  const freshCache = { fingerprint: computeReconcileFingerprint(input), lastCheckedAt: now - 1_000 };

  // Happy path: everything matches, so this tick can skip.
  assert.equal(canSkipProvisioning("active", input, freshCache, now, selfHealIntervalMs), true);

  // Not yet active (still provisioning for the first time, or in an error state).
  assert.equal(canSkipProvisioning("pending", input, freshCache, now, selfHealIntervalMs), false);
  assert.equal(canSkipProvisioning("error", input, freshCache, now, selfHealIntervalMs), false);

  // A provisioned ID is missing (e.g. lost from a partial earlier write).
  const missingId = baseInput({ config: { ...input.config, score_channel_id: null } });
  assert.equal(canSkipProvisioning("active", missingId, freshCache, now, selfHealIntervalMs), false);

  // No cache entry yet -- first tick this process has seen this tournament.
  assert.equal(canSkipProvisioning("active", input, undefined, now, selfHealIntervalMs), false);

  // Cached fingerprint no longer matches (something provisioning-relevant changed).
  const staleFingerprintCache = { fingerprint: computeReconcileFingerprint(baseInput({ checkedInCount: 9 })), lastCheckedAt: now - 1_000 };
  assert.equal(canSkipProvisioning("active", input, staleFingerprintCache, now, selfHealIntervalMs), false);

  // Self-heal interval has elapsed even though the fingerprint still matches.
  const staleCache = { fingerprint: computeReconcileFingerprint(input), lastCheckedAt: now - selfHealIntervalMs - 1 };
  assert.equal(canSkipProvisioning("active", input, staleCache, now, selfHealIntervalMs), false);

  // Right at the boundary: still within the window.
  const boundaryCache = { fingerprint: computeReconcileFingerprint(input), lastCheckedAt: now - selfHealIntervalMs + 1 };
  assert.equal(canSkipProvisioning("active", input, boundaryCache, now, selfHealIntervalMs), true);
});
