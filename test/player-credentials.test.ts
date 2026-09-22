import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../lib/auth/player-credentials";

test("hashPassword produces a verifiable hash", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
});

test("verifyPassword rejects a wrong password", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("wrong password", hash), false);
});

test("hashPassword produces a different hash (different salt) for the same password", async () => {
  const first = await hashPassword("same password");
  const second = await hashPassword("same password");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("same password", first), true);
  assert.equal(await verifyPassword("same password", second), true);
});

test("verifyPassword returns false for a null stored hash (no username-enumeration shortcut)", async () => {
  assert.equal(await verifyPassword("anything", null), false);
});

test("verifyPassword returns false for a malformed stored hash", async () => {
  assert.equal(await verifyPassword("anything", "not-a-real-hash"), false);
  assert.equal(await verifyPassword("anything", "scrypt$not$enough$parts"), false);
  assert.equal(await verifyPassword("anything", "bcrypt$16384$8$1$c2FsdA$aGFzaA"), false);
});

test("verifyPassword takes roughly the same time for a missing hash as for a wrong password", async () => {
  const hash = await hashPassword("correct horse battery staple");

  const time = async (fn: () => Promise<unknown>): Promise<number> => {
    const start = process.hrtime.bigint();
    await fn();
    return Number(process.hrtime.bigint() - start);
  };

  const wrongPasswordTime = await time(() => verifyPassword("wrong password", hash));
  const missingHashTime = await time(() => verifyPassword("wrong password", null));

  // Both derive a full scrypt hash before comparing, so neither should be
  // drastically cheaper than the other. Allow generous slack for CI jitter --
  // this is a smoke test against an obvious short-circuit, not a precise
  // timing assertion.
  const ratio = Math.max(wrongPasswordTime, missingHashTime) / Math.min(wrongPasswordTime, missingHashTime);
  assert.ok(ratio < 5, `expected comparable timing, got ratio ${ratio}`);
});
