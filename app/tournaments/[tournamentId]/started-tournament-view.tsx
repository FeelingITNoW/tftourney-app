import type { ComponentProps } from "react";
import {
  finalizeTournamentNodeAction,
  randomizePendingLobbyResultsAction,
} from "@/app/actions";
import { LobbyBrowser } from "@/components/tournaments/lobby-browser";
import { TournamentGraph } from "@/components/tournaments/tournament-graph";
import { RoundTabs } from "@/components/tournaments/round-tabs";
import { Scoresheet } from "@/components/tournaments/scoresheet";
import { TournamentDetails } from "@/components/tournaments/tournament-details";
import { DiscordPanel } from "@/components/tournaments/discord-panel";
import type { TournamentCheckInState } from "@/lib/discord/api";
import type {
  TournamentGraphPanelViewModel,
  TournamentLobbiesPanelViewModel,
  TournamentPanelView,
  TournamentScoresheetPanelViewModel,
} from "@/lib/db/tournaments/types";
import type { TournamentPageTournament } from "./page";

type StartedTournamentViewProps = {
  tournament: TournamentPageTournament;
  view: TournamentPanelView;
  progressed: boolean;
  isTournamentCompleted: boolean;
  isTournamentHost: boolean;
  requestedNode: string;
  requestedGame: number;
  requestedPage: number;
  currentRoundLabel: string;
  potentialEntrantCount: number;
  enteredRegistrationIds: Set<string>;
  registrationError: string;
  startError: string;
  deleteError: string;
  checkInError: string;
  checkInState: TournamentCheckInState | null;
  checkInUpdated: string;
  discordConfig: Omit<ComponentProps<typeof DiscordPanel>, "tournamentId">["discordConfig"];
  discordConnected: boolean;
  discordDisconnected: string;
  discordError: string;
  discordManagerGranted: boolean;
  discordPendingTooLong: boolean;
  managerInvite: string;
  rawDiscordConfig: Omit<ComponentProps<typeof DiscordPanel>, "tournamentId">["rawDiscordConfig"];
  graphPanel: TournamentGraphPanelViewModel | null;
  scoresheetPanel: TournamentScoresheetPanelViewModel | null;
  lobbyPanel: TournamentLobbiesPanelViewModel | null;
  randomized: boolean;
  progressionError: string;
  hasPendingCurrentRoundLobby: boolean;
};

// The started-tournament layout: the round tabs plus whichever panel
// (details/graph/scoresheet/lobbies) is selected. Rendered only while
// tournament.hasStarted; extracted verbatim from the tournament page's JSX.
export function StartedTournamentView({
  tournament,
  view,
  progressed,
  isTournamentCompleted,
  isTournamentHost,
  requestedNode,
  requestedGame,
  requestedPage,
  currentRoundLabel,
  potentialEntrantCount,
  enteredRegistrationIds,
  registrationError,
  startError,
  deleteError,
  checkInError,
  checkInState,
  checkInUpdated,
  discordConfig,
  discordConnected,
  discordDisconnected,
  discordError,
  discordManagerGranted,
  discordPendingTooLong,
  managerInvite,
  rawDiscordConfig,
  graphPanel,
  scoresheetPanel,
  lobbyPanel,
  randomized,
  progressionError,
  hasPendingCurrentRoundLobby,
}: StartedTournamentViewProps) {
  return (
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
  );
}
