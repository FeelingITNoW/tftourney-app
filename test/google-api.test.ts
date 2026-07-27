import assert from "node:assert/strict";
import test from "node:test";
import { GoogleSheetsHttpAdapter, GoogleApiError, refreshGoogleAccessToken } from "../lib/sheets/google-api";
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
  const valuesUpdate = calls.find((call) => call.url.includes("values:batchUpdate"))?.body as { valueInputOption?: string; data?: Array<{ values: unknown[][] }> };
  assert.equal(valuesUpdate.valueInputOption, "RAW");
  assert.deepEqual(valuesUpdate.data?.[1]?.values?.[0], ["Rank", "Score"]);
  assert.ok(calls.some((call) => call.url.includes(":batchUpdate") && call.body && typeof call.body === "object" && "requests" in (call.body as object)));
});
