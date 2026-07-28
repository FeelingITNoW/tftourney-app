import { GoogleApiError } from "./google-api";
import { GoogleSheetConfigurationError } from "./sync";

export function sheetErrorResponse(error: unknown, fallback: string): Response {
  if (error instanceof Error && error.message === "TOURNAMENT_NOT_FOUND") {
    return Response.json({ error: "Tournament was not found.", code: "TOURNAMENT_NOT_FOUND" }, { status: 404 });
  }
  if (error instanceof GoogleApiError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof GoogleSheetConfigurationError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return Response.json({ error: fallback, code: "SHEET_EXPORT_ERROR" }, { status: 503 });
}
