import assert from "node:assert/strict";
import test from "node:test";
import { GET as callback } from "../app/api/auth/discord/player/callback/route";
import { createPlayerSessionToken, PLAYER_SESSION_COOKIE_NAME } from "../lib/auth/player-session";
import { PLAYER_PENDING_DISCORD_COOKIE } from "../lib/auth/player-discord-oauth";

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

const EXISTING_PLAYER_ROW = {
  id: 42,
  auth_user_id: null,
  username: null,
  discord_user_id: "discord-1",
  discord_username: "FuuTime",
  discord_avatar: "abcd",
  riot_puuid: null,
  riot_game_tag: null,
  email: null,
  created_at: "2026-09-21T00:00:00Z",
  updated_at: "2026-09-21T00:00:00Z",
  last_signed_in_at: null,
};

function stubDiscordIdentity(existingRow: unknown): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "discord-access" }), { status: 200 });
    }
    if (url.includes("/users/@me")) {
      return new Response(JSON.stringify({ id: "discord-1", username: "FuuTime", avatar: "abcd" }), { status: 200 });
    }
    if (url.includes("/rest/v1/player_accounts") && (init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify(existingRow ? [existingRow] : []), { status: 200 });
    }
    if (url.includes("/rpc/link_discord_account_to_player")) {
      return new Response(JSON.stringify([{ ...EXISTING_PLAYER_ROW, id: 7 }]), { status: 200 });
    }
    throw new Error(`Unexpected callback request: ${url}`);
  }) as typeof fetch;
}

test("player Discord callback signs in when the Discord id already has a linked account", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  const originalFetch = globalThis.fetch;
  setEnv();
  globalThis.fetch = stubDiscordIdentity(EXISTING_PLAYER_ROW);
  try {
    const response = await callback(
      new Request("https://app.example/api/auth/discord/player/callback?code=oauth-code&state=state-1", {
        headers: {
          cookie: "tftourney-player-discord-state=state-1; tftourney-player-discord-return-to=%2Fplayer",
        },
      }),
    );
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/player?playerAuth=success");
    assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`${PLAYER_SESSION_COOKIE_NAME}=`));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("player Discord callback sends an unknown Discord identity to signup instead of auto-creating an account", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  const originalFetch = globalThis.fetch;
  setEnv();
  globalThis.fetch = stubDiscordIdentity(null);
  try {
    const response = await callback(
      new Request("https://app.example/api/auth/discord/player/callback?code=oauth-code&state=state-1", {
        headers: {
          cookie: "tftourney-player-discord-state=state-1; tftourney-player-discord-return-to=%2Fplayer",
        },
      }),
    );
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/player/signup?playerAuth=discord");
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, new RegExp(`${PLAYER_PENDING_DISCORD_COOKIE}=`));
    assert.doesNotMatch(setCookie, new RegExp(`${PLAYER_SESSION_COOKIE_NAME}=`));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("player Discord callback in link mode attaches the identity to the signed-in account", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  const originalFetch = globalThis.fetch;
  setEnv();
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ?? null });
    if (url.includes("/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "discord-access" }), { status: 200 });
    }
    if (url.includes("/users/@me")) {
      return new Response(JSON.stringify({ id: "discord-1", username: "FuuTime", avatar: "abcd" }), { status: 200 });
    }
    if (url.includes("/rpc/link_discord_account_to_player")) {
      return new Response(JSON.stringify([{ ...EXISTING_PLAYER_ROW, id: 7, username: "someone" }]), { status: 200 });
    }
    throw new Error(`Unexpected callback request: ${url}`);
  }) as typeof fetch;

  const activeSessionToken = createPlayerSessionToken({ playerAccountId: "7" });

  try {
    const response = await callback(
      new Request("https://app.example/api/auth/discord/player/callback?code=oauth-code&state=state-1", {
        headers: {
          cookie: `tftourney-player-discord-state=state-1; tftourney-player-discord-return-to=%2Fplayer%2Faccount; tftourney-player-discord-mode=link; ${PLAYER_SESSION_COOKIE_NAME}=${activeSessionToken}`,
        },
      }),
    );
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/player/account?accountUpdated=discord");
    const link = calls.find((call) => call.url.includes("/rpc/link_discord_account_to_player"));
    assert.ok(link);
    assert.deepEqual(JSON.parse(String(link!.body)), {
      p_player_account_id: "7",
      p_discord_user_id: "discord-1",
      p_discord_username: "FuuTime",
      p_discord_avatar: "abcd",
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("player Discord callback in link mode fails cleanly with no active player session", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  const originalFetch = globalThis.fetch;
  setEnv();
  globalThis.fetch = (async () => {
    throw new Error("fetch should not be called");
  }) as typeof fetch;
  try {
    const response = await callback(
      new Request("https://app.example/api/auth/discord/player/callback?code=oauth-code&state=state-1", {
        headers: {
          cookie: "tftourney-player-discord-state=state-1; tftourney-player-discord-return-to=%2Fplayer%2Faccount; tftourney-player-discord-mode=link",
        },
      }),
    );
    assert.equal(response.status, 307);
    assert.equal(
      response.headers.get("location"),
      "/player/signin?playerAuthError=discord_link_requires_session&returnTo=%2Fplayer%2Faccount",
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("player Discord callback succeeds without PLAYER_SESSION_SECRET by deriving a key from SUPABASE_SERVICE_ROLE_KEY", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  const originalFetch = globalThis.fetch;
  setEnv();
  delete process.env.PLAYER_SESSION_SECRET;
  globalThis.fetch = stubDiscordIdentity(EXISTING_PLAYER_ROW);
  try {
    const response = await callback(
      new Request("https://app.example/api/auth/discord/player/callback?code=oauth-code&state=state-1", {
        headers: {
          cookie: "tftourney-player-discord-state=state-1; tftourney-player-discord-return-to=%2Fplayer",
        },
      }),
    );
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/player?playerAuth=success");
    assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`${PLAYER_SESSION_COOKIE_NAME}=`));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("player Discord callback fails with player_session_not_configured when neither PLAYER_SESSION_SECRET nor SUPABASE_SERVICE_ROLE_KEY is set", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  const originalFetch = globalThis.fetch;
  setEnv();
  delete process.env.PLAYER_SESSION_SECRET;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch = (async () => {
    throw new Error("fetch should not be called");
  }) as typeof fetch;
  try {
    const response = await callback(
      new Request("https://app.example/api/auth/discord/player/callback?code=oauth-code&state=state-1", {
        headers: {
          cookie: "tftourney-player-discord-state=state-1; tftourney-player-discord-return-to=%2Fplayer",
        },
      }),
    );
    assert.equal(response.status, 307);
    assert.equal(
      response.headers.get("location"),
      "/player/signin?playerAuthError=player_session_not_configured&returnTo=%2Fplayer",
    );
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
          cookie: "tftourney-player-discord-state=state-1; tftourney-player-discord-return-to=%2Fplayer",
        },
      }),
    );
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/player/signin?playerAuthError=discord_state_invalid&returnTo=%2Fplayer");
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
          cookie: "tftourney-player-discord-state=state-1; tftourney-player-discord-return-to=%2Fplayer",
        },
      }),
    );
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/player/signin?playerAuthError=discord_oauth_not_configured&returnTo=%2Fplayer");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});
test("player Discord callback fails soft instead of throwing when a provider request errors unexpectedly", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  const originalFetch = globalThis.fetch;
  setEnv();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/oauth2/token")) return new Response(JSON.stringify({ access_token: "discord-access" }), { status: 200 });
    if (url.includes("/users/@me")) throw new Error("network unreachable");
    throw new Error(`Unexpected callback request: ${url}`);
  }) as typeof fetch;
  try {
    const response = await callback(
      new Request("https://app.example/api/auth/discord/player/callback?code=oauth-code&state=state-1", {
        headers: { cookie: "tftourney-player-discord-state=state-1; tftourney-player-discord-return-to=%2Fplayer" },
      }),
    );
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/player/signin?playerAuthError=discord_oauth_failed&returnTo=%2Fplayer");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});
