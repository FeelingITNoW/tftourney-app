export type SheetScalar = string | number | boolean | null;

export type SheetCell = {
  value: SheetScalar;
  kind?: "title" | "subtitle" | "header" | "number" | "status" | "note";
};

export type SheetTabModel = {
  title: "Players" | "Scores" | "Checkmate";
  rows: SheetCell[][];
  frozenRows: number;
  filterRow?: number;
};

export type TournamentWorkbookModel = {
  title: string;
  tabs: [SheetTabModel, SheetTabModel, SheetTabModel];
  generatedAt: string;
};

export type GoogleSheetExportState =
  | "not_created"
  | "queued"
  | "syncing"
  | "ready"
  | "error"
  | "needs_reauth";

export type GoogleSheetExportStatus = {
  tournamentId: string;
  state: GoogleSheetExportState;
  spreadsheetId: string | null;
  spreadsheetUrl: string | null;
  desiredRevision: number;
  syncedRevision: number;
  dirtyAt: string | null;
  lastSyncedAt: string | null;
  nextAttemptAt: string | null;
  lastError: { code: string; message: string } | null;
};

export type GoogleSheetExportRow = {
  id: string;
  tournament_id: string | number;
  host_user_id?: string | number;
  spreadsheet_id: string | null;
  spreadsheet_url: string | null;
  players_sheet_id?: number | null;
  scores_sheet_id?: number | null;
  checkmate_sheet_id?: number | null;
  state: GoogleSheetExportState;
  desired_revision: number;
  synced_revision: number;
  dirty_at: string | null;
  last_synced_at: string | null;
  next_attempt_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  retry_count?: number;
  lease_until?: string | null;
};

export type RequestGoogleSheetExportInput = {
  tournamentId: string;
  hostUserId?: string;
};

export type GoogleSheetAdapter = {
  createWorkbook(input: {
    title: string;
    exportId: string;
  }): Promise<{ spreadsheetId: string; spreadsheetUrl: string; sheetIds: [number, number, number] }>;
  writeWorkbook(input: {
    spreadsheetId: string;
    sheetIds: [number, number, number];
    workbook: TournamentWorkbookModel;
  }): Promise<void>;
};
