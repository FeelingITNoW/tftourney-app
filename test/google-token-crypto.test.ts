import assert from "node:assert/strict";
import test from "node:test";
import { decryptGoogleRefreshToken, encryptGoogleRefreshToken } from "../lib/sheets/crypto";

test("encrypts refresh tokens so plaintext is never persisted", () => {
  const encrypted = encryptGoogleRefreshToken("refresh-token", "test-encryption-key");
  assert.notEqual(encrypted, "refresh-token");
  assert.equal(decryptGoogleRefreshToken(encrypted, "test-encryption-key"), "refresh-token");
  assert.throws(() => decryptGoogleRefreshToken(encrypted, "wrong-key"));
});
