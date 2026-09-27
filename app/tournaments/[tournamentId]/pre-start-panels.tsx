import type { ComponentProps } from "react";
import {
  addRandomSeededPlayersAction,
  deleteTournamentAction,
  registerPlayerAction,
  startTournamentAction,
} from "@/app/actions";
import { DiscordPanel } from "@/components/tournaments/discord-panel";
import { PendingButton } from "@/components/ui/pending-button";
import type { TournamentCheckInState } from "@/lib/discord/api";
import type { TournamentPageTournament } from "./page";

type PreStartPanelsProps = {
  tournament: TournamentPageTournament;
  isTournamentHost: boolean;
  isAcceptingPlayers: boolean;
  isTournamentCompleted: boolean;
  currentRoundLabel: string;
  potentialEntrantCount: number;
  checkInInUse: boolean;
  checkInState: TournamentCheckInState | null;
  meetsStartRequirement: boolean;
  startDisabled: boolean;
  startLabel: string;
  startError: string;
  checkInError: string;
  checkInUpdated: string;
  discordConfig: Omit<ComponentProps<typeof DiscordPanel>, "tournamentId">["discordConfig"];
  discordConnected: boolean;
  discordDisconnected: string;
  discordError: string;
  discordManagerGranted: boolean;
  discordPendingTooLong: boolean;
  managerInvite: string;
  rawDiscordConfig: Omit<ComponentProps<typeof DiscordPanel>, "tournamentId">["rawDiscordConfig"];
  registrationError: string;
  randomPlayerError: string;
  randomPlayersAdded: number;
  randomPlayersSkipped: number;
  remainingRegistrationSlots: number;
  defaultRandomPlayerCount: number;
  deleteError: string;
};

// The pre-start layout: tournament info plus the host-only action panels
// (start, Discord, register, seed test players, delete). Rendered only while
// !tournament.hasStarted; extracted verbatim from the tournament page's JSX
// so this file's body is a straight copy, not a rewrite.
export function PreStartPanels({
  tournament,
  isTournamentHost,
  isAcceptingPlayers,
  isTournamentCompleted,
  currentRoundLabel,
  potentialEntrantCount,
  checkInInUse,
  checkInState,
  meetsStartRequirement,
  startDisabled,
  startLabel,
  startError,
  checkInError,
  checkInUpdated,
  discordConfig,
  discordConnected,
  discordDisconnected,
  discordError,
  discordManagerGranted,
  discordPendingTooLong,
  managerInvite,
  rawDiscordConfig,
  registrationError,
  randomPlayerError,
  randomPlayersAdded,
  randomPlayersSkipped,
  remainingRegistrationSlots,
  defaultRandomPlayerCount,
  deleteError,
}: PreStartPanelsProps) {
  return (
              <section className="grid gap-5 py-8 md:grid-cols-[1fr_19rem]">
              <fieldset className={`contents ${isTournamentHost ? "" : "opacity-60"}`} disabled={!isTournamentHost}>
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
                        <input
                          name="tournamentId"
                          type="hidden"
                          value={tournament.id}
                        />
                        <PendingButton
                          className={`flex h-11 w-full items-center justify-center rounded-md px-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${
                            startDisabled
                              ? "cursor-not-allowed bg-zinc-200 text-zinc-500"
                              : "bg-emerald-700 text-white hover:bg-emerald-800"
                          }`}
                          disabled={startDisabled}
                          pendingLabel="Starting…"
                        >
                          {startLabel}
                        </PendingButton>
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
              </fieldset>
              </section>
  );
}
