import assert from "node:assert/strict";
import test from "node:test";
import { handlePlacementOcrRequest, type PlacementOcrHttpDependencies } from "../lib/ocr/placements/http";
import { PlacementParseError, type PlacementParseResult } from "../lib/ocr/placements/types";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const result: PlacementParseResult = {
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

function form(image = png, type = "image/png"): FormData {
  const data = new FormData();
  data.append("image", new Blob([image], { type }), "result.png");
  return data;
}

function dependencies(overrides: Partial<PlacementOcrHttpDependencies> = {}): PlacementOcrHttpDependencies {
  return {
    expectedSecret: "bot-secret",
    getHostUserId: async () => null,
    loadLobbyRoster: async () => null,
    parseImage: async () => result,
    ...overrides,
  };
}

test("accepts an authenticated bot request and passes its roster to the parser", async () => {
  let parsedRoster: unknown;
  const response = await handlePlacementOcrRequest(
    new Request("https://app.example/api/ocr/placements", {
      method: "POST",
      headers: { Authorization: "Bearer bot-secret" },
      body: (() => {
        const data = form();
        data.append("roster", JSON.stringify([{ id: "p1", displayName: "Player 1" }]));
        return data;
      })(),
    }),
    dependencies({ parseImage: async (_image, roster) => { parsedRoster = roster; return result; } }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(parsedRoster, [{ id: "p1", displayName: "Player 1" }]);
});

test("rejects invalid bearer credentials before reading the image", async () => {
  let parsed = false;
  const response = await handlePlacementOcrRequest(
    new Request("https://app.example/api/ocr/placements", {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
      body: form(),
    }),
    dependencies({ parseImage: async () => { parsed = true; return result; } }),
  );
  assert.equal(response.status, 401);
  assert.equal(parsed, false);
});

test("uses the server-side lobby roster for an authenticated organizer", async () => {
  let parsedRoster: unknown;
  const response = await handlePlacementOcrRequest(
    new Request("https://app.example/api/ocr/placements", {
      method: "POST",
      body: (() => {
        const data = form();
        data.append("tournamentId", "tournament-1");
        data.append("lobbyId", "lobby-1");
        data.append("roster", JSON.stringify([{ id: "attacker", displayName: "Attacker" }]));
        return data;
      })(),
    }),
    dependencies({
      getHostUserId: async () => "host-1",
      loadLobbyRoster: async (tournamentId, lobbyId, hostUserId) => {
        assert.deepEqual([tournamentId, lobbyId, hostUserId], ["tournament-1", "lobby-1", "host-1"]);
        return { status: "in_progress", roster: [{ id: "server-player", displayName: "Server Player" }] };
      },
      parseImage: async (_image, roster) => { parsedRoster = roster; return result; },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(parsedRoster, [{ id: "server-player", displayName: "Server Player" }]);
});

test("validates signatures, content types, and upload size", async () => {
  const invalidSignature = await handlePlacementOcrRequest(
    new Request("https://app.example/api/ocr/placements", { method: "POST", headers: { Authorization: "Bearer bot-secret" }, body: form(new Uint8Array([1, 2, 3])) }),
    dependencies(),
  );
  assert.equal(invalidSignature.status, 415);

  const unsupported = await handlePlacementOcrRequest(
    new Request("https://app.example/api/ocr/placements", { method: "POST", headers: { Authorization: "Bearer bot-secret" }, body: form(png, "image/gif") }),
    dependencies(),
  );
  assert.equal(unsupported.status, 415);

  const oversized = await handlePlacementOcrRequest(
    new Request("https://app.example/api/ocr/placements", { method: "POST", headers: { Authorization: "Bearer bot-secret" }, body: form(new Uint8Array(7 * 1024 * 1024 + 1)) }),
    dependencies(),
  );
  assert.equal(oversized.status, 413);
});

test("returns 422 when the parser finds no standings layout", async () => {
  const response = await handlePlacementOcrRequest(
    new Request("https://app.example/api/ocr/placements", {
      method: "POST",
      headers: { Authorization: "Bearer bot-secret" },
      body: form(),
    }),
    dependencies({
      parseImage: async () => ({ ...result, strategy: "unresolved", placements: [], status: "review_required" }),
    }),
  );
  assert.equal(response.status, 422);
  const body = await response.json() as PlacementParseResult & { error: string };
  assert.match(body.error, /exactly 8/);
  assert.deepEqual(body.debug.detectedWords, []);
});

test("rejects malformed rosters and sanitizes provider failures", async () => {
  const malformed = form();
  malformed.append("roster", "not-json");
  const malformedResponse = await handlePlacementOcrRequest(
    new Request("https://app.example/api/ocr/placements", { method: "POST", headers: { Authorization: "Bearer bot-secret" }, body: malformed }),
    dependencies(),
  );
  assert.equal(malformedResponse.status, 400);

  const providerResponse = await handlePlacementOcrRequest(
    new Request("https://app.example/api/ocr/placements", { method: "POST", headers: { Authorization: "Bearer bot-secret" }, body: form() }),
    dependencies({ parseImage: async () => { throw new PlacementParseError("Google Vision is temporarily unavailable.", 503, "OCR_PROVIDER_UNAVAILABLE", true); } }),
  );
  assert.equal(providerResponse.status, 503);
  assert.deepEqual(await providerResponse.json(), { error: "Google Vision is temporarily unavailable.", code: "OCR_PROVIDER_UNAVAILABLE", retryable: true });
});
