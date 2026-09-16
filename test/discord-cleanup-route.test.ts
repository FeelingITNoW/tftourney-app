import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/internal/discord/cleanup/route";

function withBotSecret<T>(run: () => Promise<T>): Promise<T> {
  const originalSecret = process.env.DISCORD_BOT_API_SECRET;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.DISCORD_BOT_API_SECRET = "bot-secret";
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  return run().finally(() => {
    for (const [key, value] of [
      ["DISCORD_BOT_API_SECRET", originalSecret],
      ["SUPABASE_URL", originalUrl],
      ["SUPABASE_SERVICE_ROLE_KEY", originalKey],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function cleanupRequest(headers: Record<string, string> = { Authorization: "Bearer bot-secret" }): Request {
  return new Request("https://app.example/api/internal/discord/cleanup", { headers });
}

test("cleanup route requires the bot secret", async () => {
  await withBotSecret(async () => {
    const response = await GET(cleanupRequest({ Authorization: "Bearer wrong" }));
    assert.equal(response.status, 401);
  });
});

test("cleanup route returns an empty list without a second request when nothing is pending", async () => {
  await withBotSecret(async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify([]), { status: 200 });
    };
    try {
      const response = await GET(cleanupRequest());
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { cleanups: [] });
      assert.equal(fetchCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("cleanup route only queries disabled configs with a pending cleanup action", async () => {
  await withBotSecret(async () => {
    const requests: Array<{ path: string; query: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      requests.push({ path: url.pathname, query: decodeURIComponent(url.search) });
      if (url.pathname === "/rest/v1/tournament_discord_configs") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      throw new Error(`Unexpected request to ${url.pathname}`);
    };
    try {
      await GET(cleanupRequest());
      assert.equal(requests.length, 1);
      assert.match(requests[0]!.query, /state=eq\.disabled/);
      assert.match(requests[0]!.query, /cleanup_action=not\.is\.null/);
      assert.match(requests[0]!.query, /cleanup_completed_at=is\.null/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("cleanup route joins tournament names and shapes each item", async () => {
  await withBotSecret(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/rest/v1/tournament_discord_configs") {
        return new Response(JSON.stringify([{
          tournament_id: "t1", guild_id: "g1", category_id: "cat1",
          signup_channel_id: "s1", checkin_channel_id: "c1", score_channel_id: "sc1",
          manager_role_id: "r1", cleanup_action: "archive",
        }]), { status: 200 });
      }
      if (url.pathname === "/rest/v1/tournaments") {
        return new Response(JSON.stringify([{ id: "t1", name: "Winter Cup" }]), { status: 200 });
      }
      throw new Error(`Unexpected request to ${url.pathname}`);
    };
    try {
      const response = await GET(cleanupRequest());
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.cleanups, [{
        tournamentId: "t1", name: "Winter Cup", guildId: "g1", categoryId: "cat1",
        signupChannelId: "s1", checkinChannelId: "c1", scoreChannelId: "sc1",
        managerRoleId: "r1", cleanupAction: "archive",
      }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
