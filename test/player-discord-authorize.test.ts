import assert from "node:assert/strict";
import test from "node:test";
import { GET as authorize } from "../app/api/auth/discord/player/route";
import { GET as callback } from "../app/api/auth/discord/callback/route";
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

test("player authorize reuses the registered callback redirect URI and sets the player state cookie", async () => {
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
    assert.equal(location.searchParams.get("redirect_uri"), "https://app.example/api/auth/discord/callback");
    assert.equal(location.searchParams.get("scope"), "identify");
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /tftourney-player-discord-state=/);
    assert.match(setCookie, /tftourney-player-discord-return-to=/);
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

test("shared callback routes to the player flow when the player state cookie is present", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  const originalFetch = globalThis.fetch;
  setEnv();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/oauth2/token")) return new Response(JSON.stringify({ access_token: "discord-access" }), { status: 200 });
    if (url.includes("/users/@me")) return new Response(JSON.stringify({ id: "discord-1", username: "FuuTime", avatar: "abcd" }), { status: 200 });
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
      new Request("https://app.example/api/auth/discord/callback?code=oauth-code&state=state-1", {
        headers: {
          cookie: "tftourney-player-discord-state=state-1; tftourney-player-discord-return-to=%2Fplayer",
        },
      }),
    );
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location") as string);
    assert.equal(location.pathname, "/player");
    assert.equal(location.searchParams.get("playerAuth"), "success");
    assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`${PLAYER_SESSION_COOKIE_NAME}=`));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("player sign-in redirects to /player even when a different returnTo was stored", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  const originalFetch = globalThis.fetch;
  setEnv();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/oauth2/token")) return new Response(JSON.stringify({ access_token: "discord-access" }), { status: 200 });
    if (url.includes("/users/@me")) return new Response(JSON.stringify({ id: "discord-1", username: "FuuTime", avatar: null }), { status: 200 });
    if (url.includes("/rpc/claim_or_create_player_by_discord")) {
      return new Response(
        JSON.stringify([{ id: 42, discord_user_id: "discord-1", discord_username: "FuuTime", discord_avatar: null, riot_puuid: null, riot_game_tag: null, auth_user_id: null, email: null, created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" }]),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected callback request: ${url}`);
  }) as typeof fetch;
  try {
    const response = await callback(
      new Request("https://app.example/api/auth/discord/callback?code=oauth-code&state=state-1", {
        headers: {
          cookie: "tftourney-player-discord-state=state-1; tftourney-player-discord-return-to=%2Fsome%2Fother%2Fpage",
        },
      }),
    );
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location") as string);
    assert.equal(location.pathname, "/player");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test("shared callback sends the organizer manager flow to /signin when there is no player state cookie", async () => {
  const saved = snapshotEnv(ENV_KEYS);
  setEnv();
  try {
    const response = await callback(
      new Request("https://app.example/api/auth/discord/callback?code=oauth-code&state=state-1"),
    );
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location") as string);
    assert.equal(location.pathname, "/signin");
    assert.equal(location.searchParams.get("authError"), "discord_invite_auth_required");
  } finally {
    restoreEnv(saved);
  }
});