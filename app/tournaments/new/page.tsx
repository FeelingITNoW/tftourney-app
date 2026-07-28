import Link from "next/link";
import { AccountHeader } from "@/components/account/account-header";
import { requireOrganizer } from "@/lib/auth/session";
import { TournamentFormatBuilder } from "@/components/tournaments/tournament-format-builder";

export const dynamic = "force-dynamic";

export default async function NewTournamentPage() {
  await requireOrganizer("/tournaments/new");
  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <div className="mx-auto w-full max-w-[1440px] px-6 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between border-b border-zinc-200 pb-5">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-700">TFTourney</p>
            <p className="mt-1 text-sm text-zinc-500">Graphical tournament format builder</p>
          </div>
          <div className="flex items-center gap-4"><Link className="text-sm font-semibold text-emerald-800 hover:text-emerald-950" href="/">Back to tournaments</Link><AccountHeader returnTo="/tournaments/new" /></div>
        </header>

        <section className="py-8">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">Create tournament</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Compose the tournament as a graph</h1>
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
