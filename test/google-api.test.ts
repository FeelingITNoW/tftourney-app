import assert from "node:assert/strict";
import test from "node:test";
import { GoogleSheetsHttpAdapter, GoogleApiError, clearGoogleAccessTokenCache, getCachedGoogleAccessToken, refreshGoogleAccessToken } from "../lib/sheets/google-api";
import type { TournamentWorkbookModel } from "../lib/sheets/types";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

const workbook: TournamentWorkbookModel = {
  title: "Test Tournament",
  generatedAt: "2026-07-22T00:00:00.000Z",
  tabs: [
    { title: "Players", frozenRows: 4, rows: [[{ value: "Title", kind: "title" }]] },
    { title: "Scores", frozenRows: 4, rows: [[{ value: "Rank", kind: "header" }, { value: "Score", kind: "header" }]] },
    { title: "Checkmate", frozenRows: 2, rows: [[{ value: "None", kind: "note" }]] },
  ],
};

test("refreshes Google access tokens and classifies revoked consent", async () => {
  const token = await refreshGoogleAccessToken({
    refreshToken: "refresh-token",
    clientId: "client-id",
    clientSecret: "client-secret",
    fetchImpl: async (_input, init) => {
      assert.equal(init?.method, "POST");
      assert.match(String(init?.body), /grant_type=refresh_token/);
      return jsonResponse({ access_token: "access-token" });
    },
  });
  assert.equal(token, "access-token");

  await assert.rejects(
    () => refreshGoogleAccessToken({
      refreshToken: "revoked",
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl: async () => jsonResponse({ error: "invalid_grant" }, 400),
    }),
    (error: unknown) => error instanceof GoogleApiError && error.code === "GOOGLE_REAUTH_REQUIRED",
  );
});

test("creates a shared workbook with stable tabs and writes managed ranges", async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const adapter = new GoogleSheetsHttpAdapter({
    accessToken: "access-token",
    fetchImpl: async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method: init?.method ?? "GET", body });
      if (url.includes("/drive/v3/files?") && (init?.method ?? "GET") === "POST") return jsonResponse({ id: "sheet-1" });
      if (url.includes("/spreadsheets/sheet-1?") && (init?.method ?? "GET") === "GET") {
        return jsonResponse({ sheets: [{ properties: { sheetId: 7 } }] });
      }
      if (url.includes(":batchUpdate") && (init?.method ?? "GET") === "POST") return jsonResponse({ updatedSpreadsheet: { sheets: [] } });
      if (url.includes("/permissions")) return jsonResponse({ id: "anyone" });
      if (url.includes("values:batchClear")) return jsonResponse({});
      if (url.includes("values:batchUpdate")) return jsonResponse({});
      throw new Error(`Unexpected Google request ${url}`);
    },
  });

  const created = await adapter.createWorkbook({ title: workbook.title, exportId: "export-1" });
  assert.deepEqual(created, {
    spreadsheetId: "sheet-1",
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit?usp=sharing",
    sheetIds: [7, 1001, 1002],
  });
  const createBody = calls[0]?.body as { appProperties?: Record<string, string>; mimeType?: string };
  assert.equal(createBody.mimeType, "application/vnd.google-apps.spreadsheet");
  assert.equal(createBody.appProperties?.tftourney_export_id, "export-1");
  const permissionBody = calls.find((call) => call.url.includes("/permissions"))?.body as { type?: string; role?: string };
  assert.deepEqual(permissionBody, { type: "anyone", role: "reader" });

  await adapter.writeWorkbook({ spreadsheetId: "sheet-1", sheetIds: created.sheetIds, workbook });
  const clear = calls.find((call) => call.url.includes("values:batchClear"))?.body as { ranges?: string[] };
  assert.deepEqual(clear.ranges, ["Players!A:A", "Scores!A:B", "Checkmate!A:A"]);
  const valuesUpdate = calls.find((call) => call.url.includes("values:batchUpdate"))?.body as { valueInputOption?: string; data?: Array<{ values: unknown[][] }> };
  assert.equal(valuesUpdate.valueInputOption, "RAW");
  assert.deepEqual(valuesUpdate.data?.[1]?.values?.[0], ["Rank", "Score"]);
  assert.ok(calls.some((call) => call.url.includes(":batchUpdate") && call.body && typeof call.body === "object" && "requests" in (call.body as object)));
});

test("getCachedGoogleAccessToken reuses a token until it nears expiry, then refreshes", async () => {
  clearGoogleAccessTokenCache();
  let exchangeCount = 0;
  const fetchImpl = async () => {
    exchangeCount += 1;
    return jsonResponse({ access_token: `access-token-${exchangeCount}`, expires_in: 3600 });
  };

  const first = await getCachedGoogleAccessToken({
    cacheKey: "host-1",
    refreshToken: "refresh-token",
    clientId: "client-id",
    clientSecret: "client-secret",
    fetchImpl,
    now: 0,
  });
  assert.equal(first, "access-token-1");
  assert.equal(exchangeCount, 1);

  // Well within the cached token's lifetime: no new exchange.
  const second = await getCachedGoogleAccessToken({
    cacheKey: "host-1",
    refreshToken: "refresh-token",
    clientId: "client-id",
    clientSecret: "client-secret",
    fetchImpl,
    now: 30 * 60_000,
  });
  assert.equal(second, "access-token-1");
  assert.equal(exchangeCount, 1);

  // A different host never shares a cached token.
  const otherHost = await getCachedGoogleAccessToken({
    cacheKey: "host-2",
    refreshToken: "refresh-token",
    clientId: "client-id",
    clientSecret: "client-secret",
    fetchImpl,
    now: 30 * 60_000,
  });
  assert.equal(otherHost, "access-token-2");
  assert.equal(exchangeCount, 2);

  // A new refresh token for the same host (e.g. reconnected Google) is never
  // served the token cached under the old one.
  const reconnected = await getCachedGoogleAccessToken({
    cacheKey: "host-1",
    refreshToken: "new-refresh-token",
    clientId: "client-id",
    clientSecret: "client-secret",
    fetchImpl,
    now: 30 * 60_000,
  });
  assert.equal(reconnected, "access-token-3");
  assert.equal(exchangeCount, 3);

  // Within the expiry buffer of the original token: refreshes again.
  const refreshed = await getCachedGoogleAccessToken({
    cacheKey: "host-1",
    refreshToken: "refresh-token",
    clientId: "client-id",
    clientSecret: "client-secret",
    fetchImpl,
    now: 3600_000 - 30_000,
  });
  assert.equal(refreshed, "access-token-4");
  assert.equal(exchangeCount, 4);
});
