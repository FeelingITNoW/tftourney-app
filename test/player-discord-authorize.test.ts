import assert from "node:assert/strict";
import test from "node:test";
import { GET as authorize } from "../app/api/auth/discord/player/route";
import { GET as callback } from "../app/api/auth/discord/callback/route";

type Saved = Record<string, string | undefined>;

function snapshotEnv(keys: string[]): Saved {
  const saved: Saved = {};
  for (const key of keys) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved: Saved): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const ENV_KEYS = [
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "PLAYER_SESSION_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "TFTOURNEY_APP_URL",
  "TFT_REQUIRE_AUTH",
];

function setEnv(): void {
  process.env.DISCORD_CLIENT_ID = "client-id";
  process.env.DISCORD_CLIENT_SECRET = "client-secret";
  process.env.PLAYER_SESSION_SECRET = "player-secret";
  process.env.SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.TFTOURNEY_APP_URL = "https://app.example";
  delete process.env.TFT_REQUIRE_AUTH;
}

test("player authorize uses its own callback redirect URI and sets the player state cookie", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  setEnv();
  try {
    const response = await authorize(
      new Request("https://app.example/api/auth/discord/player?returnTo=%2Fplayer", {
        headers: { cookie: "" },
      }),
    );
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location") as string);
    assert.equal(location.hostname, "discord.com");
    assert.equal(location.searchParams.get("redirect_uri"), "https://app.example/api/auth/discord/player/callback");
    assert.equal(location.searchParams.get("scope"), "identify");
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /tftourney-player-discord-state=/);
    assert.match(setCookie, /tftourney-player-discord-return-to=/);
    assert.match(setCookie, /Path=\/api\/auth\/discord\/player/);
  } finally {
    restoreEnv(saved);
  }
});

test("player authorize returns 503 when Discord OAuth is not configured", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  setEnv();
  delete process.env.DISCORD_CLIENT_SECRET;
  try {
    const response = await authorize(new Request("https://app.example/api/auth/discord/player"));
    assert.equal(response.status, 503);
  } finally {
    restoreEnv(saved);
  }
});

test("the organizer manager callback ignores a stale player state cookie instead of hijacking the flow", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  const originalFetch = globalThis.fetch;
  setEnv();
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called");
  }) as typeof fetch;
  try {
    // A player authorization cookie can outlive its 10-minute window right up
    // to the moment someone opens a manager-invite link in the same browser.
    // Since the two flows now use separate callback routes, that stray cookie
    // must have no effect here: this route only ever runs the manager flow.
    const response = await callback(
      new Request("https://app.example/api/auth/discord/callback?code=oauth-code&state=state-1", {
        headers: { cookie: "tftourney-player-discord-state=stale-state; tftourney-player-discord-return-to=%2Fplayer" },
      }),
    );
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/signin?authError=discord_invite_auth_required");
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("the manager callback sends the organizer flow to /signin when there is no invite cookie", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  setEnv();
  try {
    const response = await callback(
      new Request("https://app.example/api/auth/discord/callback?code=oauth-code&state=state-1"),
    );
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/signin?authError=discord_invite_auth_required");
  } finally {
    restoreEnv(saved);
  }
});
