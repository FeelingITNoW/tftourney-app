import { requestGoogleSheetExport } from "../../../../../../lib/sheets/export-api";
import { getHostUserId } from "../../../../../../lib/auth/session";
import { scheduleTournamentSheetSync } from "../../../../../../lib/sheets/dispatch";
import { sheetErrorResponse } from "../../../../../../lib/sheets/http";
import { assertGoogleSheetSyncReady } from "../../../../../../lib/sheets/sync";

type Context = { params: Promise<{ tournamentId: string }> };

export async function POST(request: Request, context: Context) {
  const { tournamentId } = await context.params;
  try {
    const hostUserId = await getHostUserId(request);
    if (!hostUserId) return Response.json({ error: "Sign in to publish Google Sheets.", code: "AUTH_REQUIRED" }, { status: 401 });
    await assertGoogleSheetSyncReady(hostUserId);
    const status = await requestGoogleSheetExport({ tournamentId, hostUserId });
    scheduleTournamentSheetSync(tournamentId, hostUserId);
    return Response.json(status, { status: 202 });
  } catch (error) {
    return sheetErrorResponse(error, "Sheet export could not be queued.");
  }
}
