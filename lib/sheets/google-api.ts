import type { GoogleSheetAdapter, SheetCell, SheetTabModel, TournamentWorkbookModel } from "./types";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const SHEETS_URL = "https://sheets.googleapis.com/v4/spreadsheets";

export class GoogleApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, status: number, code = "GOOGLE_API_ERROR") {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
    this.code = code;
    this.retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  }
}

type GoogleFetch = typeof fetch;

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function requestJson<T>(
  fetchImpl: GoogleFetch,
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await parseResponse(response);
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error?: { message?: unknown } }).error?.message ?? "Google API request failed")
        : "Google API request failed";
    throw new GoogleApiError(message, response.status);
  }
  return body as T;
}

export async function refreshGoogleAccessToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: GoogleFetch;
}): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await parseResponse(response);
  if (!response.ok) {
    const errorCode =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error?: unknown }).error ?? "GOOGLE_TOKEN_ERROR")
        : "GOOGLE_TOKEN_ERROR";
    throw new GoogleApiError(
      errorCode === "invalid_grant" ? "Google authorization has expired. Reconnect Google." : "Google token refresh failed.",
      response.status,
      errorCode === "invalid_grant" ? "GOOGLE_REAUTH_REQUIRED" : errorCode,
    );
  }
  const accessToken = typeof body === "object" && body !== null ? (body as { access_token?: unknown }).access_token : null;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new GoogleApiError("Google did not return an access token.", 502, "GOOGLE_TOKEN_INVALID");
  }
  return accessToken;
}

function valueForGoogle(cell: SheetCell): string | number | boolean {
  if (cell.value === null) return "";
  return cell.value;
}

function columnLetter(index: number): string {
  let remaining = index + 1;
  let letters = "";
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

/**
 * Clear only the columns each tab actually uses. Clearing the full grid
 * (A:ZZ) on every sync wastes Google API quota and bandwidth, so scope the
 * clear range to the widest row while still clearing full column height so
 * shrunk rows (for example a smaller roster) are removed.
 */
function clearRangeForTab(tab: SheetTabModel): string {
  const columnCount = Math.max(...tab.rows.map((row) => row.length), 1);
  return `${tab.title}!A:${columnLetter(columnCount - 1)}`;
}

function cellData(cell: SheetCell) {
  if (typeof cell.value === "number") {
    return { userEnteredValue: { numberValue: cell.value } };
  }
  if (typeof cell.value === "boolean") {
    return { userEnteredValue: { boolValue: cell.value } };
  }
  return { userEnteredValue: { stringValue: cell.value ?? "" } };
}

function rangeForTab(tab: SheetTabModel, sheetId: number) {
  const rows = tab.rows.map((row) => ({ values: row.map(cellData) }));
  const columnCount = Math.max(...tab.rows.map((row) => row.length), 1);
  const headerRows = tab.rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => row.some((entry) => entry.kind === "header"));
  const titleRows = tab.rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => row.some((entry) => entry.kind === "title"));

  return {
    rows,
    requests: [
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: tab.frozenRows } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      ...(tab.filterRow === undefined
        ? []
        : [
            {
              setBasicFilter: {
                filter: {
                  range: {
                    sheetId,
                    startRowIndex: tab.filterRow,
                    endRowIndex: tab.rows.length,
                    startColumnIndex: 0,
                    endColumnIndex: columnCount,
                  },
                },
              },
            },
          ]),
      ...headerRows.map(({ rowIndex }) => ({
        repeatCell: {
          range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.06, green: 0.25, blue: 0.24 },
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat)",
        },
      })),
      ...titleRows.map(({ rowIndex }) => ({
        repeatCell: {
          range: { sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 14 } } },
          fields: "userEnteredFormat.textFormat",
        },
      })),
      {
        autoResizeDimensions: {
          dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: columnCount },
        },
      },
    ],
  };
}

export class GoogleSheetsHttpAdapter implements GoogleSheetAdapter {
  private readonly accessToken: string;
  private readonly fetchImpl: GoogleFetch;

  constructor(input: { accessToken: string; fetchImpl?: GoogleFetch }) {
    this.accessToken = input.accessToken;
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async createWorkbook(input: { title: string; exportId: string }) {
    const file = await requestJson<{ id?: string }>(this.fetchImpl, `${DRIVE_FILES_URL}?fields=id`, this.accessToken, {
      method: "POST",
      body: JSON.stringify({
        name: input.title,
        mimeType: "application/vnd.google-apps.spreadsheet",
        appProperties: { tftourney_export_id: input.exportId },
      }),
    });
    if (!file.id) throw new GoogleApiError("Google did not return a spreadsheet ID.", 502, "GOOGLE_FILE_INVALID");

    const metadata = await requestJson<{ sheets?: Array<{ properties?: { sheetId?: number } }> }>(
      this.fetchImpl,
      `${SHEETS_URL}/${encodeURIComponent(file.id)}?fields=sheets.properties.sheetId`,
      this.accessToken,
    );
    const firstSheetId = metadata.sheets?.[0]?.properties?.sheetId;
    if (typeof firstSheetId !== "number") throw new GoogleApiError("Google did not return the default sheet.", 502, "GOOGLE_SHEET_INVALID");

    const updated = await requestJson<{ replies?: unknown[]; updatedSpreadsheet?: { sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> } }>(
      this.fetchImpl,
      `${SHEETS_URL}/${encodeURIComponent(file.id)}:batchUpdate`,
      this.accessToken,
      {
        method: "POST",
        body: JSON.stringify({
          requests: [
            { updateSpreadsheetProperties: { properties: { title: input.title }, fields: "title" } },
            { updateSheetProperties: { properties: { sheetId: firstSheetId, title: "Players" }, fields: "title" } },
            { addSheet: { properties: { sheetId: 1001, title: "Scores" } } },
            { addSheet: { properties: { sheetId: 1002, title: "Checkmate" } } },
          ],
          includeSpreadsheetInResponse: true,
          responseIncludeGridData: false,
        }),
      },
    );
    void updated;

    await requestJson(this.fetchImpl, `${DRIVE_FILES_URL}/${encodeURIComponent(file.id)}/permissions?sendNotificationEmail=false`, this.accessToken, {
      method: "POST",
      body: JSON.stringify({ type: "anyone", role: "reader" }),
    });

    return {
      spreadsheetId: file.id,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${file.id}/edit?usp=sharing`,
      sheetIds: [firstSheetId, 1001, 1002] as [number, number, number],
    };
  }

  async writeWorkbook(input: { spreadsheetId: string; sheetIds: [number, number, number]; workbook: TournamentWorkbookModel }) {
    const values = input.workbook.tabs.map((tab) => ({
      range: `${tab.title}!A1`,
      majorDimension: "ROWS",
      values: tab.rows.map((row) => row.map(valueForGoogle)),
    }));
    await requestJson(this.fetchImpl, `${SHEETS_URL}/${encodeURIComponent(input.spreadsheetId)}/values:batchClear`, this.accessToken, {
      method: "POST",
      body: JSON.stringify({ ranges: input.workbook.tabs.map((tab) => clearRangeForTab(tab)) }),
    });
    await requestJson(this.fetchImpl, `${SHEETS_URL}/${encodeURIComponent(input.spreadsheetId)}/values:batchUpdate`, this.accessToken, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data: values }),
    });

    const formatting = input.workbook.tabs.flatMap((tab, index) =>
      rangeForTab(tab, input.sheetIds[index] as number).requests,
    );
    await requestJson(this.fetchImpl, `${SHEETS_URL}/${encodeURIComponent(input.spreadsheetId)}:batchUpdate`, this.accessToken, {
      method: "POST",
      body: JSON.stringify({ requests: formatting }),
    });
  }
}
