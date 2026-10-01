import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AccountHeader } from "@/components/account/account-header";
import { SiteHeader } from "@/components/layout/site-header";
import {
  getTournamentPageViewModel,
  TOURNAMENT_STATUS_ACCEPTING_PLAYERS,
} from "@/lib/db/tournaments/api";
import type { TournamentDetail, TournamentDetailPageViewModel, TournamentPanelView } from "@/lib/db/tournaments/types";
import { getPlayerSession } from "@/lib/auth/player-session";
import { getOrganizerSession } from "@/lib/auth/session";
import { selectTournamentEntrants } from "@/lib/tournament/start/api";
import { isDiscordConfigPendingTooLong } from "@/lib/discord/api";
import { LiveRefresh } from "@/components/tournaments/live-refresh";
import { RoundTabs } from "@/components/tournaments/round-tabs";
import { TournamentStats } from "@/components/tournaments/tournament-stats";
import { IntegrationsScreen } from "@/components/tournaments/integrations-screen";
import { SettingsScreen } from "@/components/tournaments/settings-screen";
import { PreStartPanels } from "./pre-start-panels";
import { StartedTournamentView } from "./started-tournament-view";
import { RegistrationsSection } from "./registrations-section";
import {
  defaultScreen,
  panelViewForRequestedView,
  resolveTournamentScreen,
  screensFor,
} from "./screens";

export const dynamic = "force-dynamic";

export type TournamentPageTournament = TournamentDetailPageViewModel &
  Pick<TournamentDetail, "registrations" | "participants" | "lobbies" | "gameScores" | "scores" | "roundProgress" | "progressionAction">;

type TournamentPageParams = Promise<{
  tournamentId: string;
}>;

type TournamentPageSearchParams = Promise<{
  view?: string | string[];
  game?: string | string[];
  page?: string | string[];
  registrationError?: string | string[];
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
  const registrationError = getSearchValue(query.registrationError);
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
  const [organizer, playerSession] = await Promise.all([
    getOrganizerSession(),
    getPlayerSession(),
  ]);
  const panelView: TournamentPanelView = panelViewForRequestedView(requestedView);
  let tournament: TournamentPageTournament | null | undefined;
  let databaseError = "";

  try {
    const pageModel = await getTournamentPageViewModel(tournamentId, {
      view: panelView,
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
  const viewerMode: "host" | "player" | "public" = isTournamentHost
    ? "host"
    : playerSession
      ? "player"
      : "public";
  const modeBackHref = viewerMode === "host" ? "/dashboard" : viewerMode === "player" ? "/player" : "/tournaments";
  const modeBackLabel = viewerMode === "host" ? "Back to dashboard" : viewerMode === "player" ? "Back to player home" : "Back to tournaments";
  // discordConfig/checkInState are computed inside
  // get_tournament_page_view_model itself, host-gated exactly like
  // sheetStatus already was -- no separate round trips needed here anymore.
  const rawDiscordConfig = tournament?.discordConfig ?? null;
  // A "disabled" config is a soft-disconnect (see disconnectDiscordAction):
  // treat it as not connected everywhere on this page.
  const discordConfig = rawDiscordConfig && rawDiscordConfig.state !== "disabled" ? rawDiscordConfig : null;
  const checkInState = discordConfig ? (tournament?.checkInState ?? null) : null;
  const discordPendingTooLong = isDiscordConfigPendingTooLong(discordConfig);

  const lobbyPanel = tournament?.panel.view === "lobbies" ? tournament.panel : null;
  const scoresheetPanel = tournament?.panel.view === "scoresheet" ? tournament.panel : null;
  const graphPanel = tournament?.panel.view === "graph" ? tournament.panel : null;

  let screen = defaultScreen(false);

  if (tournament) {
    const hasStarted = tournament.hasStarted;
    screen = resolveTournamentScreen(
      requestedView,
      {
        discordError,
        discordConnected,
        discordDisconnected,
        discordManagerGranted,
        managerInvite,
        authError,
        authSuccess,
        checkInError,
        checkInUpdated,
        registrationError,
        deleteError,
        startError,
      },
      hasStarted,
    );

    const pageIsMalformed = Array.isArray(query.page) || (getSearchValue(query.page) !== "" && !/^[1-9]\d*$/.test(getSearchValue(query.page)));
    const gameIsMalformed = Array.isArray(query.game) || (getSearchValue(query.game) !== "" && !/^[1-9]\d*$/.test(getSearchValue(query.game)));
    const viewIsMalformed = Array.isArray(query.view);
    const nodeIsRepeated = Array.isArray(query.node);
    const canonicalParams = new URLSearchParams();
    if (screen !== defaultScreen(hasStarted)) canonicalParams.set("view", screen);
    if (screen === "lobbies" && requestedNode && tournament.selectedNodeId) canonicalParams.set("node", tournament.selectedNodeId);
    if (screen === "lobbies" && Number.isInteger(requestedGame) && requestedGame > 0 && lobbyPanel?.selectedGameNumber) canonicalParams.set("game", String(lobbyPanel.selectedGameNumber));
    if (!pageIsMalformed && !gameIsMalformed && lobbyPanel && parsedPage > lobbyPanel.totalPages) {
      if (lobbyPanel.totalPages > 1) canonicalParams.set("page", String(lobbyPanel.totalPages));
      redirect(`/tournaments/${tournamentId}${canonicalParams.toString() ? `?${canonicalParams}` : ""}`);
    }
    const invalidNode = screen === "lobbies" && Boolean(requestedNode) && requestedNode !== tournament.selectedNodeId;
    const invalidGame = screen === "lobbies" && Number.isInteger(requestedGame) && requestedGame > 0 && requestedGame !== lobbyPanel?.selectedGameNumber;
    const unrelatedScreenParams = screen !== "lobbies" && Boolean(requestedNode || getSearchValue(query.game) || getSearchValue(query.page));
    // Only an explicit, invalid/redundant ?view= triggers a redirect here --
    // when it's simply absent, `screen` may still differ from the default
    // (e.g. a flash message routed it to Integrations) and that's fine to
    // render without rewriting the URL.
    const viewMismatch = requestedView !== "" && requestedView !== screen;
    if (
      pageIsMalformed || gameIsMalformed || viewIsMalformed || nodeIsRepeated ||
      getSearchValue(query.page) === "1" || viewMismatch || invalidNode || invalidGame || unrelatedScreenParams
    ) {
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
  const isTournamentCompleted = tournament?.status === "completed";

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <LiveRefresh
        enabled={Boolean(
          (discordConfig &&
            (tournament?.hasStarted || discordConfig.state === "pending" || checkInState?.status === "open")) ||
            (rawDiscordConfig?.state === "disabled" && rawDiscordConfig.cleanupAction && !rawDiscordConfig.cleanupCompletedAt),
        )}
      />
      <SiteHeader
        actions={
          viewerMode === "player" ? undefined : <AccountHeader organizer={organizer} returnTo={`/tournaments/${tournamentId}`} />
        }
        backHref={modeBackHref}
        backLabel={modeBackLabel}
        maxWidthClassName="max-w-5xl"
        mode={viewerMode}
        showNav={false}
        subtitle="Registered players and tournament status"
        switchHref={viewerMode === "host" && playerSession ? "/player" : viewerMode === "player" && organizer ? "/dashboard" : undefined}
        switchLabel={viewerMode === "host" ? "Switch to player view" : "Switch to host view"}
      />
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-6 sm:px-8 lg:px-10">
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
              {viewerMode === "host" ? (
                <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900">
                  Managing as host
                </div>
              ) : viewerMode === "player" ? (
                <div className="mb-4 rounded-md border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
                  You&apos;re viewing as a player. Sign up, check in, and manage your account from{" "}
                  <Link className="underline" href="/player">
                    Player home
                  </Link>
                  .
                </div>
              ) : (
                <div className="mb-4 rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-600">You are viewing this tournament publicly. Sign in as its host to manage players, results, or Sheets publishing.</div>
              )}
              {authorizationError ? <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">{authorizationError}</p> : null}

              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">
                Tournament
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-normal text-zinc-950">
                {tournament.name}
              </h1>
              <TournamentStats currentRoundLabel={currentRoundLabel} formatId={tournament.formatId} status={tournament.status} />
            </div>

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
              activeScreen={screen}
              defaultScreen={defaultScreen(tournament.hasStarted)}
              query={{ node: requestedNode || null, game: Number.isInteger(requestedGame) ? requestedGame : null, page: Number.isInteger(requestedPage) ? requestedPage : null }}
              tabs={screensFor(tournament.hasStarted)}
              tournamentId={tournament.id}
            >
              {screen === "players" ? (
                <RegistrationsSection
                  checkedInRegistrationIds={checkedInRegistrationIds}
                  checkInInUse={checkInInUse}
                  defaultOpenRegisterModal={Boolean(registrationError)}
                  enteredRegistrationIds={enteredRegistrationIds}
                  isAcceptingPlayers={isAcceptingPlayers}
                  isTournamentHost={isTournamentHost}
                  registrationError={registrationError}
                  tournament={tournament}
                />
              ) : screen === "integrations" ? (
                <IntegrationsScreen
                  authError={authError}
                  authSuccess={authSuccess}
                  checkInError={checkInError}
                  checkInState={checkInState}
                  checkInUpdated={checkInUpdated}
                  discordConfig={discordConfig}
                  discordConnected={discordConnected}
                  discordDisconnected={discordDisconnected}
                  discordError={discordError}
                  discordManagerGranted={discordManagerGranted}
                  discordPendingTooLong={discordPendingTooLong}
                  hasSheetSession={hasSheetSession}
                  isTournamentHost={isTournamentHost}
                  managerInvite={managerInvite}
                  rawDiscordConfig={rawDiscordConfig}
                  sheetStatus={tournament.sheetStatus}
                  tournamentId={tournament.id}
                />
              ) : screen === "settings" ? (
                <SettingsScreen
                  defaultOpenDeleteModal={Boolean(deleteError)}
                  deleteError={deleteError}
                  isTournamentHost={isTournamentHost}
                  tournamentId={tournament.id}
                />
              ) : tournament.hasStarted ? (
                <StartedTournamentView
                  graphPanel={graphPanel}
                  lobbyPanel={lobbyPanel}
                  progressionError={progressionError}
                  screen={screen as "lobbies" | "scoresheet" | "graph"}
                  scoresheetPanel={scoresheetPanel}
                  tournament={tournament}
                />
              ) : (
                <PreStartPanels
                  checkInInUse={checkInInUse}
                  checkInState={checkInState}
                  isAcceptingPlayers={isAcceptingPlayers}
                  isTournamentCompleted={isTournamentCompleted}
                  isTournamentHost={isTournamentHost}
                  meetsStartRequirement={meetsStartRequirement}
                  potentialEntrantCount={potentialEntrantCount}
                  screen={screen as "overview" | "format"}
                  startDisabled={startDisabled}
                  startError={startError}
                  startLabel={startLabel}
                  tournament={tournament}
                />
              )}
            </RoundTabs>
          </>
        ) : null}
      </div>
    </main>
  );
}
