import { finalizeTournamentNodeAction } from "@/app/actions";
import { LobbyBrowser } from "@/components/tournaments/lobby-browser";
import { TournamentGraph } from "@/components/tournaments/tournament-graph";
import { Scoresheet } from "@/components/tournaments/scoresheet";
import type {
  TournamentGraphPanelViewModel,
  TournamentLobbiesPanelViewModel,
  TournamentScoresheetPanelViewModel,
} from "@/lib/db/tournaments/types";
import type { TournamentPageTournament } from "./page";

type StartedScreen = "lobbies" | "scoresheet" | "graph";

type StartedTournamentViewProps = {
  screen: StartedScreen;
  tournament: TournamentPageTournament;
  graphPanel: TournamentGraphPanelViewModel | null;
  scoresheetPanel: TournamentScoresheetPanelViewModel | null;
  lobbyPanel: TournamentLobbiesPanelViewModel | null;
  progressionError: string;
};

// The started-tournament screens: "lobbies" (round progress, finalize,
// lobby browser), "scoresheet", and "graph". "players", "integrations", and
// "settings" are shared screens rendered directly from page.tsx.
export function StartedTournamentView({
  screen,
  tournament,
  graphPanel,
  scoresheetPanel,
  lobbyPanel,
  progressionError,
}: StartedTournamentViewProps) {
  if (screen === "graph") {
    return (
      <TournamentGraph
        edges={graphPanel?.edges ?? tournament.edges}
        nodes={graphPanel?.nodes ?? tournament.nodes}
        selectedNodeId={tournament.selectedNodeId}
        started
        tournamentId={tournament.id}
      />
    );
  }

  if (screen === "scoresheet") {
    return <Scoresheet tabs={scoresheetPanel?.tabs ?? []} />;
  }

  return (
    <div className="pt-6">
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

      {lobbyPanel?.roundProgress?.nextReseedGame ? (
        <p className="mt-3 text-sm font-medium text-cyan-800">
          Automatic reseed begins at Game {lobbyPanel.roundProgress.nextReseedGame} after the current block is
          complete.
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
            All games are scored. Finalizing this node will resolve its ordered advancement edges and activate any
            ready destinations.
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
  );
}
