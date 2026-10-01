import { startTournamentAction } from "@/app/actions";
import { PendingButton } from "@/components/ui/pending-button";
import { TournamentGraph } from "@/components/tournaments/tournament-graph";
import type { TournamentCheckInState } from "@/lib/discord/api";
import type { TournamentPageTournament } from "./page";

type PreStartScreen = "overview" | "format";

type PreStartPanelsProps = {
  screen: PreStartScreen;
  tournament: TournamentPageTournament;
  isTournamentHost: boolean;
  isAcceptingPlayers: boolean;
  isTournamentCompleted: boolean;
  potentialEntrantCount: number;
  checkInInUse: boolean;
  checkInState: TournamentCheckInState | null;
  meetsStartRequirement: boolean;
  startDisabled: boolean;
  startLabel: string;
  startError: string;
};

// The pre-start screens: "overview" (start card) and "format" (graph
// preview). "players", "integrations", and "settings" are shared screens
// rendered directly from page.tsx.
export function PreStartPanels({
  screen,
  tournament,
  isTournamentHost,
  isAcceptingPlayers,
  isTournamentCompleted,
  potentialEntrantCount,
  checkInInUse,
  checkInState,
  meetsStartRequirement,
  startDisabled,
  startLabel,
  startError,
}: PreStartPanelsProps) {
  if (screen === "format") {
    return (
      <div className="pt-6">
        <TournamentGraph
          edges={tournament.edges}
          nodes={tournament.nodes}
          selectedNodeId={null}
          started={false}
          tournamentId={tournament.id}
        />
      </div>
    );
  }

  return (
    <div className="pt-6">
      <div className="max-w-xl rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
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
              <input name="tournamentId" type="hidden" value={tournament.id} />
              <PendingButton
                className={`flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${
                  startDisabled || !isTournamentHost
                    ? "cursor-not-allowed bg-zinc-200 text-zinc-500"
                    : "bg-emerald-700 text-white hover:bg-emerald-800"
                }`}
                disabled={startDisabled || !isTournamentHost}
                pendingLabel="Starting…"
              >
                {startLabel}
              </PendingButton>
            </form>
          </>
        ) : (
          <p className="mt-2 text-sm font-medium text-emerald-800">
            {isTournamentCompleted ? "Tournament is complete." : "Tournament is in progress."}
          </p>
        )}
        {startError ? <p className="mt-3 text-sm font-medium text-red-700">{startError}</p> : null}
      </div>
    </div>
  );
}
