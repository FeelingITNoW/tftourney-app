import assert from "node:assert/strict";
import test from "node:test";
import {
  SCORE_COOLDOWN_DEFAULT_SECONDS,
  SCORE_COOLDOWN_MAX_SECONDS,
  cooldownRejectionMessage,
  formatCooldownDuration,
  parseCooldownSeconds,
} from "../lib/discord/cooldown";
import { canManageLobbyCooldown, selectTournamentForCommand, type CommandTournament } from "../lib/discord/commands";
import { parseSubmissionResult } from "../lib/discord/http";

test("parseCooldownSeconds accepts whole numbers in range and rejects everything else", () => {
  assert.equal(parseCooldownSeconds(60), 60);
  assert.equal(parseCooldownSeconds(0), 0);
  assert.equal(parseCooldownSeconds(SCORE_COOLDOWN_MAX_SECONDS), SCORE_COOLDOWN_MAX_SECONDS);
  assert.equal(parseCooldownSeconds(SCORE_COOLDOWN_MAX_SECONDS + 1), null);
  assert.equal(parseCooldownSeconds(-1), null);
  assert.equal(parseCooldownSeconds(1.5), null);
  assert.equal(parseCooldownSeconds("60"), null);
  assert.equal(parseCooldownSeconds(undefined), null);
});

test("formatCooldownDuration renders human-readable durations", () => {
  assert.equal(formatCooldownDuration(0), "disabled");
  assert.equal(formatCooldownDuration(1), "1 second");
  assert.equal(formatCooldownDuration(45), "45 seconds");
  assert.equal(formatCooldownDuration(60), "1 minute");
  assert.equal(formatCooldownDuration(90), "1 minute 30 seconds");
  assert.equal(formatCooldownDuration(3600), "1 hour");
});

test("cooldownRejectionMessage mentions the remaining wait", () => {
  const message = cooldownRejectionMessage(42);
  assert.match(message, /42 seconds/);
});

test("parseSubmissionResult maps retry_after_seconds", () => {
  const withRetry = parseSubmissionResult({
    submission_id: "s1",
    submission_status: "rejected_cooldown",
    queue_position: 1,
    round_id: "r1",
    lobby_number: 2,
    accepted_image_count: 1,
    retry_after_seconds: 42,
  });
  assert.equal(withRetry.retryAfterSeconds, 42);

  const withoutRetry = parseSubmissionResult({ submission_id: "s2", submission_status: "queued" });
  assert.equal(withoutRetry.retryAfterSeconds, null);
});

function tournament(overrides: Partial<CommandTournament> = {}): CommandTournament {
  return {
    tournamentId: "t1",
    name: "Test Cup",
    categoryId: "cat1",
    managerRoleId: "role1",
    scoreCooldownSeconds: SCORE_COOLDOWN_DEFAULT_SECONDS,
    ...overrides,
  };
}

test("selectTournamentForCommand prefers a category match", () => {
  const a = tournament({ tournamentId: "a", categoryId: "cat-a" });
  const b = tournament({ tournamentId: "b", categoryId: "cat-b" });
  assert.equal(selectTournamentForCommand([a, b], "cat-b")?.tournamentId, "b");
});

test("selectTournamentForCommand falls back to a sole candidate with no category match", () => {
  const only = tournament({ tournamentId: "only", categoryId: "cat-only" });
  assert.equal(selectTournamentForCommand([only], "cat-other")?.tournamentId, "only");
  assert.equal(selectTournamentForCommand([only], null)?.tournamentId, "only");
});

test("selectTournamentForCommand is ambiguous with multiple candidates and no category match", () => {
  const a = tournament({ tournamentId: "a", categoryId: "cat-a" });
  const b = tournament({ tournamentId: "b", categoryId: "cat-b" });
  assert.equal(selectTournamentForCommand([a, b], "cat-c"), null);
  assert.equal(selectTournamentForCommand([a, b], null), null);
});

test("selectTournamentForCommand returns null for no candidates", () => {
  assert.equal(selectTournamentForCommand([], "cat-a"), null);
});

test("canManageLobbyCooldown allows Manage Server alone", () => {
  assert.equal(canManageLobbyCooldown({ hasManageGuild: true, roleIds: [], managerRoleId: "role1" }), true);
});

test("canManageLobbyCooldown allows holding the manager role alone", () => {
  assert.equal(canManageLobbyCooldown({ hasManageGuild: false, roleIds: ["role1"], managerRoleId: "role1" }), true);
});

test("canManageLobbyCooldown denies a member with neither", () => {
  assert.equal(canManageLobbyCooldown({ hasManageGuild: false, roleIds: ["other-role"], managerRoleId: "role1" }), false);
});

test("canManageLobbyCooldown denies when the tournament has no manager role configured", () => {
  assert.equal(canManageLobbyCooldown({ hasManageGuild: false, roleIds: ["role1"], managerRoleId: null }), false);
});
