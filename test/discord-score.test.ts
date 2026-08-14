import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/tournaments/[tournamentId]/lobbies/[lobbyId]/results/route";

test("Discord score endpoint requires an idempotency key", async () => {
  const original = process.env.DISCORD_BOT_API_SECRET;
  process.env.DISCORD_BOT_API_SECRET = "bot-secret";
  try {
    const response = await POST(
      new Request("https://app.example/api/tournaments/1/lobbies/2/results", {
        method: "POST",
        headers: { Authorization: "Bearer bot-secret", "Content-Type": "application/json" },
        body: JSON.stringify({ results: [{ participantId: "p1", placement: 1 }] }),
      }),
      { params: Promise.resolve({ tournamentId: "1", lobbyId: "2" }) },
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "IDEMPOTENCY_REQUIRED");
  } finally {
    if (original === undefined) delete process.env.DISCORD_BOT_API_SECRET;
    else process.env.DISCORD_BOT_API_SECRET = original;
  }
});

test("Discord score endpoint validates placements before writing", async () => {
  const original = process.env.DISCORD_BOT_API_SECRET;
  process.env.DISCORD_BOT_API_SECRET = "bot-secret";
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("unexpected", { status: 500 });
  };
  try {
    const response = await POST(
      new Request("https://app.example/api/tournaments/1/lobbies/2/results", {
        method: "POST",
        headers: { Authorization: "Bearer bot-secret", "Content-Type": "application/json", "Idempotency-Key": "submission-1" },
        body: JSON.stringify({ results: [{ participantId: "p1", placement: 1 }, { participantId: "p2", placement: 1 }] }),
      }),
      { params: Promise.resolve({ tournamentId: "1", lobbyId: "2" }) },
    );
    assert.equal(response.status, 422);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.DISCORD_BOT_API_SECRET;
    else process.env.DISCORD_BOT_API_SECRET = original;
  }
});

test("Discord score endpoint rejects an unknown write mode", async () => {
  const original = process.env.DISCORD_BOT_API_SECRET;
  process.env.DISCORD_BOT_API_SECRET = "bot-secret";
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("unexpected", { status: 500 });
  };
  try {
    const response = await POST(
      new Request("https://app.example/api/tournaments/1/lobbies/2/results", {
        method: "POST",
        headers: { Authorization: "Bearer bot-secret", "Content-Type": "application/json", "Idempotency-Key": "submission-mode" },
        body: JSON.stringify({ mode: "overwrite", results: [{ participantId: "p1", placement: 1 }] }),
      }),
      { params: Promise.resolve({ tournamentId: "1", lobbyId: "2" }) },
    );
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, "INVALID_MODE");
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.DISCORD_BOT_API_SECRET;
    else process.env.DISCORD_BOT_API_SECRET = original;
  }
});

test("Discord score endpoint returns the transaction result", async () => {
  const originalSecret = process.env.DISCORD_BOT_API_SECRET;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.DISCORD_BOT_API_SECRET = "bot-secret";
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    assert.match(String(input), /\/rpc\/submit_lobby_results$/);
    assert.equal(options?.method, "POST");
    return new Response(JSON.stringify([{
      updated_lobby_id: "2",
      updated_participant_count: 2,
      round_id: "3",
      lobby_number: 1,
      game_number: 1,
      replayed: false,
    }]), { status: 200 });
  };
  try {
    const response = await POST(
      new Request("https://app.example/api/tournaments/1/lobbies/2/results", {
        method: "POST",
        headers: { Authorization: "Bearer bot-secret", "Content-Type": "application/json", "Idempotency-Key": "submission-2" },
        body: JSON.stringify({ results: [{ participantId: "p1", placement: 1 }, { participantId: "p2", placement: 2 }] }),
      }),
      { params: Promise.resolve({ tournamentId: "1", lobbyId: "2" }) },
    );
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { updated_lobby_id: "2", updated_participant_count: 2, round_id: "3", lobby_number: 1, game_number: 1, replayed: false });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [["DISCORD_BOT_API_SECRET", originalSecret], ["SUPABASE_URL", originalUrl], ["SUPABASE_SERVICE_ROLE_KEY", originalKey]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
