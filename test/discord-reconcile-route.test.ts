import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/internal/discord/reconcile/route";

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

function reconcileRequest(headers: Record<string, string> = { Authorization: "Bearer bot-secret" }): Request {
  return new Request("https://app.example/api/internal/discord/reconcile", { headers });
}

function tournamentFixture(tournamentId: string): Record<string, unknown> {
  return {
    tournamentId,
    name: `Cup ${tournamentId}`,
    status: "in_progress",
    checkInStatus: "closed",
    registeredCount: 8,
    checkedInCount: 7,
    config: {
      tournament_id: tournamentId,
      guild_id: "g1",
      category_id: "cat1",
      signup_channel_id: "s1",
      checkin_channel_id: "c1",
      score_channel_id: "sc1",
      manager_role_id: "r1",
      signup_message_id: "sm1",
      checkin_message_id: "cm1",
      state: "active",
      last_error: null,
      score_cooldown_seconds: 60,
    },
    activeLobbies: [{
      id: "l1",
      roundId: "round1",
      gameNumber: 1,
      lobbyNumber: 1,
      participants: [{ discordUserId: "u1", displayName: "Player One" }],
    }],
    threads: [{
      roundId: "round1",
      lobbyNumber: 1,
      threadId: "thread1",
      acceptedImageCount: 2,
      state: "active",
      lastGameNumber: 2,
    }],
  };
}

function stubViewModel(viewModel: unknown): { calls: Array<{ path: string; method: string }>; restore: () => void } {
  const calls: Array<{ path: string; method: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: init?.method ?? "GET" });
    return new Response(JSON.stringify(viewModel === undefined ? [] : [{ view_model: viewModel }]), { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = originalFetch; } };
}

test("reconcile route requires the bot secret", async () => {
  await withBotSecret(async () => {
    const response = await GET(reconcileRequest({ Authorization: "Bearer wrong" }));
    assert.equal(response.status, 401);
  });
});

test("reconcile route resolves every connected tournament in one request", async () => {
  await withBotSecret(async () => {
    const stub = stubViewModel({
      tournaments: [tournamentFixture("t1"), tournamentFixture("t2"), tournamentFixture("t3")],
    });
    try {
      const response = await GET(reconcileRequest());
      assert.equal(response.status, 200);
      // The regression this guards: the route used to issue eight sequential
      // PostgREST reads per tournament, so this count scaled with tournament
      // count. It must stay at one regardless of how many come back.
      assert.equal(stub.calls.length, 1);
      assert.equal(stub.calls[0]!.method, "POST");
      assert.equal(stub.calls[0]!.path, "/rest/v1/rpc/get_discord_reconcile_view_model");
      const body = await response.json() as { tournaments: unknown[] };
      assert.equal(body.tournaments.length, 3);
    } finally {
      stub.restore();
    }
  });
});

test("reconcile route passes the read model payload through unchanged", async () => {
  await withBotSecret(async () => {
    const tournament = tournamentFixture("t1");
    const stub = stubViewModel({ tournaments: [tournament] });
    try {
      const response = await GET(reconcileRequest());
      assert.equal(response.status, 200);
      // The bot reads config.config.guild_id/category_id/manager_role_id and
      // score_cooldown_seconds, plus activeLobbies and threads, so the shape has
      // to survive this boundary intact.
      assert.deepEqual(await response.json(), { tournaments: [tournament] });
    } finally {
      stub.restore();
    }
  });
});

test("reconcile route returns an empty payload when the read model yields no row", async () => {
  await withBotSecret(async () => {
    const stub = stubViewModel(undefined);
    try {
      const response = await GET(reconcileRequest());
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { tournaments: [] });
    } finally {
      stub.restore();
    }
  });
});

test("reconcile route returns an empty payload when the read model omits tournaments", async () => {
  await withBotSecret(async () => {
    const stub = stubViewModel({ something_else: true });
    try {
      const response = await GET(reconcileRequest());
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { tournaments: [] });
    } finally {
      stub.restore();
    }
  });
});
