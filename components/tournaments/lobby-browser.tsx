import Link from "next/link";
import type { TournamentLobbiesPanelViewModel } from "@/lib/db/tournaments/types";
import { getPageNavigation } from "@/lib/pagination";

type LobbyBrowserProps = {
  panel: TournamentLobbiesPanelViewModel;
  tournamentId: string;
};

function hrefFor(tournamentId: string, nodeId: string | null, game: number | null, page: number): string {
  const params = new URLSearchParams();
  if (nodeId) params.set("node", nodeId);
  if (game) params.set("game", String(game));
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/tournaments/${tournamentId}${query ? `?${query}` : ""}`;
}

export function LobbyBrowser({ panel, tournamentId }: LobbyBrowserProps) {
  const selectedGame = panel.selectedGameNumber;
  const roundId = panel.round?.id ?? null;
  const start = panel.totalCount === 0 ? 0 : (panel.page - 1) * panel.pageSize + 1;
  const end = Math.min(panel.page * panel.pageSize, panel.totalCount);
  if (panel.gameSummaries.length === 0) {
    return <div className="mt-5 rounded-md border border-zinc-200 bg-white p-5 text-sm text-zinc-500">No lobbies were generated for this round.</div>;
  }
  return (
    <div className="mt-5">
      <div aria-label="Games" className="flex flex-wrap gap-1 border-b border-zinc-200" role="tablist">
        {panel.gameSummaries.map((game) => (
          <Link
            aria-current={selectedGame === game.gameNumber ? "page" : undefined}
            className={`border-b-2 px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${selectedGame === game.gameNumber ? "border-emerald-700 text-emerald-800" : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"}`}
            href={hrefFor(tournamentId, roundId, game.gameNumber, 1)}
            key={game.gameNumber}
            role="tab"
          >
            Game {game.gameNumber}<span className="ml-2 text-xs font-normal text-zinc-500">{game.lobbyCount} lobbies</span>
          </Link>
        ))}
      </div>
      <div className="pt-5">
        <div className="mb-4 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-zinc-500">Showing lobbies {start}–{end} of {panel.totalCount}</p>
          {panel.totalPages > 1 ? (
            <nav aria-label={`Game ${selectedGame ?? ""} lobby pages`}>
              <div className="flex flex-wrap items-center justify-end gap-1">
                {panel.page === 1 ? <span aria-disabled="true" className="cursor-not-allowed rounded-md border border-zinc-200 px-3 py-2 font-medium text-zinc-400">Previous</span> : <Link aria-label="Previous lobby page" className="rounded-md border border-zinc-300 bg-white px-3 py-2 font-medium text-zinc-700 transition hover:bg-zinc-50" href={hrefFor(tournamentId, roundId, selectedGame, panel.page - 1)}>Previous</Link>}
                {getPageNavigation(panel.page, panel.totalPages).map((item) => item.type === "ellipsis" ? (
                  <span aria-hidden="true" className="px-2 text-zinc-400" key={item.key}>…</span>
                ) : (
                  <Link aria-current={panel.page === item.page ? "page" : undefined} className={`min-w-10 rounded-md border px-3 py-2 text-center font-medium transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${panel.page === item.page ? "border-emerald-700 bg-emerald-700 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`} href={hrefFor(tournamentId, roundId, selectedGame, item.page)} key={item.page}>{item.page}</Link>
                ))}
                {panel.page === panel.totalPages ? <span aria-disabled="true" className="cursor-not-allowed rounded-md border border-zinc-200 px-3 py-2 font-medium text-zinc-400">Next</span> : <Link aria-label="Next lobby page" className="rounded-md border border-zinc-300 bg-white px-3 py-2 font-medium text-zinc-700 transition hover:bg-zinc-50" href={hrefFor(tournamentId, roundId, selectedGame, panel.page + 1)}>Next</Link>}
              </div>
            </nav>
          ) : null}
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {panel.lobbies.map((lobby) => (
            <article className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm" key={lobby.id}>
              <div className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
                <h3 className="font-semibold text-zinc-950">Game {lobby.gameNumber} · Lobby {lobby.lobbyNumber}</h3>
                <Link className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2" href={`/tournaments/${tournamentId}/lobbies/${lobby.id}?game=${lobby.gameNumber}&page=${panel.page}`}>Input scores</Link>
              </div>
              <ol className="divide-y divide-zinc-100">
                {lobby.participants.map((participant) => (
                  <li className="flex items-center gap-3 px-4 py-3 text-sm" key={participant.id}>
                    <span className="w-6 text-zinc-400">{participant.slotNumber}</span>
                    <span className="flex-1 font-medium text-zinc-950">{participant.displayName}</span>
                    <span className="w-16 text-right font-semibold text-zinc-950">{participant.points === null ? "Pending" : `${participant.points} pts`}</span>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
