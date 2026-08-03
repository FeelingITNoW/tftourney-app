import Link from "next/link";
import type { ReactNode } from "react";
import type { TournamentPanelView } from "@/lib/db/tournaments/types";

type TournamentViewTabsProps = {
  tournamentId: string;
  activeView: TournamentPanelView;
  children: ReactNode;
  query?: { node?: string | null; game?: number | null; page?: number | null };
};

const labels: Array<{ id: TournamentPanelView; label: string }> = [
  { id: "lobbies", label: "Lobbies" },
  { id: "scoresheet", label: "Scoresheet" },
  { id: "graph", label: "Tournament graph" },
  { id: "details", label: "Details & players" },
];

function hrefFor(
  tournamentId: string,
  view: TournamentPanelView,
  query: TournamentViewTabsProps["query"],
): string {
  const params = new URLSearchParams();
  if (view !== "lobbies") params.set("view", view);
  if (view === "lobbies" && query?.node) params.set("node", query.node);
  if (view === "lobbies" && query?.game) params.set("game", String(query.game));
  if (view === "lobbies" && query?.page && query.page > 1) params.set("page", String(query.page));
  const suffix = params.toString();
  return `/tournaments/${tournamentId}${suffix ? `?${suffix}` : ""}`;
}

export function RoundTabs({ tournamentId, activeView, children, query }: TournamentViewTabsProps) {
  return (
    <section className="border-t border-zinc-200 py-8">
      <div aria-label="Tournament views" className="flex flex-wrap gap-1 border-b border-zinc-200" role="tablist">
        {labels.map((tab) => {
          const active = tab.id === activeView;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              aria-selected={active}
              className={`border-b-2 px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${active ? "border-emerald-700 text-emerald-800" : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"}`}
              href={hrefFor(tournamentId, tab.id, query)}
              key={tab.id}
              role="tab"
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <div aria-label={`${activeView} panel`} role="tabpanel" tabIndex={0}>
        {children}
      </div>
    </section>
  );
}

export { RoundTabs as TournamentViewTabs };
