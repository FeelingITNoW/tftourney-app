import { getTournamentDetail } from "../db/tournaments/api";
import { supabaseRestRequest } from "../db/supabase-rest/api";
import { decryptGoogleRefreshToken } from "./crypto";
import { GoogleApiError, GoogleSheetsHttpAdapter, refreshGoogleAccessToken } from "./google-api";
import { buildTournamentWorkbook } from "./projection";
import type { GoogleSheetExportRow } from "./types";

type GoogleConnectionRow = {
  user_id: string | number;
  encrypted_refresh_token: string | null;
  status: "connected" | "needs_reauth" | "disconnected";
};

type SyncResult = { exportId: string; state: "ready" | "queued" | "error" | "needs_reauth"; message?: string };

function googleClientCredentials(): { clientId: string; clientSecret: string } {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID ?? process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET ?? "",
  };
}

export class GoogleSheetConfigurationError extends Error {
  readonly status = 503;
  readonly code: string;

  constructor(message: string, code = "GOOGLE_SHEETS_NOT_CONFIGURED") {
    super(message);
    this.name = "GoogleSheetConfigurationError";
    this.code = code;
  }
}

async function getRefreshToken(hostUserId: string): Promise<string> {
  const rows = await supabaseRestRequest<GoogleConnectionRow[]>("organizer_google_connections", {
    query: { select: "user_id,encrypted_refresh_token,status", user_id: `eq.${hostUserId}`, limit: "1" },
  });
  const connection = rows[0];
  if (connection?.status === "needs_reauth" || connection?.status === "disconnected") {
    throw new GoogleApiError("Reconnect Google before publishing sheets.", 401, "GOOGLE_REAUTH_REQUIRED");
  }
  if (connection?.encrypted_refresh_token) {
    const encryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw new GoogleSheetConfigurationError(
        "Google Sheets publishing is not fully configured. Set GOOGLE_TOKEN_ENCRYPTION_KEY.",
        "GOOGLE_TOKEN_ENCRYPTION_MISSING",
      );
    }
    try {
      return decryptGoogleRefreshToken(connection.encrypted_refresh_token, encryptionKey);
    } catch {
      throw new GoogleApiError("Stored Google authorization is invalid. Reconnect Google before publishing sheets.", 401, "GOOGLE_REAUTH_REQUIRED");
    }
  }
  const fallback = process.env.GOOGLE_REFRESH_TOKEN;
  if (process.env.TFT_REQUIRE_AUTH === "false" && fallback) return fallback;
  throw new GoogleApiError("Connect Google before publishing sheets.", 409, "GOOGLE_CONNECTION_REQUIRED");
}

export async function assertGoogleSheetSyncReady(hostUserId: string): Promise<void> {
  const credentials = googleClientCredentials();
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new GoogleSheetConfigurationError(
      "Google Sheets publishing is not fully configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
    );
  }
  await getRefreshToken(hostUserId);
}

async function completeExport(exportRow: GoogleSheetExportRow, input: { spreadsheetId: string; spreadsheetUrl: string; sheetIds: [number, number, number] }) {
  return supabaseRestRequest("rpc/complete_tournament_sheet_export", {
    method: "POST",
    body: {
      p_export_id: exportRow.id,
      p_revision: exportRow.desired_revision,
      p_spreadsheet_id: input.spreadsheetId,
      p_spreadsheet_url: input.spreadsheetUrl,
      p_players_sheet_id: input.sheetIds[0],
      p_scores_sheet_id: input.sheetIds[1],
      p_checkmate_sheet_id: input.sheetIds[2],
    },
  });
}

async function reserveWorkbook(
  exportRow: GoogleSheetExportRow,
  input: { spreadsheetId: string; spreadsheetUrl: string; sheetIds: [number, number, number] },
): Promise<void> {
  await supabaseRestRequest("tournament_sheet_exports", {
    method: "PATCH",
    query: { id: `eq.${exportRow.id}` },
    prefer: "return=minimal",
    body: {
      spreadsheet_id: input.spreadsheetId,
      spreadsheet_url: input.spreadsheetUrl,
      players_sheet_id: input.sheetIds[0],
      scores_sheet_id: input.sheetIds[1],
      checkmate_sheet_id: input.sheetIds[2],
      state: "syncing",
    },
  });
}

async function failExport(exportRow: GoogleSheetExportRow, error: unknown) {
  const googleError = error instanceof GoogleApiError ? error : null;
  const configurationError = error instanceof GoogleSheetConfigurationError ? error : null;
  const code = googleError?.code ?? configurationError?.code ?? "SHEET_EXPORT_ERROR";
  const message = error instanceof Error ? error.message : "Sheet export failed.";
  await supabaseRestRequest("rpc/fail_tournament_sheet_export", {
    method: "POST",
    body: {
      p_export_id: exportRow.id,
      p_error_code: code,
      p_error_message: message,
      p_retryable: googleError?.retryable ?? false,
    },
  });
  return { exportId: exportRow.id, state: code === "GOOGLE_REAUTH_REQUIRED" ? "needs_reauth" : googleError?.retryable ? "queued" : "error", message } as SyncResult;
}

export async function syncTournamentSheetExport(exportRow: GoogleSheetExportRow): Promise<SyncResult> {
  try {
    const detail = await getTournamentDetail(String(exportRow.tournament_id));
    if (!detail) throw new Error("Tournament was not found.");
    const refreshToken = await getRefreshToken(String(exportRow.host_user_id ?? 1));
    const credentials = googleClientCredentials();
    const accessToken = await refreshGoogleAccessToken({
      refreshToken,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
    });
    const adapter = new GoogleSheetsHttpAdapter({ accessToken });
    const workbook = buildTournamentWorkbook(detail);
    const existingSheetIds = [exportRow.players_sheet_id, exportRow.scores_sheet_id, exportRow.checkmate_sheet_id];
    const hasExistingWorkbook = Boolean(
      exportRow.spreadsheet_id && existingSheetIds.every((id): id is number => typeof id === "number"),
    );
    const created = hasExistingWorkbook
      ? {
          spreadsheetId: exportRow.spreadsheet_id as string,
          spreadsheetUrl: exportRow.spreadsheet_url ?? `https://docs.google.com/spreadsheets/d/${exportRow.spreadsheet_id}/edit?usp=sharing`,
          sheetIds: existingSheetIds as [number, number, number],
        }
      : await adapter.createWorkbook({ title: workbook.title, exportId: exportRow.id });
    if (!hasExistingWorkbook) await reserveWorkbook(exportRow, created);
    await adapter.writeWorkbook({ ...created, workbook });
    await completeExport(exportRow, created);
    return { exportId: exportRow.id, state: "ready" };
  } catch (error) {
    return failExport(exportRow, error);
  }
}

export async function syncTournamentSheetExportForTournament(
  tournamentId: string,
  hostUserId: string,
): Promise<SyncResult | null> {
  const claimed = (await supabaseRestRequest<GoogleSheetExportRow[]>("rpc/claim_tournament_sheet_export", {
    method: "POST",
    body: {
      p_tournament_id: tournamentId,
      p_host_user_id: hostUserId,
    },
  })) ?? [];
  const exportRow = claimed[0];
  return exportRow ? syncTournamentSheetExport(exportRow) : null;
}

export async function runSheetSyncBatch(limit = 10): Promise<SyncResult[]> {
  const claimed = await supabaseRestRequest<GoogleSheetExportRow[]>("rpc/claim_tournament_sheet_exports", {
    method: "POST",
    body: { p_limit: limit },
  });
  const results: SyncResult[] = [];
  for (const exportRow of claimed) results.push(await syncTournamentSheetExport(exportRow));
  return results;
}
