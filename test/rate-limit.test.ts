import assert from "node:assert/strict";
import test from "node:test";
import { handlePlacementOcrRequest, resetWebOcrLimiter, type PlacementOcrHttpDependencies } from "../lib/ocr/placements/http";
import type { PlacementParseResult } from "../lib/ocr/placements/types";
import { getRiotAccountByRiotId, resetRiotLookupLimiter, RiotRateLimitError } from "../lib/riot/accounts/api";
import { clientIp, createRateLimiter } from "../lib/rate-limit";

test("limiter allows up to the limit, then blocks with a retry hint", () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
  for (let attempt = 0; attempt < 3; attempt += 1) assert.deepEqual(limiter.check("a", 1_000), { ok: true });
  assert.deepEqual(limiter.check("a", 11_000), { ok: false, retryAfterSeconds: 50 });
});

test("limiter resets after the window and tracks keys independently", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
  assert.equal(limiter.check("a", 0).ok, true);
  assert.equal(limiter.check("a", 1).ok, false);
  assert.equal(limiter.check("b", 1).ok, true);
  assert.equal(limiter.check("a", 60_000).ok, true);
});

test("clientIp prefers x-real-ip, then the last x-forwarded-for hop, then unknown", () => {
  assert.equal(clientIp(new Headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2, 3.3.3.3" })), "1.1.1.1");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 3.3.3.3" })), "3.3.3.3");
  assert.equal(clientIp(new Headers()), "unknown");
});

test("Riot lookups with a rate limit key are capped at 5 per minute without calling Riot", async () => {
  resetRiotLookupLimiter();
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.RIOT_API_KEY;
  process.env.RIOT_API_KEY = "riot-key";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ puuid: "p", gameName: "A", tagLine: "B" }), { status: 200 });
  }) as typeof fetch;
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await getRiotAccountByRiotId({ gameName: "A", tagLine: "B" }, { rateLimitKey: "player:1" });
    }
    await assert.rejects(
      () => getRiotAccountByRiotId({ gameName: "A", tagLine: "B" }, { rateLimitKey: "player:1" }),
      RiotRateLimitError,
    );
    assert.equal(calls, 5);
    // A different caller is unaffected, and an unkeyed (organizer) call is never limited.
    await getRiotAccountByRiotId({ gameName: "A", tagLine: "B" }, { rateLimitKey: "player:2" });
    await getRiotAccountByRiotId({ gameName: "A", tagLine: "B" });
    assert.equal(calls, 7);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.RIOT_API_KEY;
    else process.env.RIOT_API_KEY = originalKey;
    resetRiotLookupLimiter();
  }
});

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const parsed: PlacementParseResult = {
  schemaVersion: 2,
  status: "complete",
  strategy: "rank_anchors",
  placements: [],
  issues: [],
  debug: {
    detectedWords: [],
    orderedNameCandidates: [],
    rankAnchors: [],
    selectedProfile: "generic",
    layoutConfidence: 0,
    runnerUpMargin: 0,
    rowCenters: [],
    candidateDiagnostics: [],
    finalizedOrder: [],
    rosterProvided: false,
    rosterSize: 0,
  },
};

function ocrRequest(headers: Record<string, string> = {}): Request {
  const data = new FormData();
  data.append("image", new Blob([png], { type: "image/png" }), "result.png");
  data.append("tournamentId", "1");
  data.append("lobbyId", "1");
  return new Request("https://app.example/api/ocr/placements", { method: "POST", headers, body: data });
}

const ocrDependencies: PlacementOcrHttpDependencies = {
  expectedSecret: "bot-secret",
  getHostUserId: async () => "host-1",
  loadLobbyRoster: async () => ({ status: "in_progress", roster: [] }),
  parseImage: async () => parsed,
};

test("OCR route limits web requests per organizer but not bot requests", async () => {
  resetWebOcrLimiter();
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      assert.equal((await handlePlacementOcrRequest(ocrRequest(), ocrDependencies)).status, 200);
    }
    const limited = await handlePlacementOcrRequest(ocrRequest(), ocrDependencies);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("Retry-After")) >= 1);
    assert.equal(((await limited.json()) as { code: string }).code, "RATE_LIMITED");

    const bot = await handlePlacementOcrRequest(ocrRequest({ Authorization: "Bearer bot-secret" }), ocrDependencies);
    assert.notEqual(bot.status, 429);
  } finally {
    resetWebOcrLimiter();
  }
});
