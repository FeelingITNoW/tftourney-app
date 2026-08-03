import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountHeader } from "@/components/account/account-header";
import { TournamentPagination } from "@/components/tournaments/tournament-pagination";
import { requireOrganizer } from "@/lib/auth/session";
import {
  listHostedTournaments,
  TOURNAMENT_PAGE_SIZE,
} from "@/lib/db/tournaments/api";
import { buildPageHref, parsePageParam } from "@/lib/pagination";
import type { TournamentListPageViewModel } from "@/lib/db/tournaments/types";

export const dynamic = "force-dynamic";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}

type DashboardSearchParams = Promise<{
  page?: string | string[];
}>;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: DashboardSearchParams;
}) {
  const query = await searchParams;
  const parsedPage = parsePageParam(query.page);
  if (parsedPage.redirectPage !== null) {
    redirect(buildPageHref("/dashboard", parsedPage.redirectPage));
  }
  const organizer = await requireOrganizer("/dashboard");
  let tournamentPage: TournamentListPageViewModel = {
    items: [],
    page: parsedPage.page,
    pageSize: TOURNAMENT_PAGE_SIZE,
    totalCount: 0,
    totalPages: 1,
  };
  let databaseError = "";
  try {
    tournamentPage = await listHostedTournaments(organizer.hostUserId, {
      page: parsedPage.page,
      pageSize: TOURNAMENT_PAGE_SIZE,
    });
  } catch (error) {
    databaseError = error instanceof Error ? error.message : "Your tournaments could not be loaded.";
  }
  if (!databaseError && parsedPage.page > tournamentPage.totalPages) {
    redirect(buildPageHref("/dashboard", tournamentPage.totalPages));
  }
  const tournaments = tournamentPage.items;

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-6 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between border-b border-zinc-200 pb-5">
          <div>
            <Link className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-700" href="/">TFTourney</Link>
            <p className="mt-1 text-sm text-zinc-500">Your tournament dashboard</p>
          </div>
          <AccountHeader organizer={organizer} returnTo="/dashboard" />
        </header>

        <section className="flex items-end justify-between gap-4 py-10">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">Organizer workspace</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Hosted tournaments</h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-zinc-600">Open a tournament to manage players, lobbies, results, and publishing.</p>
          </div>
          <Link className="hidden rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 sm:inline-flex" href="/tournaments/new">Create tournament</Link>
        </section>

        {databaseError ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5"><p className="font-semibold text-amber-950">Dashboard unavailable</p><p className="mt-2 text-sm text-amber-900">{databaseError}</p></section>
        ) : tournaments.length === 0 ? (
          <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center shadow-sm">
            <h2 className="text-xl font-semibold">No tournaments yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">Create your first tournament and it will appear here for quick access.</p>
            <Link className="mt-6 inline-flex rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800" href="/tournaments/new">Create your first tournament</Link>
          </section>
        ) : (
          <section aria-label="Hosted tournaments" className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
                <thead className="bg-zinc-50 text-zinc-600"><tr><th className="px-5 py-4 font-medium">Tournament</th><th className="px-5 py-4 font-medium">Status</th><th className="px-5 py-4 font-medium">Players</th><th className="px-5 py-4 font-medium">Created</th><th className="px-5 py-4"><span className="sr-only">Open</span></th></tr></thead>
                <tbody className="divide-y divide-zinc-100">
                  {tournaments.map((tournament) => (
                    <tr className="hover:bg-zinc-50" key={tournament.id}>
                      <td className="px-5 py-4"><p className="font-semibold text-zinc-950">{tournament.name}</p><p className="mt-1 text-xs text-zinc-500">{tournament.formatId}</p></td>
                      <td className="px-5 py-4"><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold capitalize text-emerald-800">{tournament.status.replaceAll("_", " ")}</span></td>
                      <td className="px-5 py-4 text-zinc-700">{tournament.registeredPlayerCount} / {tournament.playerCount}</td>
                      <td className="px-5 py-4 text-zinc-600">{formatDate(tournament.createdAt)}</td>
                      <td className="px-5 py-4 text-right"><Link className="font-semibold text-emerald-800 hover:text-emerald-950" href={`/tournaments/${tournament.id}`}>Manage<span className="sr-only"> {tournament.name}</span></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TournamentPagination
                page={tournamentPage.page}
                pageSize={tournamentPage.pageSize}
                pathname="/dashboard"
                totalCount={tournamentPage.totalCount}
                totalPages={tournamentPage.totalPages}
              />
            </div>
          </section>
        )}
        <Link className="mt-5 inline-flex self-start rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 sm:hidden" href="/tournaments/new">Create tournament</Link>
      </div>
    </main>
  );
}
