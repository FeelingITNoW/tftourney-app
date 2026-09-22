import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAYER_SESSION_COOKIE_NAME,
  createPlayerSessionToken,
  playerSessionFromRequest,
  verifyPlayerSessionToken,
} from "../lib/auth/player-session";

const SECRET = "player-session-secret";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

test("a signed player session token round-trips its payload", () => {
  const token = createPlayerSessionToken(
    { playerAccountId: "42", discordUserId: "discord-1" },
    { secret: SECRET },
  );
  const payload = verifyPlayerSessionToken(token, { secret: SECRET });
  assert.ok(payload);
  assert.equal(payload!.playerAccountId, "42");
  assert.equal(payload!.discordUserId, "discord-1");
  assert.ok(payload!.expiresAt > nowSeconds());
});

test("a token signed with a different secret is rejected", () => {
  const token = createPlayerSessionToken(
    { playerAccountId: "42", discordUserId: null },
    { secret: SECRET },
  );
  assert.equal(verifyPlayerSessionToken(token, { secret: "other-secret" }), null);
});

test("a tampered payload is rejected", () => {
  const token = createPlayerSessionToken(
    { playerAccountId: "42", discordUserId: null },
    { secret: SECRET },
  );
  const [payloadPart, signaturePart] = token.split(".");
  const forgedPayload = Buffer.from(
    JSON.stringify({ playerAccountId: "99", discordUserId: null, expiresAt: nowSeconds() + 3600 }),
  ).toString("base64url");
  const forged = `${forgedPayload}.${signaturePart}`;
  assert.notEqual(forgedPayload, payloadPart);
  assert.equal(verifyPlayerSessionToken(forged, { secret: SECRET }), null);
});

test("an expired token is rejected", () => {
  const token = createPlayerSessionToken(
    { playerAccountId: "42", discordUserId: null },
    { secret: SECRET, ttlSeconds: 10, now: nowSeconds() - 100 },
  );
  assert.equal(verifyPlayerSessionToken(token, { secret: SECRET }), null);
});

test("malformed tokens are rejected without throwing", () => {
  for (const token of ["", "not-a-token", "a.b.c", "."]) {
    assert.equal(verifyPlayerSessionToken(token, { secret: SECRET }), null);
  }
});

test("missing or empty tokens verify to null", () => {
  assert.equal(verifyPlayerSessionToken(undefined, { secret: SECRET }), null);
  assert.equal(verifyPlayerSessionToken("", { secret: SECRET }), null);
});

test("when no secret and no service role key are configured, tokens cannot be verified", () => {
  const originalSecret = process.env.PLAYER_SESSION_SECRET;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.PLAYER_SESSION_SECRET;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const token = createPlayerSessionToken(
      { playerAccountId: "42", discordUserId: null },
      { secret: SECRET },
    );
    assert.equal(verifyPlayerSessionToken(token), null);
  } finally {
    if (originalSecret === undefined) delete process.env.PLAYER_SESSION_SECRET;
    else process.env.PLAYER_SESSION_SECRET = originalSecret;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  }
});

test("when PLAYER_SESSION_SECRET is unset, a key is derived from SUPABASE_SERVICE_ROLE_KEY", () => {
  const originalSecret = process.env.PLAYER_SESSION_SECRET;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.PLAYER_SESSION_SECRET;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-one";
  try {
    const token = createPlayerSessionToken({ playerAccountId: "42", discordUserId: "discord-1" });
    const payload = verifyPlayerSessionToken(token);
    assert.ok(payload);
    assert.equal(payload!.playerAccountId, "42");

    // A different service role key must not verify the token: the derived
    // key changes when the value it's derived from changes.
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-two";
    assert.equal(verifyPlayerSessionToken(token), null);
  } finally {
    if (originalSecret === undefined) delete process.env.PLAYER_SESSION_SECRET;
    else process.env.PLAYER_SESSION_SECRET = originalSecret;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  }
});

test("an explicit PLAYER_SESSION_SECRET takes precedence over the derived fallback", () => {
  const originalSecret = process.env.PLAYER_SESSION_SECRET;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.PLAYER_SESSION_SECRET = SECRET;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  try {
    const token = createPlayerSessionToken({ playerAccountId: "42", discordUserId: null });
    // Verifying with the explicit secret alone (no service role key in scope)
    // proves the env-var token was signed with PLAYER_SESSION_SECRET, not the
    // derived fallback.
    assert.ok(verifyPlayerSessionToken(token, { secret: SECRET }));
  } finally {
    if (originalSecret === undefined) delete process.env.PLAYER_SESSION_SECRET;
    else process.env.PLAYER_SESSION_SECRET = originalSecret;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  }
});

test("an anon key alone must never be used to derive the session signing key", () => {
  const originalSecret = process.env.PLAYER_SESSION_SECRET;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalAnonKey = process.env.SUPABASE_ANON_KEY;
  const originalPublicAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.PLAYER_SESSION_SECRET;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
  try {
    const token = createPlayerSessionToken(
      { playerAccountId: "42", discordUserId: null },
      { secret: SECRET },
    );
    assert.equal(verifyPlayerSessionToken(token), null);
  } finally {
    if (originalSecret === undefined) delete process.env.PLAYER_SESSION_SECRET;
    else process.env.PLAYER_SESSION_SECRET = originalSecret;
    if (originalServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
    if (originalAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = originalAnonKey;
    if (originalPublicAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalPublicAnonKey;
  }
});

test("playerSessionFromRequest reads the player cookie from the raw header", () => {
  const token = createPlayerSessionToken(
    { playerAccountId: "42", discordUserId: "discord-1" },
    { secret: SECRET },
  );
  const request = new Request("https://app.example/player", {
    headers: { cookie: `${PLAYER_SESSION_COOKIE_NAME}=${token}; other=value` },
  });
  const payload = playerSessionFromRequest(request, { secret: SECRET });
  assert.equal(payload?.playerAccountId, "42");
});

test("playerSessionFromRequest returns null without a player cookie", () => {
  const request = new Request("https://app.example/player", {
    headers: { cookie: "other=value" },
  });
  assert.equal(playerSessionFromRequest(request, { secret: SECRET }), null);
});