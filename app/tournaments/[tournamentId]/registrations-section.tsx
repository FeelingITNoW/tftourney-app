import { setRegistrationCheckInAction } from "@/app/actions";
import { TournamentGraph } from "@/components/tournaments/tournament-graph";
import { PendingButton } from "@/components/ui/pending-button";
import type { TournamentPageTournament } from "./page";

type RegistrationsSectionProps = {
  tournament: TournamentPageTournament;
  checkInInUse: boolean;
  enteredRegistrationIds: Set<string>;
  checkedInRegistrationIds: Set<string>;
  isTournamentHost: boolean;
};

// The pre-start graph preview plus the registered-players table (with
// check-in toggles when Discord check-in is in use). Rendered only while
// !tournament.hasStarted; extracted verbatim from the tournament page's JSX.
export function RegistrationsSection({
  tournament,
  checkInInUse,
  enteredRegistrationIds,
  checkedInRegistrationIds,
  isTournamentHost,
}: RegistrationsSectionProps) {
  return (
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
  );
}
