import assert from "node:assert/strict";
import test from "node:test";
import { GoogleSheetsHttpAdapter, refreshGoogleAccessToken } from "../lib/sheets/google-api";
import type { TournamentWorkbookModel } from "../lib/sheets/types";

const liveEnabled = Boolean(
  process.env.GOOGLE_LIVE_TEST_REFRESH_TOKEN &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET,
);

test("creates and reads a real Google Sheets workbook", { skip: !liveEnabled }, async () => {
  const accessToken = await refreshGoogleAccessToken({
    refreshToken: process.env.GOOGLE_LIVE_TEST_REFRESH_TOKEN as string,
    clientId: process.env.GOOGLE_CLIENT_ID as string,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
  });
  const adapter = new GoogleSheetsHttpAdapter({ accessToken });
  const workbook: TournamentWorkbookModel = {
    title: `TFTourney live test ${Date.now()}`,
    generatedAt: new Date().toISOString(),
    tabs: [
      { title: "Players", frozenRows: 4, rows: [[{ value: "Live test", kind: "title" }, { value: null }], [], [], [{ value: "Seed", kind: "header" }, { value: "Player", kind: "header" }], [{ value: 1, kind: "number" }, { value: "Live Alpha" }]] },
      { title: "Scores", frozenRows: 4, rows: [[{ value: "Scores", kind: "title" }], [], [], [{ value: "Rank", kind: "header" }, { value: "Player", kind: "header" }, { value: "Total", kind: "header" }], [{ value: 1, kind: "number" }, { value: "Live Alpha" }, { value: 8, kind: "number" }]] },
      { title: "Checkmate", frozenRows: 2, rows: [[{ value: "Checkmate", kind: "title" }], [{ value: "Check = more than 18 points before a game", kind: "subtitle" }]] },
    ],
  };
  const created = await adapter.createWorkbook({ title: workbook.title, exportId: `live-${Date.now()}` });
  try {
    await adapter.writeWorkbook({ ...created, workbook });
    const valuesResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${created.spreadsheetId}/values/Players!A1:B5`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(valuesResponse.ok, true);
    const values = (await valuesResponse.json()) as { values?: unknown[][] };
    assert.equal(values.values?.[4]?.[1], "Live Alpha");
    console.log(`Live Google Sheet created: ${created.spreadsheetUrl}`);
  } finally {
    if (process.env.KEEP_LIVE_GOOGLE_SHEET !== "1") {
      await fetch(`https://www.googleapis.com/drive/v3/files/${created.spreadsheetId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      });
    }
  }
});
