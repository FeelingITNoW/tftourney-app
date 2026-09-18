import {
  closeTournamentCheckInAction,
  connectDiscordAction,
  createManagerInviteAction,
  disconnectDiscordAction,
  openTournamentCheckInAction,
} from "@/app/actions";
import { PendingButton } from "@/components/ui/pending-button";
import type {
  TournamentCheckInState,
  TournamentDiscordConfig,
} from "@/lib/discord/api";

type DiscordPanelProps = {
  tournamentId: string;
  isTournamentHost: boolean;
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

// Shared Discord card: shown both before a tournament starts (where hosts
// connect the bot) and once it's running (where the bot status, check-in
// controls, manager invite link, and disconnect actions still matter --
// removal, permission errors, and manager handoffs all happen mid-event).
export function DiscordPanel({
  tournamentId,
  isTournamentHost,
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
}: DiscordPanelProps) {
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-violet-950">Discord</h2>
      {discordConfig ? (
        <>
          <ol className="mt-3 space-y-2 text-sm">
            <li className="flex items-start gap-2 text-violet-900">
              <span aria-hidden="true">✅</span>
              <span>Bot added to server{discordConfig.guildName ? ` "${discordConfig.guildName}"` : ""}.</span>
            </li>
            <li className="flex items-start gap-2">
              {discordConfig.state === "error" ? (
                <>
                  <span aria-hidden="true">⚠️</span>
                  <span className="text-red-800">
                    Setup needs attention: {discordConfig.lastError ?? "the bot could not finish setting up this server."}{" "}
                    <a className="font-medium underline" href={`/api/auth/discord/bot-install?tournamentId=${tournamentId}`}>Reconnect</a>
                  </span>
                </>
              ) : discordConfig.state === "active" ? (
                <>
                  <span aria-hidden="true">✅</span>
                  <span className="text-violet-900">Channels are set up. Ready to go.</span>
                </>
              ) : (
                <>
                  <span aria-hidden="true">⏳</span>
                  <span className="text-violet-900">
                    Setting up #sign-up, #check-in, and #score-recording&hellip;
                    {discordPendingTooLong ? (
                      <span className="mt-1 block text-amber-800">
                        This is taking a while. Make sure the bot process is running (<code>npm run bot:dev</code>).
                      </span>
                    ) : null}
                  </span>
                </>
              )}
            </li>
          </ol>

          {discordConfig.state !== "error" ? (
            <div className="mt-4 rounded-md border border-violet-100 bg-white p-3">
              <h3 className="text-sm font-semibold text-violet-950">Check-in (optional)</h3>
              <p className="mt-1 text-sm text-violet-900">
                {checkInState?.status === "open"
                  ? `${checkInState.checkedInCount} players checked in. Discord's button updates within about 10 seconds.`
                  : checkInState?.status === "closed"
                    ? `Closed. ${checkInState.checkedInCount} players checked in.`
                    : "Not opened. Every registered player will enter unless you open check-in."}
              </p>
              <div className="mt-3 flex gap-2">
                {checkInState?.status === "open" ? (
                  <form action={closeTournamentCheckInAction} className="flex-1">
                    <input name="tournamentId" type="hidden" value={tournamentId} />
                    <PendingButton className="flex h-10 w-full items-center justify-center rounded-md bg-cyan-700 px-4 text-sm font-semibold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-zinc-300" disabled={!isTournamentHost} pendingLabel="Closing…">Close check-in</PendingButton>
                  </form>
                ) : (
                  <form action={openTournamentCheckInAction} className="flex-1">
                    <input name="tournamentId" type="hidden" value={tournamentId} />
                    <PendingButton className="flex h-10 w-full items-center justify-center rounded-md bg-cyan-700 px-4 text-sm font-semibold text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-zinc-300" disabled={!isTournamentHost} pendingLabel="Opening…">
                      {checkInState?.status === "closed" ? "Reopen check-in" : "Open check-in"}
                    </PendingButton>
                  </form>
                )}
              </div>
              {checkInError ? <p className="mt-2 text-sm font-medium text-red-700" role="alert">{checkInError}</p> : null}
              {checkInUpdated ? <p className="mt-2 text-sm font-medium text-emerald-800" role="status">Check-in {checkInUpdated.replaceAll("-", " ")}.</p> : null}
            </div>
          ) : null}

          <form action={createManagerInviteAction} className="mt-4">
            <input name="tournamentId" type="hidden" value={tournamentId} />
            <PendingButton className="flex h-11 w-full items-center justify-center rounded-md bg-violet-700 px-4 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-zinc-300" disabled={!isTournamentHost} pendingLabel="Creating link…">Create manager invite link</PendingButton>
          </form>
          {managerInvite ? <p className="mt-3 break-all rounded bg-white p-3 text-xs text-violet-950">{managerInvite}</p> : null}
          {discordManagerGranted ? <p className="mt-3 text-sm font-medium text-emerald-800" role="status">You now have manager access to this tournament&apos;s Discord channels.</p> : null}

          <div className="mt-4">
            <h3 className="text-sm font-semibold text-red-900">Disconnect</h3>
            <p className="mt-1 text-xs text-red-800">
              Turns off check-in (every registered player will enter) and stops the bot from managing this server.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <form action={disconnectDiscordAction} className="flex-1">
                <input name="tournamentId" type="hidden" value={tournamentId} />
                <input name="cleanupAction" type="hidden" value="archive" />
                <PendingButton
                  className="flex h-10 w-full items-center justify-center rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                  confirmMessage="Disconnect and archive this tournament's Discord channels? They'll be locked read-only and renamed, but kept in the server."
                  disabled={!isTournamentHost}
                  pendingLabel="Archiving…"
                >
                  Archive &amp; disconnect
                </PendingButton>
              </form>
              <form action={disconnectDiscordAction} className="flex-1">
                <input name="tournamentId" type="hidden" value={tournamentId} />
                <input name="cleanupAction" type="hidden" value="delete" />
                <PendingButton
                  className="flex h-10 w-full items-center justify-center rounded-md border border-red-300 bg-red-50 px-3 text-sm font-semibold text-red-800 hover:bg-red-100 disabled:cursor-not-allowed disabled:text-zinc-400"
                  confirmMessage="Disconnect and permanently delete this tournament's Discord category, channels, and manager role? This cannot be undone."
                  disabled={!isTournamentHost}
                  pendingLabel="Deleting…"
                >
                  Delete &amp; disconnect
                </PendingButton>
              </form>
            </div>
          </div>
        </>
      ) : isTournamentHost ? (
        <div className="mt-4 space-y-3">
          <form action={connectDiscordAction} className="space-y-3">
            <input name="tournamentId" type="hidden" value={tournamentId} />
            <label className="block text-sm font-medium text-violet-950" htmlFor="guildId">Discord server ID</label>
            <input className="h-11 w-full rounded-md border border-violet-300 bg-white px-3 text-base text-zinc-950" id="guildId" name="guildId" placeholder="123456789012345678" required />
            <p className="text-xs text-violet-800">
              In Discord, enable Developer Mode (User Settings → Advanced), then right-click the server icon and choose &quot;Copy Server ID&quot;. Make sure the bot has already been added to that server first.
            </p>
            <PendingButton className="flex h-11 w-full items-center justify-center rounded-md bg-violet-700 px-4 text-sm font-semibold text-white hover:bg-violet-800" pendingLabel="Connecting…">Connect Discord</PendingButton>
          </form>
          <details className="text-sm text-violet-900">
            <summary className="cursor-pointer font-medium">Or use one-click authorize instead</summary>
            <a
              className="mt-3 flex h-11 w-full items-center justify-center rounded-md bg-violet-700 px-4 text-sm font-semibold text-white hover:bg-violet-800"
              href={`/api/auth/discord/bot-install?tournamentId=${tournamentId}`}
            >
              Connect a Discord server
            </a>
            <p className="mt-2 text-xs text-violet-800">
              Adds the bot and connects its server in one step, no ID to copy. Can be slower to finish setting up than the manual form above.
            </p>
          </details>
        </div>
      ) : (
        <p className="mt-2 text-sm text-violet-900">Only the tournament host can connect Discord.</p>
      )}
      {discordError ? <p className="mt-3 text-sm font-medium text-red-700" role="alert">{discordError}</p> : null}
      {discordConnected ? <p className="mt-3 text-sm font-medium text-emerald-800" role="status">Discord connection queued. This card updates automatically once it&apos;s ready.</p> : null}
      {discordDisconnected === "archive" ? <p className="mt-3 text-sm font-medium text-zinc-700" role="status">Discord disconnected. Channels are being archived in the background.</p> : null}
      {discordDisconnected === "delete" ? <p className="mt-3 text-sm font-medium text-zinc-700" role="status">Discord disconnected. Channels are being deleted in the background.</p> : null}
      {rawDiscordConfig?.state === "disabled" && rawDiscordConfig.cleanupAction && !rawDiscordConfig.cleanupCompletedAt && !discordDisconnected ? (
        <p className="mt-3 text-sm text-zinc-600" role="status">Still {rawDiscordConfig.cleanupAction === "delete" ? "deleting" : "archiving"} Discord channels in the background&hellip;</p>
      ) : null}
    </div>
  );
}
