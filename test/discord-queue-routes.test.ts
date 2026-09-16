import assert from "node:assert/strict";
import test from "node:test";
import { POST as submitScreenshot } from "../app/api/internal/discord/submissions/route";
import { POST as claimSubmission } from "../app/api/internal/discord/submissions/claim/route";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);

function withEnv<T>(run: () => Promise<T>): Promise<T> {
  const originalSecret = process.env.DISCORD_BOT_API_SECRET;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.DISCORD_BOT_API_SECRET = "bot-secret";
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  return run().finally(() => {
    for (const [key, value] of [
      ["DISCORD_BOT_API_SECRET", originalSecret],
      ["SUPABASE_URL", originalUrl],
      ["SUPABASE_SERVICE_ROLE_KEY", originalKey],
      ["NEXT_PUBLIC_SUPABASE_URL", originalPublicUrl],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function submissionForm(): FormData {
  const data = new FormData();
  data.append("tournamentId", "t1");
  data.append("threadId", "th1");
  data.append("messageId", "m1");
  data.append("userId", "u1");
  data.append("receivedAt", "2026-09-14T00:00:00.000Z");
  data.append("image", new Blob([png], { type: "image/png" }), "score.png");
  return data;
}

function submissionRequest(): Request {
  return new Request("https://app.example/api/internal/discord/submissions", {
    method: "POST",
    headers: { Authorization: "Bearer bot-secret" },
    body: submissionForm(),
  });
}

function mockRpcFetch(row: Record<string, unknown>): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/storage/v1/object/")) return new Response(null, { status: 200 });
    if (url.pathname.endsWith("rpc/enqueue_discord_score_submission")) {
      return new Response(JSON.stringify([row]), { status: 200 });
    }
    throw new Error(`Unexpected request to ${url.pathname}`);
  };
}

test("submissions route returns 429 with the computed Retry-After on cooldown rejection", async () => {
  await withEnv(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockRpcFetch({
      submission_id: "s1",
      submission_status: "rejected_cooldown",
      queue_position: null,
      round_id: "r1",
      lobby_number: 1,
      accepted_image_count: 1,
      retry_after_seconds: 42,
    });
    try {
      const response = await submitScreenshot(submissionRequest());
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("Retry-After"), "42");
      const body = await response.json();
      assert.equal(body.status, "rejected_cooldown");
      assert.equal(body.retryAfterSeconds, 42);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("submissions route returns 202 with no Retry-After when queued", async () => {
  await withEnv(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockRpcFetch({
      submission_id: "s2",
      submission_status: "queued",
      queue_position: 1,
      round_id: "r1",
      lobby_number: 1,
      accepted_image_count: 0,
      retry_after_seconds: null,
    });
    try {
      const response = await submitScreenshot(submissionRequest());
      assert.equal(response.status, 202);
      assert.equal(response.headers.get("Retry-After"), null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("submissions route keeps the fixed 10s Retry-After for queue overflow", async () => {
  await withEnv(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockRpcFetch({
      submission_id: "s3",
      submission_status: "rejected_overflow",
      queue_position: 4,
      round_id: "r1",
      lobby_number: 1,
      accepted_image_count: 0,
      retry_after_seconds: null,
    });
    try {
      const response = await submitScreenshot(submissionRequest());
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("Retry-After"), "10");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("claim route returns a cooldown rejection without loading the lobby view model", async () => {
  await withEnv(async () => {
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      fetchCalls += 1;
      const url = new URL(String(input));
      if (url.pathname.endsWith("rpc/claim_discord_score_submission")) {
        return new Response(JSON.stringify([{
          submission_id: "s1",
          tournament_id: "t1",
          round_id: "r1",
          thread_id: "th1",
          lobby_id: null,
          game_number: null,
          lease_token: null,
          storage_path: "t1/x.png",
          attempt_count: 0,
          claim_status: "rejected_cooldown",
          discord_message_id: "m1",
          retry_after_seconds: 30,
        }]), { status: 200 });
      }
      throw new Error(`Unexpected request to ${url.pathname}`);
    };
    try {
      const response = await claimSubmission(new Request("https://app.example/api/internal/discord/submissions/claim", {
        method: "POST",
        headers: { Authorization: "Bearer bot-secret" },
      }));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.claimStatus, "rejected_cooldown");
      assert.equal(body.discordMessageId, "m1");
      assert.equal(body.retryAfterSeconds, 30);
      assert.equal("imageUrl" in body, false);
      assert.equal(fetchCalls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("claim route enriches a claimed submission with the lobby roster and image URL", async () => {
  await withEnv(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("rpc/claim_discord_score_submission")) {
        return new Response(JSON.stringify([{
          submission_id: "s2",
          tournament_id: "t1",
          round_id: "r1",
          thread_id: "th1",
          lobby_id: "l1",
          game_number: 1,
          lease_token: "lease-1",
          storage_path: "t1/x.png",
          attempt_count: 1,
          claim_status: "claimed",
          discord_message_id: "m2",
          retry_after_seconds: null,
        }]), { status: 200 });
      }
      if (url.pathname.endsWith("rpc/get_tournament_lobby_view_model")) {
        return new Response(JSON.stringify([{
          view_model: {
            tournament: { id: "t1", host_user_id: "7", name: "Test", status: "in_progress", has_started: true },
            format_config: {},
            round: { id: "r1", round_number: 1, format_round_id: null, status: "active" },
            lobby: { id: "l1", round_id: "r1", game_number: 1, lobby_number: 1, participants: [{ participant_id: "p1", display_name: "Alice", slot_number: 1 }] },
            participants: [{ id: "p1", display_name_at_start: "Alice", registration_id: "reg1", seed_number: 1 }],
            scores: [],
          },
        }]), { status: 200 });
      }
      throw new Error(`Unexpected request to ${url.pathname}`);
    };
    try {
      const response = await claimSubmission(new Request("https://app.example/api/internal/discord/submissions/claim", {
        method: "POST",
        headers: { Authorization: "Bearer bot-secret" },
      }));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.claimStatus, "claimed");
      assert.equal(body.discordMessageId, "m2");
      assert.equal(body.imageUrl, "/api/internal/discord/submissions/s2/image");
      assert.deepEqual(body.roster, [{ id: "p1", displayName: "Alice" }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("claim route returns 204 when nothing is queued", async () => {
  await withEnv(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("rpc/claim_discord_score_submission")) return new Response(JSON.stringify([]), { status: 200 });
      throw new Error(`Unexpected request to ${url.pathname}`);
    };
    try {
      const response = await claimSubmission(new Request("https://app.example/api/internal/discord/submissions/claim", {
        method: "POST",
        headers: { Authorization: "Bearer bot-secret" },
      }));
      assert.equal(response.status, 204);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
