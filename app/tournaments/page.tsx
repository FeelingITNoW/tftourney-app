import Link from "next/link";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/layout/site-header";
import { TournamentPagination } from "@/components/tournaments/tournament-pagination";
import {
  listTournaments,
  TOURNAMENT_PAGE_SIZE,
} from "@/lib/db/tournaments/api";
import { buildPageHref, parsePageParam } from "@/lib/pagination";
import type { TournamentListPageViewModel } from "@/lib/db/tournaments/types";

export const dynamic = "force-dynamic";

type TournamentsSearchParams = Promise<{
  page?: string | string[];
}>;

export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: TournamentsSearchParams;
}) {
  const query = await searchParams;
  const parsedPage = parsePageParam(query.page);
  if (parsedPage.redirectPage !== null) {
    redirect(buildPageHref("/tournaments", parsedPage.redirectPage));
  }

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
    redirect(buildPageHref("/tournaments", tournamentPage.totalPages));
  }

  const tournaments = tournamentPage.items;

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <SiteHeader mode="public" subtitle="Every tournament on TFTourney" />
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 sm:px-8 lg:px-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-amber-700">Browse</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Tournaments</h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-zinc-600">
              Click a tournament to view its registered players and status.
            </p>
          </div>
        </div>

        {databaseError ? (
          <div className="mt-8 rounded-md border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-950">Database unavailable</p>
            <p className="mt-2 text-sm text-amber-900">{databaseError}</p>
          </div>
        ) : tournaments.length === 0 ? (
          <div className="mt-8 rounded-md border border-zinc-200 bg-white p-5 text-sm text-zinc-500">
            No tournaments have been created yet.
          </div>
        ) : (
          <div className="mt-8 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
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
              pathname="/tournaments"
              totalCount={tournamentPage.totalCount}
              totalPages={tournamentPage.totalPages}
            />
          </div>
        )}
      </div>
    </main>
  );
}
