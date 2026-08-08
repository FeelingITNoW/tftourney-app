import assert from "node:assert/strict";
import test from "node:test";
import {
  drainTargetedSheetExport,
  mapWithBoundedWorkers,
} from "../lib/sheets/sync";
import type { GoogleSheetExportRow } from "../lib/sheets/types";

function exportRow(id: string): GoogleSheetExportRow {
  return {
    id,
    tournament_id: `tournament-${id}`,
    host_user_id: "host-1",
    spreadsheet_id: "spreadsheet-1",
    spreadsheet_url: null,
    players_sheet_id: 1,
    scores_sheet_id: 2,
    checkmate_sheet_id: 3,
    state: "syncing",
    desired_revision: 1,
    synced_revision: 0,
    dirty_at: null,
    last_synced_at: null,
    next_attempt_at: null,
    last_error_code: null,
    last_error_message: null,
  };
}

test("bounded workers limit concurrent work and preserve item order", async () => {
  let active = 0;
  let maxActive = 0;
  const results = await mapWithBoundedWorkers([1, 2, 3, 4, 5, 6], 2, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, value === 1 ? 8 : 1));
    active -= 1;
    return value * 10;
  });

  assert.equal(maxActive, 2);
  assert.deepEqual(results, [10, 20, 30, 40, 50, 60]);
});

test("targeted sync drains a revision dirtied during the first write", async () => {
  let claimCount = 0;
  const synced: string[] = [];
  const row = exportRow("one");
  const result = await drainTargetedSheetExport(
    async () => {
      claimCount += 1;
      return claimCount <= 2 ? row : undefined;
    },
    async (claimed) => {
      synced.push(claimed.id);
      return { exportId: claimed.id, state: "ready" };
    },
  );

  assert.deepEqual(synced, ["one", "one"]);
  assert.equal(claimCount, 3);
  assert.deepEqual(result, { exportId: "one", state: "ready" });
});

test("targeted sync stops after the configured pass cap or a retry result", async () => {
  let capClaims = 0;
  const row = exportRow("capped");
  await drainTargetedSheetExport(
    async () => {
      capClaims += 1;
      return row;
    },
    async (claimed) => ({ exportId: claimed.id, state: "ready" }),
  );
  assert.equal(capClaims, 3);

  let retryClaims = 0;
  const retryResult = await drainTargetedSheetExport(
    async () => {
      retryClaims += 1;
      return row;
    },
    async (claimed) => ({ exportId: claimed.id, state: "queued", message: "retry later" }),
  );
  assert.equal(retryClaims, 1);
  assert.deepEqual(retryResult, { exportId: "capped", state: "queued", message: "retry later" });
});
