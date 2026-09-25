import { AccountHeader } from "@/components/account/account-header";
import { SiteHeader } from "@/components/layout/site-header";
import { QuickCreateForm } from "@/components/tournaments/quick-create-form";
import { TournamentFormatBuilder } from "@/components/tournaments/tournament-format-builder";
import { getPlayerSession } from "@/lib/auth/player-session";
import { requireOrganizer } from "@/lib/auth/session";
import { validateTournamentCreation } from "@/lib/tournament/validation/api";

export const dynamic = "force-dynamic";

type NewTournamentSearchParams = Promise<{
  createError?: string | string[];
  formatId?: string | string[];
  tournamentName?: string | string[];
  playerCount?: string | string[];
}>;

function getSearchValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

export default async function NewTournamentPage({
  searchParams,
}: {
  searchParams: NewTournamentSearchParams;
}) {
  const [organizer, player] = await Promise.all([
    requireOrganizer("/tournaments/new"),
    getPlayerSession(),
  ]);

  const query = await searchParams;
  const createError = getSearchValue(query.createError);
  const tournamentName = getSearchValue(query.tournamentName);
  const playerCount = getSearchValue(query.playerCount);
  const formatId = getSearchValue(query.formatId) || "default";
  const hasSubmitted = tournamentName !== "" || playerCount !== "";
  const validation = hasSubmitted
    ? validateTournamentCreation({
        name: tournamentName,
        playerCount,
        formatId,
      })
    : null;

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <SiteHeader
        actions={<AccountHeader organizer={organizer} returnTo="/tournaments/new" />}
        backHref="/dashboard"
        backLabel="Back to dashboard"
        maxWidthClassName="max-w-[1440px]"
        mode="host"
        showNav={false}
        subtitle="Set up a new tournament"
        switchHref={player ? "/player" : undefined}
        switchLabel="Switch to player view"
      />
      <div className="mx-auto w-full max-w-[1440px] px-6 py-8 sm:px-8 lg:px-10">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">Create tournament</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">New tournament</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-zinc-600">
            Quick-create with a name, player count, and default format, or
            compose a custom bracket as a graph of rounds and advancement
            rules.
          </p>
          <nav className="mt-5 flex gap-4 text-sm font-semibold">
            <a className="text-emerald-800 hover:text-emerald-950" href="#quick-create">
              Quick create
            </a>
            <a className="text-emerald-800 hover:text-emerald-950" href="#graph-builder">
              Graph format builder
            </a>
          </nav>
        </div>

        <section className="grid gap-10 py-8 lg:grid-cols-[1.1fr_1fr]" id="quick-create">
          <div className="max-w-xl">
            <h2 className="text-2xl font-semibold text-zinc-950">Quick create</h2>
            <p className="mt-3 text-base leading-7 text-zinc-600">
              Enter the tournament name, total player count, and format.
              TFTourney creates the event as accepting players and keeps it
              marked as not started until match operations begin.
            </p>
            <div className="mt-8 grid max-w-md grid-cols-3 gap-3 text-sm">
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
          <QuickCreateForm
            createError={createError}
            formatId={formatId}
            playerCount={playerCount}
            tournamentName={tournamentName}
            validation={validation}
          />
        </section>

        <section className="border-t border-zinc-200 py-8" id="graph-builder">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">Advanced</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Graph format builder</h2>
            <p className="mt-3 text-base leading-7 text-zinc-600">
              Choose a starting preset, then arrange round nodes and connect advancement edges. Each node keeps its own game count and reseeding rule, while edges decide which ranked players move on.
            </p>
          </div>
          <div className="mt-8">
            <TournamentFormatBuilder />
          </div>
        </section>
      </div>
    </main>
  );
}
