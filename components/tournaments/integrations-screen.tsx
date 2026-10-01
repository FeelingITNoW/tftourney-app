import { GoogleSheetsPublishingPanel } from "@/components/tournaments/google-sheets-publishing-panel";
import { DiscordPanel } from "@/components/tournaments/discord-panel";
import type { GoogleSheetExportStatus } from "@/lib/sheets/types";
import type { TournamentCheckInState, TournamentDiscordConfig } from "@/lib/discord/api";

type IntegrationsScreenProps = {
  tournamentId: string;
  isTournamentHost: boolean;
  sheetStatus: GoogleSheetExportStatus | null;
  hasSheetSession: boolean;
  authError: string;
  authSuccess: boolean;
  discordConfig: TournamentDiscordConfig | null;
  rawDiscordConfig: TournamentDiscordConfig | null;
  checkInState: TournamentCheckInState | null;
  discordPendingTooLong: boolean;
  checkInError: string;
  checkInUpdated: string;
  discordError: string;
  discordConnected: boolean;
  discordDisconnected: string;
  discordManagerGranted: boolean;
  managerInvite: string;
};

// Shared Integrations screen: Google Sheets publishing plus the Discord
// bot/check-in panel. Used by both the pre-start and started layouts so
// these host-only cards only exist once each.
export function IntegrationsScreen({
  tournamentId,
  isTournamentHost,
  sheetStatus,
  hasSheetSession,
  authError,
  authSuccess,
  discordConfig,
  rawDiscordConfig,
  checkInState,
  discordPendingTooLong,
  checkInError,
  checkInUpdated,
  discordError,
  discordConnected,
  discordDisconnected,
  discordManagerGranted,
  managerInvite,
}: IntegrationsScreenProps) {
  return (
    <div className="space-y-5 pt-6">
      {isTournamentHost ? (
        <GoogleSheetsPublishingPanel
          authError={authError}
          authSuccess={authSuccess}
          initialStatus={sheetStatus}
          initiallyAuthenticated={hasSheetSession}
          tournamentId={tournamentId}
        />
      ) : (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-5 text-sm text-indigo-900">
          <p className="font-semibold">Google Sheets scoreboard</p>
          <p className="mt-1">The tournament host can connect Google Drive to generate and publish a workbook.</p>
        </div>
      )}
      <DiscordPanel
        checkInError={checkInError}
        checkInState={checkInState}
        checkInUpdated={checkInUpdated}
        discordConfig={discordConfig}
        discordConnected={discordConnected}
        discordDisconnected={discordDisconnected}
        discordError={discordError}
        discordManagerGranted={discordManagerGranted}
        discordPendingTooLong={discordPendingTooLong}
        isTournamentHost={isTournamentHost}
        managerInvite={managerInvite}
        rawDiscordConfig={rawDiscordConfig}
        tournamentId={tournamentId}
      />
    </div>
  );
}
