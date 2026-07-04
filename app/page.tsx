import {
  PLAYERS_PER_TFT_LOBBY,
  validateTournamentCreation,
} from "@/lib/tournament/validation";

type HomeSearchParams = Promise<{
  tournamentName?: string | string[];
  playerCount?: string | string[];
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
  const tournamentName = getSearchValue(query.tournamentName);
  const playerCount = getSearchValue(query.playerCount);
  const hasSubmitted = tournamentName !== "" || playerCount !== "";
  const validation = hasSubmitted
    ? validateTournamentCreation({
        name: tournamentName,
        playerCount,
      })
    : null;

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
          <div className="hidden rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-600 shadow-sm sm:block">
            Starter setup
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
              Enter the tournament name and total player count. TFTourney checks
              that the event can be split cleanly into 8-player lobbies before
              the organizer flow continues.
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
                <p className="font-semibold text-zinc-950">1</p>
                <p className="mt-1 text-zinc-500">draft setup</p>
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
                  Start with the two fields needed to create clean lobbies.
                </p>
              </div>
              <span className="rounded-md bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800">
                Draft
              </span>
            </div>

            <form action="/" className="mt-6 space-y-5" method="get">
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

              <button
                className="flex h-11 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
                type="submit"
              >
                Create tournament draft
              </button>
            </form>

            {validation?.success ? (
              <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-sm font-semibold text-emerald-900">
                  Tournament draft ready
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

        <div className="grid gap-3 border-t border-zinc-200 py-5 text-sm text-zinc-500 sm:grid-cols-3">
          <p>Next: player registration</p>
          <p>Then: seeding and lobby generation</p>
          <p>Later: OCR review and Sheets sync</p>
        </div>
      </div>
    </main>
  );
}
