import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addRandomSeededPlayersAction,
  deleteTournamentAction,
  finalizeTournamentNodeAction,
  randomizePendingLobbyResultsAction,
  registerPlayerAction,
  startTournamentAction,
} from "@/app/actions";
import { LobbyBrowser } from "@/components/tournaments/lobby-browser";
import { TournamentGraph } from "@/components/tournaments/tournament-graph";
import { RoundTabs } from "@/components/tournaments/round-tabs";
import { Scoresheet } from "@/components/tournaments/scoresheet";
import { TournamentDetails } from "@/components/tournaments/tournament-details";
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
  let tournament:
    | Awaited<ReturnType<typeof getTournamentDetail>>
    | undefined;
  let databaseError = "";

  try {
    tournament = await getTournamentDetail(tournamentId, requestedNode || undefined);
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
  const currentRoundLabel = tournament?.selectedNodeId
    ? tournament.nodes.find((node) => node.id === tournament.selectedNodeId)?.name ?? `Node ${tournament.selectedNodeId}`
    : "Not started";
  const potentialEntrantCount = tournament
    ? selectTournamentEntrants(
        tournament.registrations,
        tournament.playerCount,
      ).length
    : 0;
  const meetsStartRequirement = tournament
    ? tournament.startRequirement.exactEntrants !== null
      ? potentialEntrantCount === tournament.startRequirement.exactEntrants
      : potentialEntrantCount >= tournament.startRequirement.minimumEntrants
    : false;
  const enteredRegistrationIds = new Set(
    tournament?.participants.map((participant) => participant.registrationId) ??
      [],
  );
  const hasPendingCurrentRoundLobby =
    tournament?.lobbies.some(
      (lobby) =>
        lobby.participants.length > 0 &&
        lobby.participants.every(
          (participant) => participant.resultStatus === "pending",
        ),
    ) ?? false;
  const scoresheetVersion = (tournament?.scores ?? [])
    .map((score) => `${score.id}:${score.roundId}:${score.score}`)
    .concat(
      tournament?.gameScores.map(
        (score) =>
          `${score.participantId}:${score.roundId}:game-${score.gameNumber}:${score.placement ?? "pending"}:${score.score ?? "pending"}`,
      ) ?? [],
    )
    .concat(
      tournament?.rounds.map(
        (round) => `${round.id}:round-${round.roundNumber}`,
      ) ?? [],
    )
    .concat([
      `checkmate:${tournament?.roundProgress?.winnerParticipantId ?? "none"}:${tournament?.roundProgress?.decisiveGame ?? "none"}`,
    ])
    .join("|");
  const isTournamentCompleted = tournament?.status === "completed";
  const remainingRegistrationSlots = tournament
    ? Math.max(tournament.playerCount - tournament.registrations.length, 0)
    : 0;
  const defaultRandomPlayerCount = Math.min(8, remainingRegistrationSlots);

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
            {!tournament.hasStarted ? (
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
                      {!meetsStartRequirement ? (
                        <p className="mt-2 text-sm font-medium text-amber-800">
                          {tournament.startRequirement.exactEntrants !== null
                            ? `This format requires exactly ${tournament.startRequirement.exactEntrants} entrants to start.`
                            : `Register at least ${tournament.startRequirement.minimumEntrants} entrants to start.`}
                        </p>
                      ) : null}
                      <form action={startTournamentAction} className="mt-4">
                        <input
                          name="tournamentId"
                          type="hidden"
                          value={tournament.id}
                        />
                        <button
                          className={`flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${
                            tournament.registrations.length === 0 || !meetsStartRequirement
                              ? "cursor-not-allowed bg-zinc-200 text-zinc-500"
                              : "bg-emerald-700 text-white hover:bg-emerald-800"
                          }`}
                          disabled={tournament.registrations.length === 0 || !meetsStartRequirement}
                          type="submit"
                        >
                          Start tournament
                        </button>
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
              </section>
            ) : null}

            {tournament.hasStarted ? (
              <>
                <div className="pt-8">
                  <TournamentGraph
                    edges={tournament.edges}
                    nodes={tournament.nodes}
                    selectedNodeId={tournament.selectedNodeId}
                    started
                    tournamentId={tournament.id}
                  />
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
                  details={
                    <TournamentDetails
                      currentRoundLabel={currentRoundLabel}
                      deleteError={deleteError}
                      enteredRegistrationIds={enteredRegistrationIds}
                      potentialEntrantCount={potentialEntrantCount}
                      startRequirement={tournament.startRequirement}
                      registrationError={registrationError}
                      startError={startError}
                      tournament={tournament}
                    />
                  }
                  lobbies={
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
                              {tournament.roundProgress?.roundFormat === "checkmate"
                                ? `${tournament.roundProgress.completedGames} game${tournament.roundProgress.completedGames === 1 ? "" : "s"} complete${tournament.roundProgress.maxGames ? ` of ${tournament.roundProgress.maxGames}` : ""}.`
                                : tournament.roundProgress
                                  ? `${tournament.roundProgress.completedGames} of ${tournament.roundProgress.configuredGames} games complete.`
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
                                isTournamentCompleted || !hasPendingCurrentRoundLobby
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

                      {tournament.roundProgress?.nextReseedGame ? (
                        <p className="mt-3 text-sm font-medium text-cyan-800">
                          Automatic reseed begins at Game {tournament.roundProgress.nextReseedGame} after
                          the current block is complete.
                        </p>
                      ) : null}

                      {tournament.roundProgress?.roundFormat === "checkmate" ? (
                        <p className="mt-3 text-sm font-medium text-violet-800">
                          Checkmate threshold: above {tournament.roundProgress.checkmateThreshold} points before a game.
                          {tournament.roundProgress.winnerParticipantId
                            ? ` Decisive game: ${tournament.roundProgress.decisiveGame}.`
                            : tournament.roundProgress.maxGames
                              ? ` The round falls back to points after ${tournament.roundProgress.maxGames} games.`
                              : " Games continue until an eligible first place is recorded."}
                        </p>
                      ) : null}

                      {tournament.progressionAction ? (
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

                      <LobbyBrowser
                        initialGameNumber={Number.isInteger(requestedGame) ? requestedGame : null}
                        initialPage={Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1}
                        lobbies={tournament.lobbies}
                        tournamentId={tournament.id}
                      />
                    </div>
                  }
                  scoresheet={
                    <Scoresheet
                      gameScores={tournament.gameScores}
                      key={scoresheetVersion}
                      currentRoundId={tournament.currentRoundId}
                      currentRoundWinnerId={tournament.roundProgress?.winnerParticipantId}
                      rounds={tournament.rounds}
                      scores={tournament.scores}
                    />
                  }
                />
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
          </>
        ) : null}
      </div>
    </main>
  );
}
