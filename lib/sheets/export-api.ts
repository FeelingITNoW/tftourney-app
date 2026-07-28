import { supabaseRestRequest } from "../db/supabase-rest/api";
import { getOrganizerGoogleConnection } from "../db/users/api";
import type { TournamentRow } from "../db/tournaments/types";
import type {
  GoogleSheetExportRow,
  GoogleSheetExportStatus,
  RequestGoogleSheetExportInput,
} from "./types";

const STANDARD_HOST_USER_ID = "1";
const EXPORT_SELECT =
  "id,tournament_id,host_user_id,spreadsheet_id,spreadsheet_url,players_sheet_id,scores_sheet_id,checkmate_sheet_id,state,desired_revision,synced_revision,dirty_at,last_synced_at,next_attempt_at,retry_count,lease_until,last_error_code,last_error_message";

function mapExportRow(tournamentId: string, row: GoogleSheetExportRow | undefined, connectionState: GoogleSheetExportStatus["connectionState"]): GoogleSheetExportStatus {
  if (!row) {
    return {
      tournamentId,
      connectionState,
      state: "not_created",
      spreadsheetId: null,
      spreadsheetUrl: null,
      desiredRevision: 0,
      syncedRevision: 0,
      dirtyAt: null,
      lastSyncedAt: null,
      nextAttemptAt: null,
      lastError: null,
    };
  }
  return {
    tournamentId,
    connectionState,
    state: row.state,
    spreadsheetId: row.spreadsheet_id,
    spreadsheetUrl: row.spreadsheet_url,
    desiredRevision: row.desired_revision,
    syncedRevision: row.synced_revision,
    dirtyAt: row.dirty_at,
    lastSyncedAt: row.last_synced_at,
    nextAttemptAt: row.next_attempt_at,
    lastError:
      row.last_error_code || row.last_error_message
        ? { code: row.last_error_code ?? "SHEET_EXPORT_ERROR", message: row.last_error_message ?? "Sheet export failed." }
        : null,
  };
}

async function assertTournamentHost(tournamentId: string, hostUserId: string): Promise<void> {
  const tournaments = await supabaseRestRequest<Pick<TournamentRow, "id" | "host_user_id">[]>("tournaments", {
    query: { select: "id,host_user_id", id: `eq.${tournamentId}`, limit: "1" },
  });
  const tournament = tournaments[0];
  if (!tournament || String(tournament.host_user_id ?? STANDARD_HOST_USER_ID) !== hostUserId) {
    throw new Error("TOURNAMENT_NOT_FOUND");
  }
}

export async function getGoogleSheetExportStatus(
  tournamentId: string,
  hostUserId = STANDARD_HOST_USER_ID,
): Promise<GoogleSheetExportStatus> {
  await assertTournamentHost(tournamentId, hostUserId);
  const connectionState = await getOrganizerGoogleConnection(hostUserId);
  const rows = await supabaseRestRequest<GoogleSheetExportRow[]>("tournament_sheet_exports", {
    query: {
      select: EXPORT_SELECT,
      tournament_id: `eq.${tournamentId}`,
      limit: "1",
    },
  });
  return mapExportRow(tournamentId, rows[0], connectionState);
}

export async function requestGoogleSheetExport(
  input: RequestGoogleSheetExportInput,
): Promise<GoogleSheetExportStatus> {
  const hostUserId = input.hostUserId ?? STANDARD_HOST_USER_ID;
  await assertTournamentHost(input.tournamentId, hostUserId);
  const existing = await supabaseRestRequest<GoogleSheetExportRow[]>("tournament_sheet_exports", {
    query: {
      select: EXPORT_SELECT,
      tournament_id: `eq.${input.tournamentId}`,
      limit: "1",
    },
  });
  const current = existing[0];
  const state = current?.state === "syncing" ? "syncing" : "queued";
  const body = {
    tournament_id: input.tournamentId,
    host_user_id: hostUserId,
    state,
    desired_revision: Math.max(current?.desired_revision ?? 0, (current?.synced_revision ?? 0) + 1),
    dirty_at: new Date().toISOString(),
    next_attempt_at: null,
    last_error_code: null,
    last_error_message: null,
  };
  const rows = current
    ? await supabaseRestRequest<GoogleSheetExportRow[]>("tournament_sheet_exports", {
        method: "PATCH",
        query: { id: `eq.${current.id}`, select: EXPORT_SELECT },
        prefer: "return=representation",
        body,
      })
    : await supabaseRestRequest<GoogleSheetExportRow[]>("tournament_sheet_exports", {
        method: "POST",
        query: { select: EXPORT_SELECT, on_conflict: "tournament_id" },
        prefer: "resolution=merge-duplicates,return=representation",
        body: { ...body, synced_revision: 0 },
      });
  return mapExportRow(input.tournamentId, rows[0] ?? { ...body, id: "pending", spreadsheet_id: null, spreadsheet_url: null, players_sheet_id: null, scores_sheet_id: null, checkmate_sheet_id: null, synced_revision: 0, last_synced_at: null, last_error_code: null, last_error_message: null, next_attempt_at: null } as GoogleSheetExportRow, "connected");
}
