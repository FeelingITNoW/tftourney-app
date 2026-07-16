import Link from "next/link";
import { notFound } from "next/navigation";
import {
  deleteTournamentAction,
  registerPlayerAction,
  startTournamentAction,
} from "@/app/actions";
import {
  getTournamentDetail,
  TOURNAMENT_STATUS_ACCEPTING_PLAYERS,
} from "@/lib/db/tournaments/api";
import { selectTournamentEntrants } from "@/lib/tournament/start/api";

export const dynamic = "force-dynamic";

type TournamentPageParams = Promise<{
  tournamentId: string;
}>;

type TournamentPageSearchParams = Promise<{
  registrationError?: string | string[];
  startError?: string | string[];
  deleteError?: string | string[];
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
  const registrationError = getSearchValue(query.registrationError);
  const startError = getSearchValue(query.startError);
  const deleteError = getSearchValue(query.deleteError);
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
        : "Tournament data could not be loaded.";
  }

  if (!databaseError && !tournament) {
    notFound();
  }

  const isAcceptingPlayers =
    tournament?.status === TOURNAMENT_STATUS_ACCEPTING_PLAYERS;
  const currentRoundLabel = tournament?.currentRoundNumber
    ? `Round ${tournament.currentRoundNumber}`
    : "Not started";
  const potentialEntrantCount = tournament
    ? selectTournamentEntrants(
        tournament.registrations,
        tournament.playerCount,
      ).length
    : 0;
  const enteredRegistrationIds = new Set(
    tournament?.participants.map((participant) => participant.registrationId) ??
      [],
  );

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
              Registered players and tournament status
            </p>
          </div>
          <Link
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-600 shadow-sm hover:bg-zinc-50"
            href="/"
          >
            Back to tournaments
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
            <section className="grid gap-5 py-8 md:grid-cols-[1fr_19rem]">
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
                        {potentialEntrantCount} player
                        {potentialEntrantCount === 1 ? "" : "s"} will enter
                        round 1.
                      </p>
                      <form action={startTournamentAction} className="mt-4">
                        <input
                          name="tournamentId"
                          type="hidden"
                          value={tournament.id}
                        />
                        <button
                          className={`flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${
                            tournament.registrations.length === 0
                              ? "cursor-not-allowed bg-zinc-200 text-zinc-500"
                              : "bg-emerald-700 text-white hover:bg-emerald-800"
                          }`}
                          disabled={tournament.registrations.length === 0}
                          type="submit"
                        >
                          Start tournament
                        </button>
                      </form>
                    </>
                  ) : (
                    <>
                      <p className="mt-2 text-sm font-medium text-emerald-800">
                        Tournament has started.
                      </p>
                      <Link
                        className="mt-4 flex h-11 w-full items-center justify-center rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
                        href={`/tournaments/${tournament.id}/rounds/current`}
                      >
                        Open current round
                      </Link>
                    </>
                  )}
                  {startError ? (
                    <p className="mt-3 text-sm font-medium text-red-700">
                      {startError}
                    </p>
                  ) : null}
                </div>

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
            </section>

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
      </div>
    </main>
  );
}
