import assert from "node:assert/strict";
import test from "node:test";
import {
  validateOptionalEmail,
  validatePassword,
  validatePlayerSignup,
  validateUsername,
} from "../lib/players/account-validation";

test("validateUsername accepts letters, numbers, and underscores within length bounds", () => {
  for (const username of ["abc", "Fuu_Time_99", "a".repeat(20)]) {
    const result = validateUsername(username);
    assert.equal(result.success, true, `expected "${username}" to be valid`);
  }
});

test("validateUsername rejects too short, too long, and invalid characters", () => {
  for (const username of ["ab", "a".repeat(21), "has space", "has-dash", "has.dot", "emoji😀"]) {
    const result = validateUsername(username);
    assert.equal(result.success, false, `expected "${username}" to be invalid`);
  }
});

test("validateUsername trims surrounding whitespace", () => {
  const result = validateUsername("  fuutime  ");
  assert.equal(result.success, true);
  assert.equal(result.success && result.data, "fuutime");
});

test("validatePassword enforces the minimum length", () => {
  assert.equal(validatePassword("short").success, false);
  assert.equal(validatePassword("exactly8").success, true);
});

test("validateOptionalEmail treats blank as valid and null", () => {
  const result = validateOptionalEmail("");
  assert.equal(result.success, true);
  assert.equal(result.success && result.data, null);
});

test("validateOptionalEmail accepts a well-formed address and rejects a malformed one", () => {
  assert.equal(validateOptionalEmail("player@example.com").success, true);
  assert.equal(validateOptionalEmail("not-an-email").success, false);
});

test("validatePlayerSignup succeeds with a matching confirmation and optional email", () => {
  const result = validatePlayerSignup({
    username: "fuutime",
    password: "password123",
    confirmPassword: "password123",
    email: "player@example.com",
  });
  assert.equal(result.success, true);
  assert.equal(result.success && result.data.username, "fuutime");
  assert.equal(result.success && result.data.email, "player@example.com");
});

test("validatePlayerSignup reports a mismatched confirmation without masking a valid password", () => {
  const result = validatePlayerSignup({
    username: "fuutime",
    password: "password123",
    confirmPassword: "different123",
  });
  assert.equal(result.success, false);
  assert.equal(!result.success && result.errors.confirmPassword, "Passwords do not match.");
  assert.equal(!result.success && result.errors.password, undefined);
});

test("validatePlayerSignup reports every invalid field at once", () => {
  const result = validatePlayerSignup({
    username: "a",
    password: "short",
    confirmPassword: "different",
    email: "not-an-email",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.errors.username);
    assert.ok(result.errors.password);
    assert.ok(result.errors.email);
  }
});
