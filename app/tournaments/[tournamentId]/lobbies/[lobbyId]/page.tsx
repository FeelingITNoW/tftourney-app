import { AccountHeader } from "@/components/account/account-header";
import { SiteHeader } from "@/components/layout/site-header";
import { getPlayerSession } from "@/lib/auth/player-session";
import { getOrganizerSession } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { LobbyResultsEditor } from "@/components/tournaments/lobby-results-editor";
import { getTournamentLobbyViewModel } from "@/lib/db/tournaments/api";
import { isTournamentManager } from "@/lib/discord/api";

export const dynamic = "force-dynamic";

type LobbyPageParams = Promise<{
  tournamentId: string;
  lobbyId: string;
}>;

type LobbyPageSearchParams = Promise<{
  game?: string | string[];
  page?: string | string[];
  scoreError?: string | string[];
  saved?: string | string[];
  node?: string | string[];
  authorizationError?: string | string[];
}>;

function getSearchValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

export default async function LobbyScoresPage({
  params,
  searchParams,
}: {
  params: LobbyPageParams;
  searchParams: LobbyPageSearchParams;
}) {
  const { tournamentId, lobbyId } = await params;
  const [organizer, playerSession] = await Promise.all([
    getOrganizerSession(),
    getPlayerSession(),
  ]);
  const query = await searchParams;
  const returnGame = getSearchValue(query.game);
  const returnPage = getSearchValue(query.page);
  const scoreError = getSearchValue(query.scoreError);
  const saved = getSearchValue(query.saved) === "true";
  const authorizationError = getSearchValue(query.authorizationError);
  let tournament:
    | Awaited<ReturnType<typeof getTournamentLobbyViewModel>>
    | undefined;
  let databaseError = "";

  try {
    tournament = await getTournamentLobbyViewModel(tournamentId, lobbyId);
  } catch (error) {
    databaseError =
      error instanceof Error
        ? error.message
        : "Lobby data could not be loaded.";
  }

  const lobby = tournament?.lobby;
  const tournamentHeader = tournament?.tournament;

  if (!databaseError && (!tournamentHeader || !lobby)) {
    notFound();
  }

  const roundScoresByParticipantId = new Map(
    tournament?.scores.map((score) => [score.participantId, score.score]) ?? [],
  );
  const isTournamentHost = Boolean(
    tournamentHeader &&
      organizer &&
      organizer.hostUserId === tournamentHeader.hostUserId,
  );
  const isTournamentOperator = isTournamentHost || Boolean(
    tournamentHeader && organizer && await isTournamentManager(tournamentId, organizer.hostUserId).catch(() => false),
  );
  const isReadOnly = tournamentHeader?.status === "completed" || !isTournamentOperator;
  const viewerMode: "host" | "player" | "public" = isTournamentOperator
    ? "host"
    : playerSession
      ? "player"
      : "public";
  const backQuery = new URLSearchParams();
  if (returnGame) {
    backQuery.set("game", returnGame);
  }
  if (returnPage) {
    backQuery.set("page", returnPage);
  }
  if (tournament?.round.id) {
    backQuery.set("node", tournament.round.id);
  }
  const backToTournamentHref = `/tournaments/${tournamentId}${
    backQuery.toString() ? `?${backQuery.toString()}` : ""
  }`;

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <SiteHeader
        actions={
          viewerMode === "player" ? undefined : <AccountHeader organizer={organizer} returnTo={backToTournamentHref} />
        }
        backHref={backToTournamentHref}
        backLabel="Back to lobby browser"
        maxWidthClassName="max-w-5xl"
        mode={viewerMode}
        showNav={false}
        subtitle={viewerMode === "host" ? "Record official results" : "Lobby results (read-only)"}
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
        ) : tournamentHeader && tournament && lobby ? (
          <>
            <section className="py-8">
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">
                {tournamentHeader.name}
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-normal text-zinc-950">
                Game {lobby.gameNumber} · Lobby {lobby.lobbyNumber} results
              </h1>
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div className="border-l-4 border-zinc-800 bg-white px-4 py-3 shadow-sm">
                  <dt className="text-zinc-500">Round</dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {tournament.round.name ?? tournament.round.id}
                  </dd>
                </div>
                <div className="border-l-4 border-sky-600 bg-white px-4 py-3 shadow-sm">
                  <dt className="text-zinc-500">Game</dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    Game {lobby.gameNumber}
                  </dd>
                </div>
                <div className="border-l-4 border-emerald-600 bg-white px-4 py-3 shadow-sm">
                  <dt className="text-zinc-500">Players</dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {lobby.participants.length}
                  </dd>
                </div>
              </dl>
            </section>

            {saved ? (
              <div
                className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900"
                role="status"
              >
                Lobby results saved. Tournament scores are up to date.
              </div>
            ) : null}

            {scoreError ? (
              <div
                className="mb-5 rounded-md border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800"
                role="alert"
              >
                {scoreError}
              </div>
            ) : null}

            {authorizationError ? <div className="mb-5 rounded-md border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">{authorizationError}</div> : null}

            {isReadOnly ? (
              <div className="mb-5 rounded-md border border-zinc-200 bg-zinc-100 p-4 text-sm font-medium text-zinc-700">
                {tournamentHeader.status === "completed" ? "This tournament is complete. Results are read-only." : "Only a tournament host or appointed manager can enter results. This is a public read-only view."}
              </div>
            ) : null}

            <section className="pb-10">
              <div>
                <h2 className="text-2xl font-semibold text-zinc-950">
                  Player results
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Enter each player&apos;s unique placement. Awarded points are
                  calculated automatically from the tournament format.
                </p>
              </div>

              <LobbyResultsEditor
                backHref={backToTournamentHref}
                isReadOnly={isReadOnly}
                lobbyId={lobby.id}
                participants={lobby.participants}
                returnGame={returnGame}
                returnPage={returnPage}
                roundId={tournament.round.id}
                roundScoresByParticipantId={Object.fromEntries(roundScoresByParticipantId)}
                tournamentId={tournamentHeader.id}
              />
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
