import { after } from "next/server";
import { syncTournamentSheetExportForTournament } from "./sync";

/**
 * Start the explicitly requested export after the queue response is sent.
 * The catch for an absent request scope keeps direct route-handler unit tests
 * deterministic; Next route requests always provide the required scope.
 */
export function scheduleTournamentSheetSync(tournamentId: string, hostUserId: string): void {
  try {
    after(async () => {
      try {
        await syncTournamentSheetExportForTournament(tournamentId, hostUserId);
      } catch (error) {
        console.error("Scheduled tournament sheet sync failed", {
          tournamentId,
          error: error instanceof Error ? error.message : error,
        });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("outside a request scope")) return;
    throw error;
  }
}
