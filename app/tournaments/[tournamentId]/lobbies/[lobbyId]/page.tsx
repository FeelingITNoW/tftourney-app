import Link from "next/link";
import { notFound } from "next/navigation";
import { updateLobbyScoresAction } from "@/app/actions";
import { RandomizeLobbyScoresButton } from "@/components/tournaments/randomize-lobby-scores-button";
import { getTournamentDetail } from "@/lib/db/tournaments/api";

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
  const currentRoundPath = `/tournaments/${tournamentId}/rounds/current`;
  const query = await searchParams;
  const returnGame = getSearchValue(query.game);
  const returnPage = getSearchValue(query.page);
  const scoreError = getSearchValue(query.scoreError);
  const saved = getSearchValue(query.saved) === "true";
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
        : "Lobby data could not be loaded.";
  }

  const lobby = tournament?.lobbies.find((item) => item.id === lobbyId);

  if (!databaseError && (!tournament || !lobby)) {
    notFound();
  }

  const roundScoresByParticipantId = new Map(
    tournament?.scores
      .filter((score) => score.roundId === lobby?.roundId)
      .map((score) => [score.participantId, score.score]) ?? [],
  );
  const isReadOnly = tournament?.status === "completed";
  const backQuery = new URLSearchParams();
  if (returnGame) {
    backQuery.set("game", returnGame);
  }
  if (returnPage) {
    backQuery.set("page", returnPage);
  }
  const backToTournamentHref = `/tournaments/${tournamentId}${
    backQuery.toString() ? `?${backQuery.toString()}` : ""
  }`;

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
              Inspect the lobby and record official results
            </p>
          </div>
          <Link
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-600 shadow-sm hover:bg-zinc-50"
<<<<<<< HEAD
            href={currentRoundPath}
          >
            Back to current round
=======
            href={backToTournamentHref}
          >
            Back to lobby browser
>>>>>>> 67350be (Added multi-round support)
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
        ) : tournament && lobby ? (
          <>
            <section className="py-8">
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">
                {tournament.name}
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-normal text-zinc-950">
                Game {lobby.gameNumber} · Lobby {lobby.lobbyNumber} results
              </h1>
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div className="border-l-4 border-zinc-800 bg-white px-4 py-3 shadow-sm">
                  <dt className="text-zinc-500">Round</dt>
                  <dd className="mt-1 font-semibold text-zinc-950">
                    {tournament.currentRoundNumber
                      ? `Round ${tournament.currentRoundNumber}`
                      : lobby.roundId}
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

            {isReadOnly ? (
              <div className="mb-5 rounded-md border border-zinc-200 bg-zinc-100 p-4 text-sm font-medium text-zinc-700">
                This tournament is complete. Results are read-only.
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

              <form action={updateLobbyScoresAction} className="mt-5">
                <input name="tournamentId" type="hidden" value={tournament.id} />
                <input name="lobbyId" type="hidden" value={lobby.id} />
                <input name="returnGame" type="hidden" value={returnGame} />
                <input name="returnPage" type="hidden" value={returnPage} />
                <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
                  <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
                    <thead className="bg-zinc-50 text-zinc-600">
                      <tr>
                        <th className="w-20 px-4 py-3 font-medium">Slot</th>
                        <th className="px-4 py-3 font-medium">Player</th>
                        <th className="w-32 px-4 py-3 font-medium">Placement</th>
                        <th className="w-32 px-4 py-3 font-medium">
                          Round total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200">
                      {lobby.participants.map((participant) => (
                        <tr key={participant.id}>
                          <td className="px-4 py-3 text-zinc-500">
                            {participant.slotNumber}
                          </td>
                          <td className="px-4 py-3 font-medium text-zinc-950">
                            {participant.displayName}
                            <input
                              name="participantId"
                              type="hidden"
                              value={participant.id}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <label
                              className="sr-only"
                              htmlFor={`placement-${participant.id}`}
                            >
                              Placement for {participant.displayName}
                            </label>
                            <input
                              className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
                              defaultValue={participant.placement ?? ""}
                              id={`placement-${participant.id}`}
                              max={lobby.participants.length}
                              min={1}
                              name="placement"
                              placeholder="1"
                              required
                              step={1}
                              type="number"
                              disabled={isReadOnly}
                            />
                          </td>
                          <td className="px-4 py-3 font-semibold text-zinc-950">
                            {roundScoresByParticipantId.get(participant.id) ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
                  <Link
                    className="flex h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
<<<<<<< HEAD
                    href={currentRoundPath}
=======
                    href={backToTournamentHref}
>>>>>>> 67350be (Added multi-round support)
                  >
                    Cancel
                  </Link>
                  <RandomizeLobbyScoresButton disabled={isReadOnly} />
                  <button
                    className="flex h-11 items-center justify-center rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
                    disabled={isReadOnly}
                    type="submit"
                  >
                    Save lobby results
                  </button>
                </div>
              </form>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
