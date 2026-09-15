import assert from "node:assert/strict";
import test from "node:test";
import { PATCH } from "../app/api/internal/discord/config/[tournamentId]/route";

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

function patchRequest(body: unknown, headers: Record<string, string> = { Authorization: "Bearer bot-secret" }): Request {
  return new Request("https://app.example/api/internal/discord/config/t1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("config PATCH requires the bot secret", async () => {
  await withBotSecret(async () => {
    const response = await PATCH(patchRequest({ score_cooldown_seconds: 45 }, { Authorization: "Bearer wrong" }), {
      params: Promise.resolve({ tournamentId: "t1" }),
    });
    assert.equal(response.status, 401);
  });
});

test("config PATCH rejects an out-of-range cooldown without writing", async () => {
  await withBotSecret(async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response("unexpected", { status: 500 });
    };
    try {
      const response = await PATCH(patchRequest({ score_cooldown_seconds: 5000 }), {
        params: Promise.resolve({ tournamentId: "t1" }),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "INVALID_COOLDOWN");
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("config PATCH rejects a non-integer cooldown without writing", async () => {
  await withBotSecret(async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalls += 1;
      return new Response("unexpected", { status: 500 });
    };
    try {
      const response = await PATCH(patchRequest({ score_cooldown_seconds: "60" }), {
        params: Promise.resolve({ tournamentId: "t1" }),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).code, "INVALID_COOLDOWN");
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("config PATCH writes a valid cooldown and drops unknown fields", async () => {
  await withBotSecret(async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ path: string; query: string; body: unknown }> = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ path: url.pathname, query: url.search, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(null, { status: 204 });
    };
    try {
      const response = await PATCH(patchRequest({ score_cooldown_seconds: 45, bogus: 1 }), {
        params: Promise.resolve({ tournamentId: "t1" }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.score_cooldown_seconds, 45);
      assert.equal("bogus" in payload, false);
      assert.equal(requests.length, 1);
      assert.equal(requests[0]?.path, "/rest/v1/tournament_discord_configs");
      assert.match(requests[0]?.query ?? "", /tournament_id=eq\.t1/);
      const body = requests[0]?.body as Record<string, unknown>;
      assert.equal(body.score_cooldown_seconds, 45);
      assert.equal("bogus" in body, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("config PATCH allows guild_name and still drops unknown fields", async () => {
  await withBotSecret(async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ path: string; query: string; body: unknown }> = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ path: url.pathname, query: url.search, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(null, { status: 204 });
    };
    try {
      const response = await PATCH(patchRequest({ guild_name: "My Server", bogus: 1 }), {
        params: Promise.resolve({ tournamentId: "t1" }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.guild_name, "My Server");
      assert.equal("bogus" in payload, false);
      const body = requests[0]?.body as Record<string, unknown>;
      assert.equal(body.guild_name, "My Server");
      assert.equal("bogus" in body, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
