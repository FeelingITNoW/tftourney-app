import assert from "node:assert/strict";
import test from "node:test";
import { processDiscordSubmission } from "../lib/discord/submissions";
import { POST as processSubmissionRoute } from "../app/api/internal/discord/submissions/[submissionId]/process/route";
import type { PlacementParseResult } from "../lib/ocr/placements/types";

type Call = { method: string; pathname: string; body: unknown };

function withEnv<T>(run: (calls: Call[]) => Promise<T>): Promise<T> {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalSecret = process.env.DISCORD_BOT_API_SECRET;
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.DISCORD_BOT_API_SECRET = "bot-secret";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalFetch = globalThis.fetch;
  const calls: Call[] = [];
  return run(calls).finally(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [
      ["SUPABASE_URL", originalUrl],
      ["SUPABASE_SERVICE_ROLE_KEY", originalKey],
      ["NEXT_PUBLIC_SUPABASE_URL", originalPublicUrl],
      ["DISCORD_BOT_API_SECRET", originalSecret],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const lobbyViewModel = {
  view_model: {
    tournament: { id: "t1", host_user_id: "7", name: "Test", status: "in_progress", has_started: true },
    format_config: {},
    round: { id: "r1", round_number: 1, format_round_id: null, status: "active" },
    lobby: { id: "l1", round_id: "r1", game_number: 1, lobby_number: 1, participants: [{ participant_id: "p1", display_name: "Alice", slot_number: 1 }] },
    participants: [{ id: "p1", display_name_at_start: "Alice", registration_id: "reg1", seed_number: 1 }],
    scores: [],
  },
};

function submissionRow(overrides: Partial<{ status: string; lease_token: string | null; attempt_count: number; target_lobby_id: string | null }> = {}) {
  return {
    tournament_id: "t1",
    target_lobby_id: "l1",
    storage_path: "t1/x.png",
    status: "processing",
    lease_token: "lease-1",
    attempt_count: 1,
    ...overrides,
  };
}

function completeOcrResult(): PlacementParseResult {
  return {
    schemaVersion: 2,
    status: "complete",
    strategy: "rank_anchors",
    placements: [{ placement: 1, extractedName: "Alice", matchStatus: "matched", matchedRosterEntry: { id: "p1", displayName: "Alice", similarity: 1 }, similarity: 1 }],
    issues: [],
    debug: {
      detectedWords: [],
      orderedNameCandidates: ["Alice"],
      rankAnchors: [],
      selectedProfile: "generic",
      layoutConfidence: 1,
      runnerUpMargin: 1,
      rowCenters: [],
      candidateDiagnostics: [],
      finalizedOrder: [{ placement: 1, extractedName: "Alice" }],
      rosterProvided: true,
      rosterSize: 1,
    },
  };
}

function incompleteOcrResult(): PlacementParseResult {
  const result = completeOcrResult();
  return { ...result, status: "review_required", placements: [{ ...result.placements[0]!, matchStatus: "unmatched", matchedRosterEntry: null }] };
}

function stubFetch(calls: Call[], respond: (call: Call) => { status: number; body?: unknown }): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = { method: init?.method ?? "GET", pathname: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const { status, body } = respond(call);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
}

function routeFetch(calls: Call[], handlers: {
  submission?: Record<string, unknown>;
  lobbyModel?: unknown;
  image?: { status: number };
  submitResult?: Record<string, unknown> | { error: true };
  reviewOk?: boolean;
}): void {
  stubFetch(calls, (call) => {
    if (call.pathname.endsWith("/discord_score_submissions") && call.method === "GET") {
      return { status: 200, body: handlers.submission ? [handlers.submission] : [] };
    }
    if (call.pathname.endsWith("rpc/get_tournament_lobby_view_model")) {
      return { status: 200, body: handlers.lobbyModel !== undefined ? [handlers.lobbyModel] : [lobbyViewModel] };
    }
    if (call.pathname.includes("/storage/v1/object/")) {
      const status = handlers.image?.status ?? 200;
      return status >= 200 && status < 300 ? { status, body: "stub-image-bytes" } : { status };
    }
    if (call.pathname.endsWith("rpc/submit_lobby_results")) {
      if (handlers.submitResult && "error" in handlers.submitResult) {
        return { status: 400, body: { code: "P0001", message: "Lobby game has already been recorded." } };
      }
      return { status: 200, body: [handlers.submitResult ?? { updated_lobby_id: "l1", updated_participant_count: 1, round_id: "r1", lobby_number: 1, game_number: 1, replayed: false }] };
    }
    if (call.pathname.endsWith("rpc/mark_discord_submission_review")) {
      return { status: handlers.reviewOk === false ? 500 : 200 };
    }
    throw new Error(`Unexpected request to ${call.pathname}`);
  });
}

test("processDiscordSubmission accepts a complete OCR result and records the score", async () => {
  await withEnv(async (calls) => {
    routeFetch(calls, { submission: submissionRow() });
    const result = await processDiscordSubmission("s1", "lease-1", { parseImage: async () => completeOcrResult() });
    assert.deepEqual(result, { outcome: "accepted", gameNumber: 1, roundId: "r1", lobbyNumber: 1 });
    const submitCall = calls.find((call) => call.pathname.endsWith("rpc/submit_lobby_results"));
    assert.deepEqual((submitCall?.body as { p_results: unknown }).p_results, [{ participantId: "p1", placement: 1 }]);
    assert.equal((submitCall?.body as { p_submission_id: string }).p_submission_id, "s1");
  });
});

test("processDiscordSubmission flags for review when OCR does not produce a complete roster", async () => {
  await withEnv(async (calls) => {
    routeFetch(calls, { submission: submissionRow() });
    const result = await processDiscordSubmission("s1", "lease-1", { parseImage: async () => incompleteOcrResult() });
    assert.equal(result.outcome, "review_required");
    const reviewCall = calls.find((call) => call.pathname.endsWith("rpc/mark_discord_submission_review"));
    assert.ok(reviewCall);
    assert.equal((reviewCall!.body as { p_error_code: string }).p_error_code, "OCR_REVIEW_REQUIRED");
    assert.equal(calls.some((call) => call.pathname.endsWith("rpc/submit_lobby_results")), false);
  });
});

test("processDiscordSubmission flags for review when the score write itself fails", async () => {
  await withEnv(async (calls) => {
    routeFetch(calls, { submission: submissionRow(), submitResult: { error: true } });
    const result = await processDiscordSubmission("s1", "lease-1", { parseImage: async () => completeOcrResult() });
    assert.equal(result.outcome, "score_write_failed");
    if (result.outcome === "score_write_failed") assert.match(result.message, /already been recorded/);
    const reviewCall = calls.find((call) => call.pathname.endsWith("rpc/mark_discord_submission_review"));
    assert.equal((reviewCall!.body as { p_error_code: string }).p_error_code, "SCORE_WRITE_FAILED");
  });
});

test("processDiscordSubmission marks retries exhausted after the third failed attempt", async () => {
  await withEnv(async (calls) => {
    routeFetch(calls, { submission: submissionRow({ attempt_count: 3 }), image: { status: 503 } });
    const result = await processDiscordSubmission("s1", "lease-1", { parseImage: async () => completeOcrResult() });
    assert.equal(result.outcome, "retries_exhausted");
    const reviewCall = calls.find((call) => call.pathname.endsWith("rpc/mark_discord_submission_review"));
    assert.equal((reviewCall!.body as { p_error_code: string }).p_error_code, "PROCESSING_RETRIES_EXHAUSTED");
  });
});

test("processDiscordSubmission leaves the row alone and rethrows while attempts remain", async () => {
  await withEnv(async (calls) => {
    routeFetch(calls, { submission: submissionRow({ attempt_count: 1 }), image: { status: 503 } });
    await assert.rejects(() => processDiscordSubmission("s1", "lease-1", { parseImage: async () => completeOcrResult() }));
    assert.equal(calls.some((call) => call.pathname.endsWith("rpc/mark_discord_submission_review")), false);
  });
});

test("processDiscordSubmission rejects when the submission is not held by the given lease", async () => {
  await withEnv(async (calls) => {
    routeFetch(calls, { submission: submissionRow({ lease_token: "different-lease" }) });
    await assert.rejects(
      () => processDiscordSubmission("s1", "lease-1", { parseImage: async () => completeOcrResult() }),
      /not held by this lease/,
    );
  });
});

test("processDiscordSubmission rejects when the submission is not in the processing status", async () => {
  await withEnv(async (calls) => {
    routeFetch(calls, { submission: submissionRow({ status: "needs_review" }) });
    await assert.rejects(() => processDiscordSubmission("s1", "lease-1", { parseImage: async () => completeOcrResult() }));
  });
});

function processRequest(body: unknown, authorized = true): Request {
  return new Request("https://app.example/api/internal/discord/submissions/s1/process", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authorized ? { Authorization: "Bearer bot-secret" } : {}) },
    body: JSON.stringify(body),
  });
}

test("process route requires the bot secret", async () => {
  await withEnv(async () => {
    const response = await processSubmissionRoute(processRequest({ leaseToken: "lease-1" }, false), { params: Promise.resolve({ submissionId: "s1" }) });
    assert.equal(response.status, 401);
  });
});

test("process route requires a lease token", async () => {
  await withEnv(async () => {
    const response = await processSubmissionRoute(processRequest({}), { params: Promise.resolve({ submissionId: "s1" }) });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "LEASE_REQUIRED");
  });
});
