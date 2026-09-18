import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  addRandomSeededPlayersAction,
  deleteTournamentAction,
  finalizeTournamentNodeAction,
  setRegistrationCheckInAction,
  randomizePendingLobbyResultsAction,
  registerPlayerAction,
  startTournamentAction,
} from "@/app/actions";
import { LobbyBrowser } from "@/components/tournaments/lobby-browser";
import { TournamentGraph } from "@/components/tournaments/tournament-graph";
import { RoundTabs } from "@/components/tournaments/round-tabs";
import { Scoresheet } from "@/components/tournaments/scoresheet";
import { TournamentDetails } from "@/components/tournaments/tournament-details";
import { GoogleSheetsPublishingPanel } from "@/components/tournaments/google-sheets-publishing-panel";
import { DiscordPanel } from "@/components/tournaments/discord-panel";
import { AccountHeader } from "@/components/account/account-header";
import { PendingButton } from "@/components/ui/pending-button";
import {
  getTournamentPageViewModel,
  TOURNAMENT_STATUS_ACCEPTING_PLAYERS,
} from "@/lib/db/tournaments/api";
import type { TournamentDetail, TournamentDetailPageViewModel, TournamentPanelView } from "@/lib/db/tournaments/types";
import { getOrganizerSession } from "@/lib/auth/session";
import { selectTournamentEntrants } from "@/lib/tournament/start/api";
import { getTournamentCheckInState, getTournamentDiscordConfig, isDiscordConfigPendingTooLong } from "@/lib/discord/api";
import { LiveRefresh } from "@/components/tournaments/live-refresh";

export const dynamic = "force-dynamic";

type TournamentPageParams = Promise<{
  tournamentId: string;
}>;

type TournamentPageSearchParams = Promise<{
  view?: string | string[];
  game?: string | string[];
  page?: string | string[];
  randomized?: string | string[];
  registrationError?: string | string[];
  randomPlayerError?: string | string[];
  randomPlayersAdded?: string | string[];
  randomPlayersSkipped?: string | string[];
  startError?: string | string[];
  progressionError?: string | string[];
  progressed?: string | string[];
  deleteError?: string | string[];
  node?: string | string[];
  authError?: string | string[];
  authSuccess?: string | string[];
  authorizationError?: string | string[];
  checkInError?: string | string[];
  checkInUpdated?: string | string[];
  discordError?: string | string[];
  discordConnected?: string | string[];
  discordDisconnected?: string | string[];
  discordManager?: string | string[];
  managerInvite?: string | string[];
}>;

function getSearchValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

export default async function TournamentPage({
  params,
  searchParams,
}: {
  params: TournamentPageParams;
  searchParams: TournamentPageSearchParams;
}) {
  const { tournamentId } = await params;
  const query = await searchParams;
  const requestedGame = Number.parseInt(getSearchValue(query.game), 10);
  const requestedPage = Number.parseInt(getSearchValue(query.page), 10);
  const parsedPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const randomized = getSearchValue(query.randomized) === "true";
  const registrationError = getSearchValue(query.registrationError);
  const randomPlayerError = getSearchValue(query.randomPlayerError);
  const randomPlayersAdded = Number.parseInt(getSearchValue(query.randomPlayersAdded), 10);
  const randomPlayersSkipped = Number.parseInt(getSearchValue(query.randomPlayersSkipped), 10);
  const startError = getSearchValue(query.startError);
  const progressionError = getSearchValue(query.progressionError);
  const progressed = getSearchValue(query.progressed) === "true";
  const deleteError = getSearchValue(query.deleteError);
  const requestedNode = getSearchValue(query.node);
  const requestedView = getSearchValue(query.view);
  const authError = getSearchValue(query.authError);
  const authSuccess = getSearchValue(query.authSuccess) === "google_sheets";
  const authorizationError = getSearchValue(query.authorizationError);
  const checkInError = getSearchValue(query.checkInError);
  const checkInUpdated = getSearchValue(query.checkInUpdated);
  const discordError = getSearchValue(query.discordError);
  const discordConnected = getSearchValue(query.discordConnected) === "true";
  const discordDisconnected = getSearchValue(query.discordDisconnected);
  const discordManagerGranted = getSearchValue(query.discordManager) === "granted";
  const managerInvite = getSearchValue(query.managerInvite);
  const organizer = await getOrganizerSession();
  const view: TournamentPanelView = requestedView === "scoresheet" || requestedView === "graph" || requestedView === "details" || requestedView === "lobbies"
    ? requestedView
    : "lobbies";
  let tournament: (TournamentDetailPageViewModel & Pick<TournamentDetail, "registrations" | "participants" | "lobbies" | "gameScores" | "scores" | "roundProgress" | "progressionAction">) | null | undefined;
  let databaseError = "";

  try {
    const pageModel = await getTournamentPageViewModel(tournamentId, {
      view,
      selectedNodeId: requestedNode || undefined,
      gameNumber: Number.isInteger(requestedGame) && requestedGame > 0 ? requestedGame : undefined,
      page: Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
      pageSize: 8,
      hostUserId: organizer?.hostUserId,
    });
    if (pageModel) {
      const details = pageModel.panel.view === "details" ? pageModel.panel : null;
      const lobbies = pageModel.panel.view === "lobbies" ? pageModel.panel : null;
      const scorePanel = pageModel.panel.view === "scoresheet" ? pageModel.panel : null;
      tournament = {
        ...pageModel,
        registrations: details?.registrations ?? [],
        participants: details?.participants ?? [],
        lobbies: lobbies?.lobbies ?? [],
        gameScores: [],
        scores: [],
        roundProgress: lobbies?.roundProgress ?? null,
        progressionAction: lobbies?.progressionAction ?? null,
        ...(scorePanel ? { scores: [], gameScores: [] } : {}),
      };
    } else {
      tournament = null;
    }
  } catch (error) {
    databaseError =
      error instanceof Error
        ? error.message
        : "Tournament data could not be loaded.";
  }

  if (!databaseError && !tournament) {
    notFound();
  }

  const isTournamentHost = Boolean(tournament && organizer && organizer.hostUserId === tournament.hostUserId);
  const rawDiscordConfig = tournament && isTournamentHost ? await getTournamentDiscordConfig(tournament.id).catch(() => null) : null;
  // A "disabled" config is a soft-disconnect (see disconnectDiscordAction):
  // treat it as not connected everywhere on this page.
  const discordConfig = rawDiscordConfig && rawDiscordConfig.state !== "disabled" ? rawDiscordConfig : null;
  const checkInState = discordConfig ? await getTournamentCheckInState(tournament!.id).catch(() => null) : null;
  const discordPendingTooLong = isDiscordConfigPendingTooLong(discordConfig);

  const lobbyPanel = tournament?.panel.view === "lobbies" ? tournament.panel : null;
  const scoresheetPanel = tournament?.panel.view === "scoresheet" ? tournament.panel : null;
  const graphPanel = tournament?.panel.view === "graph" ? tournament.panel : null;

  if (tournament) {
    const canonicalView: TournamentPanelView = tournament.hasStarted ? view : "details";
    const pageIsMalformed = Array.isArray(query.page) || (getSearchValue(query.page) !== "" && !/^[1-9]\d*$/.test(getSearchValue(query.page)));
    const gameIsMalformed = Array.isArray(query.game) || (getSearchValue(query.game) !== "" && !/^[1-9]\d*$/.test(getSearchValue(query.game)));
    const viewIsMalformed = Array.isArray(query.view);
    const nodeIsRepeated = Array.isArray(query.node);
    const canonicalParams = new URLSearchParams();
    if (canonicalView !== "lobbies" && tournament.hasStarted) canonicalParams.set("view", canonicalView);
    if (canonicalView === "lobbies" && requestedNode && tournament.selectedNodeId) canonicalParams.set("node", tournament.selectedNodeId);
    if (canonicalView === "lobbies" && Number.isInteger(requestedGame) && requestedGame > 0 && lobbyPanel?.selectedGameNumber) canonicalParams.set("game", String(lobbyPanel.selectedGameNumber));
    if (!pageIsMalformed && !gameIsMalformed && lobbyPanel && parsedPage > lobbyPanel.totalPages) {
      if (lobbyPanel.totalPages > 1) canonicalParams.set("page", String(lobbyPanel.totalPages));
      redirect(`/tournaments/${tournamentId}${canonicalParams.toString() ? `?${canonicalParams}` : ""}`);
    }
    const invalidNode = canonicalView === "lobbies" && Boolean(requestedNode) && requestedNode !== tournament.selectedNodeId;
    const invalidGame = canonicalView === "lobbies" && Number.isInteger(requestedGame) && requestedGame > 0 && requestedGame !== lobbyPanel?.selectedGameNumber;
    const unrelatedPanelParams = canonicalView !== "lobbies" && Boolean(requestedNode || getSearchValue(query.game) || getSearchValue(query.page));
    if (pageIsMalformed || gameIsMalformed || viewIsMalformed || nodeIsRepeated || getSearchValue(query.page) === "1" || requestedView === "lobbies" || (requestedView && requestedView !== canonicalView) || invalidNode || invalidGame || unrelatedPanelParams) {
      redirect(`/tournaments/${tournamentId}${canonicalParams.toString() ? `?${canonicalParams}` : ""}`);
    }
  }


  const isAcceptingPlayers =
    tournament?.status === TOURNAMENT_STATUS_ACCEPTING_PLAYERS;
  const hasSheetSession = isTournamentHost;
  const currentRoundLabel = tournament?.selectedNodeId
    ? tournament.nodes.find((node) => node.id === tournament.selectedNodeId)?.name ?? `Node ${tournament.selectedNodeId}`
    : "Not started";
  // Check-in is optional: until the host opens it, every registered player
  // enters as before. Once opened (or closed), only checked-in registered
  // players are seated -- pressing Start while it's still open closes it
  // first (see prepareTournamentStartRoster), so this only ever reflects the
  // roster that will actually be used.
  const checkInInUse = Boolean(discordConfig) && checkInState?.status !== "not_started";
  const potentialEntrantCount = tournament
    ? checkInInUse
      ? Math.min(checkInState?.checkedInRegisteredCount ?? 0, tournament.playerCount)
      : selectTournamentEntrants(tournament.registrations, tournament.playerCount).length
    : 0;
  const meetsStartRequirement = tournament
    ? tournament.startRequirement.exactEntrants !== null
      ? potentialEntrantCount === tournament.startRequirement.exactEntrants
      : potentialEntrantCount >= tournament.startRequirement.minimumEntrants
    : false;
  const startDisabled = !tournament || tournament.registrations.length === 0 || !meetsStartRequirement;
  const startLabel = checkInState?.status === "open"
    ? `Close check-in & start (${checkInState.checkedInRegisteredCount} checked in)`
    : "Start tournament";
  const enteredRegistrationIds = new Set(
    tournament?.participants.map((participant) => participant.registrationId) ??
      [],
  );
  const checkedInRegistrationIds = new Set(
    (checkInState?.registrations ?? [])
      .filter((registration) => registration.checkedInAt !== null)
      .map((registration) => registration.registrationId),
  );
  const hasPendingCurrentRoundLobby =
    lobbyPanel?.lobbies.some(
      (lobby) =>
        lobby.participants.length > 0 &&
        lobby.participants.every(
          (participant) => participant.resultStatus === "pending",
        ),
    ) ?? false;
  const isTournamentCompleted = tournament?.status === "completed";
  const remainingRegistrationSlots = tournament
    ? Math.max(tournament.playerCount - tournament.registrations.length, 0)
    : 0;
  const defaultRandomPlayerCount = Math.min(8, remainingRegistrationSlots);

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <LiveRefresh
        enabled={Boolean(
          (discordConfig &&
            (tournament?.hasStarted || discordConfig.state === "pending" || checkInState?.status === "open")) ||
            (rawDiscordConfig?.state === "disabled" && rawDiscordConfig.cleanupAction && !rawDiscordConfig.cleanupCompletedAt),
        )}
      />
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between border-b border-zinc-200 pb-5">
          <div>
            <Link
              className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-700 hover:text-emerald-900"
              href="/"
            >
              TFTourney
            </Link>
            <p className="mt-1 text-sm text-zinc-500">
              Registered players and tournament status
            </p>
          </div>
          <div className="flex items-center gap-4"><Link className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-600 shadow-sm hover:bg-zinc-50" href="/">Back to tournaments</Link><AccountHeader organizer={organizer} returnTo={`/tournaments/${tournamentId}`} /></div>
        </header>

        {databaseError ? (
          <section className="py-10">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-950">
                Database unavailable
              </p>
              <p className="mt-2 text-sm text-amber-900">{databaseError}</p>
            </div>
          </section>
        ) : tournament ? (
          <>
            <div className="py-6">
              {!isTournamentHost ? <div className="mb-4 rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-600">You are viewing this tournament publicly. Sign in as its host to manage players, results, or Sheets publishing.</div> : null}
              {isTournamentHost ? <GoogleSheetsPublishingPanel authError={authError} authSuccess={authSuccess} initialStatus={tournament.sheetStatus} initiallyAuthenticated={hasSheetSession} tournamentId={tournament.id} /> : <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-5 text-sm text-indigo-900"><p className="font-semibold">Google Sheets scoreboard</p><p className="mt-1">The tournament host can connect Google Drive to generate and publish a workbook.</p></div>}
            </div>
            {authorizationError ? <p className="mb-5 rounded-md border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">{authorizationError}</p> : null}
            {!tournament.hasStarted ? (
              <section className="grid gap-5 py-8 md:grid-cols-[1fr_19rem]">
              <fieldset className={`contents ${isTournamentHost ? "" : "opacity-60"}`} disabled={!isTournamentHost}>
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">
                  Tournament
                </p>
                <h1 className="mt-3 text-4xl font-semibold tracking-normal text-zinc-950">
                  {tournament.name}
                </h1>
                <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-5">
                  <div className="border-l-4 border-emerald-600 bg-white px-4 py-3 shadow-sm">
                    <dt className="text-zinc-500">Status</dt>
                    <dd className="mt-1 font-semibold capitalize text-zinc-950">
                      {tournament.status.replaceAll("_", " ")}
                    </dd>
                  </div>
                  <div className="border-l-4 border-zinc-800 bg-white px-4 py-3 shadow-sm">
                    <dt className="text-zinc-500">Round</dt>
                    <dd className="mt-1 font-semibold text-zinc-950">
                      {currentRoundLabel}
                    </dd>
                  </div>
                  <div className="border-l-4 border-amber-500 bg-white px-4 py-3 shadow-sm">
                    <dt className="text-zinc-500">Registered</dt>
                    <dd className="mt-1 font-semibold text-zinc-950">
                      {tournament.registrations.length} / {tournament.playerCount}
                    </dd>
                  </div>
                  <div className="border-l-4 border-cyan-700 bg-white px-4 py-3 shadow-sm">
                    <dt className="text-zinc-500">Entrants</dt>
                    <dd className="mt-1 font-semibold text-zinc-950">
                      {tournament.participants.length || potentialEntrantCount}
                    </dd>
                  </div>
                  <div className="border-l-4 border-zinc-300 bg-white px-4 py-3 shadow-sm">
                    <dt className="text-zinc-500">Format</dt>
                    <dd className="mt-1 font-semibold text-zinc-950">
                      {tournament.formatId}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                  <h2 className="text-lg font-semibold text-zinc-950">
                    {isAcceptingPlayers ? "Start tournament" : "Current round"}
                  </h2>
                  {isAcceptingPlayers ? (
                    <>
                      <p className="mt-2 text-sm text-zinc-500">
                        {checkInInUse
                          ? `${checkInState?.checkedInRegisteredCount ?? 0} of ${checkInState?.registeredCount ?? 0} registered players are checked in.`
                          : `${potentialEntrantCount} player${potentialEntrantCount === 1 ? "" : "s"} will enter round 1.`}
                      </p>
                      {!meetsStartRequirement ? (
                        <p className="mt-2 text-sm font-medium text-amber-800">
                          {tournament.startRequirement.exactEntrants !== null
                            ? checkInInUse
                              ? `Exactly ${tournament.startRequirement.exactEntrants} players must be checked in to start.`
                              : `This format requires exactly ${tournament.startRequirement.exactEntrants} entrants to start.`
                            : checkInInUse
                              ? `At least ${tournament.startRequirement.minimumEntrants} players must be checked in to start.`
                              : `Register at least ${tournament.startRequirement.minimumEntrants} entrants to start.`}
                        </p>
                      ) : null}
                      <form action={startTournamentAction} className="mt-4">
                        <input
                          name="tournamentId"
                          type="hidden"
                          value={tournament.id}
                        />
                        <PendingButton
                          className={`flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${
                            startDisabled
                              ? "cursor-not-allowed bg-zinc-200 text-zinc-500"
                              : "bg-emerald-700 text-white hover:bg-emerald-800"
                          }`}
                          disabled={startDisabled}
                          pendingLabel="Starting…"
                        >
                          {startLabel}
                        </PendingButton>
                      </form>
                    </>
                  ) : (
                    <p className="mt-2 text-sm font-medium text-emerald-800">
                      {isTournamentCompleted
                        ? "Tournament is complete."
                        : "Tournament is in progress."}
                    </p>
                  )}
                  {startError ? (
                    <p className="mt-3 text-sm font-medium text-red-700">
                      {startError}
                    </p>
                  ) : null}
                </div>

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
                  tournamentId={tournament.id}
                />

                <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                  <h2 className="text-lg font-semibold text-zinc-950">
                    Register player
                  </h2>
                  {isAcceptingPlayers ? (
                    <form action={registerPlayerAction} className="mt-4 space-y-4">
                      <input
                        name="tournamentId"
                        type="hidden"
                        value={tournament.id}
                      />
                      <div>
                        <label
                          className="block text-sm font-medium text-zinc-800"
                          htmlFor="gameTag"
                        >
                          Riot ID
                        </label>
                        <input
                          className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
                          id="gameTag"
                          maxLength={80}
                          name="gameTag"
                          placeholder="GameName#TAG"
                          required
                          type="text"
                        />
                      </div>
                      <button
                        className="flex h-11 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
                        type="submit"
                      >
                        Verify and register player
                      </button>
                    </form>
                  ) : (
                    <p className="mt-2 text-sm font-medium text-zinc-600">
                      Registration is closed.
                    </p>
                  )}
                  {registrationError ? (
                    <p className="mt-3 text-sm font-medium text-red-700">
                      {registrationError}
                    </p>
                  ) : null}
                </div>

                {isAcceptingPlayers ? (
                  <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-5 shadow-sm">
                    <h2 className="text-lg font-semibold text-cyan-950">
                      Testing: seed random players
                    </h2>
                    <p className="mt-2 text-sm text-cyan-900">
                      Adds unique, Riot-verified IDs from the previous SEA seed roster. Existing IDs are skipped.
                    </p>
                    <form action={addRandomSeededPlayersAction} className="mt-4 space-y-3">
                      <input name="tournamentId" type="hidden" value={tournament.id} />
                      <label className="block text-sm font-medium text-cyan-950" htmlFor="randomPlayerCount">
                        Players to add
                        <input
                          className="mt-2 h-11 w-full rounded-md border border-cyan-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-cyan-700 focus:ring-2 focus:ring-cyan-100"
                          defaultValue={defaultRandomPlayerCount || 1}
                          disabled={remainingRegistrationSlots === 0}
                          id="randomPlayerCount"
                          max={Math.max(remainingRegistrationSlots, 1)}
                          min={1}
                          name="randomPlayerCount"
                          type="number"
                        />
                      </label>
                      <button
                        className="flex h-11 w-full items-center justify-center rounded-md bg-cyan-800 px-4 text-sm font-semibold text-white transition hover:bg-cyan-900 focus:outline-none focus:ring-2 focus:ring-cyan-700 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-300"
                        disabled={remainingRegistrationSlots === 0}
                        type="submit"
                      >
                        Add random test players
                      </button>
                    </form>
                    <p className="mt-2 text-xs text-cyan-800">
                      {remainingRegistrationSlots === 0
                        ? "The tournament roster is full."
                        : `${remainingRegistrationSlots} registration slot${remainingRegistrationSlots === 1 ? "" : "s"} remaining.`}
                    </p>
                    {Number.isInteger(randomPlayersAdded) ? (
                      <p className="mt-3 text-sm font-medium text-emerald-800" role="status">
                        Added {randomPlayersAdded} random test player{randomPlayersAdded === 1 ? "" : "s"}.
                        {randomPlayersSkipped > 0 ? ` Skipped ${randomPlayersSkipped} unavailable or duplicate ID${randomPlayersSkipped === 1 ? "" : "s"}.` : ""}
                      </p>
                    ) : null}
                    {randomPlayerError ? (
                      <p className="mt-3 text-sm font-medium text-red-700" role="alert">
                        {randomPlayerError}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="rounded-lg border border-red-200 bg-red-50 p-5 shadow-sm">
                  <h2 className="text-lg font-semibold text-red-950">
                    Delete tournament
                  </h2>
                  <p className="mt-2 text-sm text-red-800">
                    Permanently deletes this tournament, all registrations,
                    rounds, lobbies, participants, and scores.
                  </p>
                  <form
                    action={deleteTournamentAction}
                    className="mt-4 space-y-4"
                  >
                    <input
                      name="tournamentId"
                      type="hidden"
                      value={tournament.id}
                    />
                    <div>
                      <label
                        className="block text-sm font-medium text-red-950"
                        htmlFor="deleteConfirmation"
                      >
                        Type DELETE to confirm
                      </label>
                      <input
                        autoComplete="off"
                        className="mt-2 h-11 w-full rounded-md border border-red-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-red-700 focus:ring-2 focus:ring-red-100"
                        id="deleteConfirmation"
                        name="deleteConfirmation"
                        pattern="DELETE"
                        placeholder="DELETE"
                        required
                        spellCheck={false}
                        type="text"
                      />
                    </div>
                    <button
                      className="flex h-11 w-full items-center justify-center rounded-md bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
                      type="submit"
                    >
                      Delete tournament permanently
                    </button>
                  </form>
                  {deleteError ? (
                    <p className="mt-3 text-sm font-medium text-red-800">
                      {deleteError}
                    </p>
                  ) : null}
                </div>
              </div>
              </fieldset>
              </section>
            ) : null}

            {tournament.hasStarted ? (
              <>
                {progressed ? (
                  <div
                    className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900"
                    role="status"
                  >
                    {isTournamentCompleted
                      ? "Tournament completed. Final standings are shown below."
                      : "The next round is active and its first game block is ready."}
                  </div>
                ) : null}
                <RoundTabs
                  activeView={view}
                  query={{ node: requestedNode || null, game: Number.isInteger(requestedGame) ? requestedGame : null, page: Number.isInteger(requestedPage) ? requestedPage : null }}
                  tournamentId={tournament.id}
                >
                  {view === "details" ? (
                    <>
                      <div className="pt-6">
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
                          tournamentId={tournament.id}
                        />
                      </div>
                      <TournamentDetails
                        currentRoundLabel={currentRoundLabel}
                        deleteError={deleteError}
                        enteredRegistrationIds={enteredRegistrationIds}
                        potentialEntrantCount={potentialEntrantCount}
                        startRequirement={tournament.startRequirement}
                        registrationError={registrationError}
                        startError={startError}
                        isHost={isTournamentHost}
                        tournament={tournament}
                      />
                    </>
                  ) : view === "graph" ? (
                    <TournamentGraph
                      edges={graphPanel?.edges ?? tournament.edges}
                      nodes={graphPanel?.nodes ?? tournament.nodes}
                      selectedNodeId={tournament.selectedNodeId}
                      started
                      tournamentId={tournament.id}
                    />
                  ) : view === "scoresheet" ? (
                    <Scoresheet tabs={scoresheetPanel?.tabs ?? []} />
                  ) : tournament.panel.view === "lobbies" ? (
                    <div className="pt-6">
                      <div>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                          <div>
                            <h2 className="text-2xl font-semibold text-zinc-950">
                              {tournament.selectedNodeId
                                ? `${tournament.nodes.find((node) => node.id === tournament.selectedNodeId)?.name ?? "Selected node"} lobbies`
                                : "Current round lobbies"}
                            </h2>
                            <p className="mt-1 text-sm text-zinc-500">
                              {lobbyPanel?.roundProgress?.roundFormat === "checkmate"
                                ? `${lobbyPanel.roundProgress.completedGames} game${lobbyPanel.roundProgress.completedGames === 1 ? "" : "s"} complete${lobbyPanel.roundProgress.maxGames ? ` of ${lobbyPanel.roundProgress.maxGames}` : ""}.`
                                : lobbyPanel?.roundProgress
                                  ? `${lobbyPanel.roundProgress.completedGames} of ${lobbyPanel.roundProgress.configuredGames} games complete.`
                                : "Players are assigned when the round starts."}
                            </p>
                          </div>
                          <form
                            action={randomizePendingLobbyResultsAction}
                            className="flex flex-col items-stretch gap-2 sm:items-end"
                          >
                            <input name="tournamentId" type="hidden" value={tournament.id} />
                            <input name="nodeId" type="hidden" value={tournament.selectedNodeId ?? ""} />
                            <input
                              name="game"
                              type="hidden"
                              value={Number.isInteger(requestedGame) ? requestedGame : ""}
                            />
                            <input
                              name="page"
                              type="hidden"
                              value={Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : ""}
                            />
                            <button
                              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                              disabled={
                                !isTournamentHost || isTournamentCompleted || !hasPendingCurrentRoundLobby
                              }
                              title="Temporary testing helper"
                              type="submit"
                            >
                              Randomize pending block (test)
                            </button>
                            <span className="text-xs text-zinc-500">
                              Saves random placements for pending lobbies in the active block; existing results are preserved.
                            </span>
                          </form>
                        </div>
                      </div>

                      {randomized ? (
                        <div
                          className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900"
                          role="status"
                        >
                          Pending lobbies in the active block were randomized and saved for testing. Existing results were preserved.
                        </div>
                      ) : null}

                      {lobbyPanel?.roundProgress?.nextReseedGame ? (
                        <p className="mt-3 text-sm font-medium text-cyan-800">
                          Automatic reseed begins at Game {lobbyPanel.roundProgress.nextReseedGame} after
                          the current block is complete.
                        </p>
                      ) : null}

                      {lobbyPanel?.roundProgress?.roundFormat === "checkmate" ? (
                        <p className="mt-3 text-sm font-medium text-violet-800">
                          Checkmate threshold: above {lobbyPanel.roundProgress.checkmateThreshold} points before a game.
                          {lobbyPanel.roundProgress.winnerParticipantId
                            ? ` Decisive game: ${lobbyPanel.roundProgress.decisiveGame}.`
                            : lobbyPanel.roundProgress.maxGames
                              ? ` The round falls back to points after ${lobbyPanel.roundProgress.maxGames} games.`
                              : " Games continue until an eligible first place is recorded."}
                        </p>
                      ) : null}

                      {lobbyPanel?.progressionAction ? (
                        <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-5">
                          <h3 className="text-lg font-semibold text-amber-950">Finalize current node</h3>
                          <p className="mt-2 text-sm text-amber-900">
                            All games are scored. Finalizing this node will resolve its ordered advancement edges and activate any ready destinations.
                          </p>
                          <form action={finalizeTournamentNodeAction} className="mt-4">
                            <input name="tournamentId" type="hidden" value={tournament.id} />
                            <input name="nodeId" type="hidden" value={tournament.selectedNodeId ?? ""} />
                            <button
                              className="flex h-11 w-full items-center justify-center rounded-md bg-amber-700 px-4 text-sm font-semibold text-white transition hover:bg-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 sm:w-auto"
                              type="submit"
                            >
                              Finalize node and resolve edges
                            </button>
                          </form>
                        </div>
                      ) : null}

                      {progressionError ? (
                        <p className="mt-3 text-sm font-medium text-red-700" role="alert">
                          {progressionError}
                        </p>
                      ) : null}

                      {lobbyPanel ? <LobbyBrowser panel={lobbyPanel} tournamentId={tournament.id} /> : null}
                    </div>
                  ) : null}
                </RoundTabs>
              </>
            ) : null}

            {!tournament.hasStarted ? (
              <>
              <div className="border-t border-zinc-200 py-8">
                <TournamentGraph
                  edges={tournament.edges}
                  nodes={tournament.nodes}
                  selectedNodeId={null}
                  started={false}
                  tournamentId={tournament.id}
                />
              </div>
              <section className="border-t border-zinc-200 py-8">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold text-zinc-950">
                    Registered players
                  </h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    Players appear here after registration.
                  </p>
                </div>
              </div>

              {tournament.registrations.length === 0 ? (
                <div className="mt-5 rounded-md border border-zinc-200 bg-white p-5 text-sm text-zinc-500">
                  No players have registered for this tournament yet.
                </div>
              ) : (
                <div className="mt-5 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="bg-zinc-50 text-zinc-600">
                      <tr>
                        <th className="w-20 px-4 py-3 font-medium">#</th>
                        <th className="px-4 py-3 font-medium">Player</th>
                        {tournament.hasStarted ? (
                          <th className="px-4 py-3 font-medium">Entry</th>
                        ) : checkInInUse ? (
                          <th className="px-4 py-3 font-medium">Check-in</th>
                        ) : null}
                        <th className="px-4 py-3 font-medium">Registered</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {tournament.registrations.map((player, index) => (
                        <tr key={player.id}>
                          <td className="px-4 py-3 text-zinc-500">
                            {index + 1}
                          </td>
                          <td className="px-4 py-3 font-medium text-zinc-950">
                            {player.displayName}
                          </td>
                          {tournament.hasStarted ? (
                            <td className="px-4 py-3 text-zinc-600">
                              {enteredRegistrationIds.has(player.id)
                                ? "Entered"
                                : "Not entered"}
                            </td>
                          ) : checkInInUse ? (
                            <td className="px-4 py-3">
                              <form action={setRegistrationCheckInAction}>
                                <input name="tournamentId" type="hidden" value={tournament.id} />
                                <input name="registrationId" type="hidden" value={player.id} />
                                <input name="checkedIn" type="hidden" value={checkedInRegistrationIds.has(player.id) ? "false" : "true"} />
                                <PendingButton
                                  className={`h-8 rounded-md px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                                    checkedInRegistrationIds.has(player.id)
                                      ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                                  }`}
                                  disabled={!isTournamentHost}
                                  pendingLabel="Saving…"
                                >
                                  {checkedInRegistrationIds.has(player.id) ? "✓ Checked in (undo)" : "Check in"}
                                </PendingButton>
                              </form>
                            </td>
                          ) : null}
                          <td className="px-4 py-3 text-zinc-600">
                            {new Date(player.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              </section>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
