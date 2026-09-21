import assert from "node:assert/strict";
import test from "node:test";
import { GET as callback } from "../app/api/auth/discord/player/callback/route";
import { PLAYER_SESSION_COOKIE_NAME } from "../lib/auth/player-session";

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
  "DISCORD_BOT_TOKEN",
  "PLAYER_SESSION_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "TFTOURNEY_APP_URL",
];

function setEnv(): void {
  process.env.DISCORD_CLIENT_ID = "client-id";
  process.env.DISCORD_CLIENT_SECRET = "client-secret";
  process.env.PLAYER_SESSION_SECRET = "player-secret";
  process.env.SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.TFTOURNEY_APP_URL = "https://app.example";
}

test("player Discord callback exchanges the code, claims the account, and sets the player cookie", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  const originalFetch = globalThis.fetch;
  setEnv();
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ?? null });
    if (url.includes("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "discord-access" }), { status: 200 });
    }
    if (url.includes("/users/@me")) {
      return new Response(JSON.stringify({ id: "discord-1", username: "FuuTime", avatar: "abcd" }), { status: 200 });
    }
    if (url.includes("/rpc/claim_or_create_player_by_discord")) {
      return new Response(
        JSON.stringify([{ id: 42, discord_user_id: "discord-1", discord_username: "FuuTime", discord_avatar: "abcd", riot_puuid: null, riot_game_tag: null, auth_user_id: null, email: null, created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" }]),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected callback request: ${url}`);
  }) as typeof fetch;

  try {
    const response = await callback(
      new Request("https://app.example/api/auth/discord/player/callback?code=oauth-code&state=state-1", {
        headers: {
          cookie:
            "tftourney-player-discord-state=state-1; tftourney-player-discord-return-to=%2Fplayer",
        },
      }),
    );
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location") as string);
    assert.equal(location.pathname, "/player");
    assert.equal(location.searchParams.get("playerAuth"), "success");
    assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`${PLAYER_SESSION_COOKIE_NAME}=`));
    const claim = calls.find((call) => call.url.includes("/rpc/claim_or_create_player_by_discord"));
    assert.ok(claim);
    assert.deepEqual(JSON.parse(String(claim!.body)), {
      p_discord_user_id: "discord-1",
      p_discord_username: "FuuTime",
      p_discord_avatar: "abcd",
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("player Discord callback rejects a mismatched state", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  const originalFetch = globalThis.fetch;
  setEnv();
  globalThis.fetch = (async () => {
    throw new Error("fetch should not be called");
  }) as typeof fetch;
  try {
    const response = await callback(
      new Request("https://app.example/api/auth/discord/player/callback?code=oauth-code&state=wrong", {
        headers: {
          cookie:
            "tftourney-player-discord-state=state-1; tftourney-player-discord-return-to=%2Fplayer",
        },
      }),
    );
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location") as string);
    assert.equal(location.pathname, "/player/signin");
    assert.equal(location.searchParams.get("playerAuthError"), "discord_state_invalid");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("player Discord callback fails cleanly when OAuth is not configured", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  const originalFetch = globalThis.fetch;
  setEnv();
  delete process.env.DISCORD_CLIENT_SECRET;
  globalThis.fetch = (async () => {
    throw new Error("fetch should not be called");
  }) as typeof fetch;
  try {
    const response = await callback(
      new Request("https://app.example/api/auth/discord/player/callback?code=oauth-code&state=state-1", {
        headers: {
          cookie:
            "tftourney-player-discord-state=state-1; tftourney-player-discord-return-to=%2Fplayer",
        },
      }),
    );
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location") as string);
    assert.equal(location.searchParams.get("playerAuthError"), "discord_oauth_not_configured");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});