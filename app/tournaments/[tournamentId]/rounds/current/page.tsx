import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CurrentRoundViewTabs } from "@/components/tournaments/current-round-view-tabs";
import { Scoresheet } from "@/components/tournaments/scoresheet";
import { getTournamentDetail } from "@/lib/db/tournaments/api";

export const dynamic = "force-dynamic";

type CurrentRoundPageParams = Promise<{
  tournamentId: string;
}>;

export default async function CurrentRoundPage({
  params,
}: {
  params: CurrentRoundPageParams;
}) {
  const { tournamentId } = await params;
  const tournamentPath = `/tournaments/${tournamentId}`;
  let tournament:
    | Awaited<ReturnType<typeof getTournamentDetail>>
    | undefined;
  let databaseError = "";

  try {
    tournament = await getTournamentDetail(tournamentId);
  } catch (error) {
    databaseError =
      error instanceof Error
        ? error.message
        : "Current round data could not be loaded.";
  }

  if (!databaseError && !tournament) {
    notFound();
  }

  if (!databaseError && tournament && !tournament.hasStarted) {
    redirect(tournamentPath);
  }

  const roundLabel = tournament?.currentRoundNumber
    ? `Round ${tournament.currentRoundNumber}`
    : "Current round";
  const completedLobbyCount =
    tournament?.lobbies.filter(
      (lobby) =>
        lobby.participants.length > 0 &&
        lobby.participants.every((participant) => participant.points !== null),
    ).length ?? 0;
  const gameNumbers = [
    ...new Set(tournament?.lobbies.map((lobby) => lobby.gameNumber) ?? []),
  ].sort((firstGame, secondGame) => firstGame - secondGame);
  const lobbiesPerGame = gameNumbers.length
    ? Math.max(
        ...gameNumbers.map(
          (gameNumber) =>
            tournament?.lobbies.filter(
              (lobby) => lobby.gameNumber === gameNumber,
            ).length ?? 0,
        ),
      )
    : 0;
  const scoresheetVersion = (tournament?.scores ?? [])
    .map((score) => `${score.id}:${score.roundId}:${score.score}`)
    .concat(
      tournament?.gameScores.map(
        (score) =>
          `${score.participantId}:${score.roundId}:game-${score.gameNumber}:${score.score ?? "pending"}`,
      ) ?? [],
    )
    .concat(
      tournament?.rounds.map(
        (round) => `${round.id}:round-${round.roundNumber}`,
      ) ?? [],
    )
    .join("|");

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
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
              Current round lobbies and standings
            </p>
          </div>
          <Link
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-600 shadow-sm hover:bg-zinc-50"
            href={tournamentPath}
          >
            Back to tournament
          </Link>
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
            <section className="py-8">
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">
                {tournament.name}
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-normal text-zinc-950">
                {roundLabel} operations
              </h1>
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-4">
                <div className="border-l-4 border-zinc-800 bg-white px-4 py-3 shadow-sm">
                  <dt className="text-zinc-500">Round</dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {roundLabel}
                  </dd>
                </div>
                <div className="border-l-4 border-emerald-600 bg-white px-4 py-3 shadow-sm">
                  <dt className="text-zinc-500">Games</dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {gameNumbers.length}
                  </dd>
                </div>
                <div className="border-l-4 border-sky-600 bg-white px-4 py-3 shadow-sm">
                  <dt className="text-zinc-500">Lobbies per game</dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {lobbiesPerGame}
                  </dd>
                </div>
                <div className="border-l-4 border-amber-500 bg-white px-4 py-3 shadow-sm">
                  <dt className="text-zinc-500">Results entered</dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {completedLobbyCount} / {tournament.lobbies.length}
                  </dd>
                </div>
              </dl>
            </section>

            <CurrentRoundViewTabs
              currentRoundView={
                <section className="py-8">
                  <div>
                    <h2 className="text-2xl font-semibold text-zinc-950">
                      Current round games
                    </h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      Inspect each game&apos;s assignments and enter every
                      lobby&apos;s results.
                    </p>
                  </div>

                  {tournament.lobbies.length === 0 ? (
                    <div className="mt-5 rounded-md border border-zinc-200 bg-white p-5 text-sm text-zinc-500">
                      No lobbies were generated for the current round.
                    </div>
                  ) : (
                    <div className="mt-6 space-y-8">
                      {gameNumbers.map((gameNumber) => (
                        <section key={gameNumber}>
                          <div className="flex items-center gap-3">
                            <h3 className="text-lg font-semibold text-zinc-950">
                              Game {gameNumber}
                            </h3>
                            <span className="text-sm text-zinc-500">
                              {
                                tournament.lobbies.filter(
                                  (lobby) =>
                                    lobby.gameNumber === gameNumber,
                                ).length
                              }{" "}
                              lobbies
                            </span>
                          </div>
                          <div className="mt-3 grid gap-5 md:grid-cols-2">
                            {tournament.lobbies
                              .filter(
                                (lobby) =>
                                  lobby.gameNumber === gameNumber,
                              )
                              .map((lobby) => (
                                <article
                                  className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm"
                                  key={lobby.id}
                                >
                                  <div className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
                                    <h4 className="font-semibold text-zinc-950">
                                      Lobby {lobby.lobbyNumber}
                                    </h4>
                                    <Link
                                      className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
                                      href={`/tournaments/${tournament.id}/lobbies/${lobby.id}`}
                                    >
                                      Input scores
                                    </Link>
                                  </div>
                                  <ol className="divide-y divide-zinc-100">
                                    {lobby.participants.map((participant) => (
                                      <li
                                        className="flex items-center gap-3 px-4 py-3 text-sm"
                                        key={participant.id}
                                      >
                                        <span className="w-6 text-zinc-400">
                                          {participant.slotNumber}
                                        </span>
                                        <span className="flex-1 font-medium text-zinc-950">
                                          {participant.displayName}
                                        </span>
                                        <span className="w-16 text-right font-semibold text-zinc-950">
                                          {participant.points === null
                                            ? "Pending"
                                            : `${participant.points} pts`}
                                        </span>
                                      </li>
                                    ))}
                                  </ol>
                                </article>
                              ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </section>
              }
              scoresheetView={
                <Scoresheet
                  gameScores={tournament.gameScores}
                  key={scoresheetVersion}
                  rounds={tournament.rounds}
                  scores={tournament.scores}
                />
              }
            />
          </>
        ) : null}
      </div>
    </main>
  );
}
