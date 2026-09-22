import Link from "next/link";
import { redirect } from "next/navigation";
import { createTournamentAction } from "@/app/actions";
import { AccountHeader } from "@/components/account/account-header";
import { TournamentPagination } from "@/components/tournaments/tournament-pagination";
import { getOrganizerSession } from "@/lib/auth/session";
import {
  listTournaments,
  TOURNAMENT_PAGE_SIZE,
} from "@/lib/db/tournaments/api";
import { buildPageHref, parsePageParam } from "@/lib/pagination";
import type { TournamentListPageViewModel } from "@/lib/db/tournaments/types";
import { TOURNAMENT_FORMAT_OPTIONS } from "@/lib/tournament/formats/api";
import {
  PLAYERS_PER_TFT_LOBBY,
  validateTournamentCreation,
} from "@/lib/tournament/validation/api";

export const dynamic = "force-dynamic";

type HomeSearchParams = Promise<{
  createError?: string | string[];
  formatId?: string | string[];
  tournamentName?: string | string[];
  playerCount?: string | string[];
  page?: string | string[];
}>;

function getSearchValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

export default async function Home({
  searchParams,
}: {
  searchParams: HomeSearchParams;
}) {
  const query = await searchParams;
  const parsedPage = parsePageParam(query.page);
  if (parsedPage.redirectPage !== null) {
    redirect(buildPageHref("/", parsedPage.redirectPage));
  }
  const createError = getSearchValue(query.createError);
  const tournamentName = getSearchValue(query.tournamentName);
  const playerCount = getSearchValue(query.playerCount);
  const formatId = getSearchValue(query.formatId) || "default";
  const hasSubmitted = tournamentName !== "" || playerCount !== "";
  const organizer = await getOrganizerSession();
  const validation = hasSubmitted
    ? validateTournamentCreation({
        name: tournamentName,
        playerCount,
        formatId,
      })
    : null;
  let tournamentPage: TournamentListPageViewModel = {
    items: [],
    page: parsedPage.page,
    pageSize: TOURNAMENT_PAGE_SIZE,
    totalCount: 0,
    totalPages: 1,
  };
  let databaseError = "";

  try {
    tournamentPage = await listTournaments({
      page: parsedPage.page,
      pageSize: TOURNAMENT_PAGE_SIZE,
    });
  } catch (error) {
    databaseError =
      error instanceof Error
        ? error.message
        : "Tournament data could not be loaded.";
  }

  if (!databaseError && parsedPage.page > tournamentPage.totalPages) {
    redirect(buildPageHref("/", tournamentPage.totalPages));
  }

  const tournaments = tournamentPage.items;

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between border-b border-zinc-200 pb-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-700">
              TFTourney
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              Tournament operations for Teamfight Tactics
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-100" href="/player">
              Player home
            </Link>
            <AccountHeader organizer={organizer} returnTo="/dashboard" />
          </div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.02fr_0.98fr] lg:py-16">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">
              Create tournament
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-normal text-zinc-950 sm:text-5xl">
              Set up a TFT bracket with lobby-ready player counts.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-zinc-600 sm:text-lg">
              Enter the tournament name, total player count, and format.
              TFTourney creates the event as accepting players and keeps it
              marked as not started until match operations begin.
            </p>

            <div className="mt-8 grid max-w-xl grid-cols-3 gap-3 text-sm">
              <div className="border-l-4 border-emerald-600 bg-white px-4 py-3 shadow-sm">
                <p className="font-semibold text-zinc-950">8</p>
                <p className="mt-1 text-zinc-500">players per lobby</p>
              </div>
              <div className="border-l-4 border-amber-500 bg-white px-4 py-3 shadow-sm">
                <p className="font-semibold text-zinc-950">512</p>
                <p className="mt-1 text-zinc-500">max players</p>
              </div>
              <div className="border-l-4 border-zinc-800 bg-white px-4 py-3 shadow-sm">
                <p className="font-semibold text-zinc-950">2</p>
                <p className="mt-1 text-zinc-500">round default</p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-5">
              <div>
                <h2 className="text-xl font-semibold text-zinc-950">
                  Tournament details
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Start with the fields needed to save a tournament draft.
                </p>
              </div>
              <span className={`rounded-md px-3 py-1 text-sm font-medium ${organizer ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
                {organizer ? "Ready to create" : "Sign-in required"}
              </span>
            </div>

            {!organizer ? (
              <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-950">Sign in to create a tournament</p>
                <p className="mt-1 text-sm leading-6 text-amber-900">Your tournaments are saved to your organizer dashboard.</p>
                <a className="mt-3 inline-flex rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800" href="/api/auth/google?intent=signin&returnTo=%2Fdashboard">Sign in with Google</a>
              </div>
            ) : null}

            <fieldset className={organizer ? "" : "mt-5 opacity-50"} disabled={!organizer}>
            <Link
              className="mt-5 flex items-center justify-center rounded-md border border-emerald-700 px-4 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
              href="/tournaments/new"
            >
              Build a graphical format
            </Link>

            <form action={createTournamentAction} className="mt-6 space-y-5">
              <div>
                <label
                  className="block text-sm font-medium text-zinc-800"
                  htmlFor="tournamentName"
                >
                  Tournament name
                </label>
                <input
                  aria-describedby={
                    validation?.errors.name
                      ? "tournamentName-error"
                      : "tournamentName-help"
                  }
                  aria-invalid={Boolean(validation?.errors.name)}
                  className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
                  defaultValue={tournamentName}
                  id="tournamentName"
                  maxLength={80}
                  name="tournamentName"
                  placeholder="Friday TFT Open"
                  required
                  type="text"
                />
                {validation?.errors.name ? (
                  <p
                    className="mt-2 text-sm font-medium text-red-700"
                    id="tournamentName-error"
                  >
                    {validation.errors.name}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-zinc-500" id="tournamentName-help">
                    3-80 characters. Start with a letter or number.
                  </p>
                )}
              </div>

              <div>
                <label
                  className="block text-sm font-medium text-zinc-800"
                  htmlFor="playerCount"
                >
                  Number of players
                </label>
                <input
                  aria-describedby={
                    validation?.errors.playerCount
                      ? "playerCount-error"
                      : "playerCount-help"
                  }
                  aria-invalid={Boolean(validation?.errors.playerCount)}
                  className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
                  defaultValue={playerCount}
                  id="playerCount"
                  inputMode="numeric"
                  max={512}
                  min={8}
                  name="playerCount"
                  placeholder="32"
                  required
                  step={8}
                  type="number"
                />
                {validation?.errors.playerCount ? (
                  <p
                    className="mt-2 text-sm font-medium text-red-700"
                    id="playerCount-error"
                  >
                    {validation.errors.playerCount}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-zinc-500" id="playerCount-help">
                    Must divide exactly into 8-player TFT lobbies.
                  </p>
                )}
              </div>

              <div>
                <label
                  className="block text-sm font-medium text-zinc-800"
                  htmlFor="formatId"
                >
                  Tournament format
                </label>
                <select
                  aria-describedby="formatId-help"
                  className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
                  defaultValue={formatId}
                  id="formatId"
                  name="formatId"
                >
                  {TOURNAMENT_FORMAT_OPTIONS.map((format) => (
                    <option key={format.id} value={format.id}>
                      {format.name}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-sm text-zinc-500" id="formatId-help">
                  The default format is selected for now.
                </p>
              </div>

              <button
                className="flex h-11 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
                type="submit"
              >
                Create tournament
              </button>
            </form>
            </fieldset>

            {createError ? (
              <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-900">
                  Tournament was not created
                </p>
                <p className="mt-2 text-sm text-red-800">{createError}</p>
              </div>
            ) : null}

            {validation?.success ? (
              <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-semibold text-emerald-900">
                  Tournament details are valid
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-emerald-700">Name</dt>
                    <dd className="mt-1 font-medium text-emerald-950">
                      {validation.data.name}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-emerald-700">Opening lobbies</dt>
                    <dd className="mt-1 font-medium text-emerald-950">
                      {validation.data.playerCount / PLAYERS_PER_TFT_LOBBY}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </div>
        </section>

        <section className="border-t border-zinc-200 py-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-zinc-950">
                Tournaments
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Click a tournament to view its registered players.
              </p>
            </div>
          </div>

          {databaseError ? (
            <div className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-950">
                Database unavailable
              </p>
              <p className="mt-2 text-sm text-amber-900">{databaseError}</p>
            </div>
          ) : tournaments.length === 0 ? (
            <div className="mt-5 rounded-md border border-zinc-200 bg-white p-5 text-sm text-zinc-500">
              No tournaments have been created yet.
            </div>
          ) : (
            <div className="mt-5 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Tournament</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Players</th>
                    <th className="px-4 py-3 font-medium">Round</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {tournaments.map((tournament) => (
                    <tr key={tournament.id} className="align-top">
                      <td className="px-4 py-3">
                        <Link
                          className="font-semibold text-emerald-800 hover:text-emerald-950"
                          href={`/tournaments/${tournament.id}`}
                        >
                          {tournament.name}
                        </Link>
                        <p className="mt-1 text-xs text-zinc-500">
                          {tournament.formatId}
                        </p>
                      </td>
                      <td className="px-4 py-3 capitalize text-zinc-700">
                        {tournament.status.replaceAll("_", " ")}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {tournament.registeredPlayerCount} /{" "}
                        {tournament.playerCount}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {tournament.currentRoundNumber
                          ? `Round ${tournament.currentRoundNumber}`
                          : "Not started"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TournamentPagination
                page={tournamentPage.page}
                pageSize={tournamentPage.pageSize}
                pathname="/"
                totalCount={tournamentPage.totalCount}
                totalPages={tournamentPage.totalPages}
              />
            </div>
          )}
        </section>

        <div className="grid gap-3 border-t border-zinc-200 py-5 text-sm text-zinc-500 sm:grid-cols-3">
          <p>Next: player registration</p>
          <p>Then: seeding and lobby generation</p>
          <p>Later: OCR review and Sheets sync</p>
        </div>
      </div>
    </main>
  );
}
