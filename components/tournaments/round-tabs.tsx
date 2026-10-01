import Link from "next/link";
import type { ReactNode } from "react";
import type { TournamentScreen, TournamentScreenTab } from "@/app/tournaments/[tournamentId]/screens";

type RoundTabsProps = {
  tournamentId: string;
  activeScreen: TournamentScreen;
  defaultScreen: TournamentScreen;
  tabs: TournamentScreenTab[];
  children: ReactNode;
  query?: { node?: string | null; game?: number | null; page?: number | null };
};

function hrefFor(
  tournamentId: string,
  screen: TournamentScreen,
  defaultScreen: TournamentScreen,
  query: RoundTabsProps["query"],
): string {
  const params = new URLSearchParams();
  if (screen !== defaultScreen) params.set("view", screen);
  if (screen === "lobbies" && query?.node) params.set("node", query.node);
  if (screen === "lobbies" && query?.game) params.set("game", String(query.game));
  if (screen === "lobbies" && query?.page && query.page > 1) params.set("page", String(query.page));
  const suffix = params.toString();
  return `/tournaments/${tournamentId}${suffix ? `?${suffix}` : ""}`;
}

export function RoundTabs({ tournamentId, activeScreen, defaultScreen, tabs, children, query }: RoundTabsProps) {
  return (
    <section className="border-t border-zinc-200 py-8">
      <div aria-label="Tournament screens" className="flex flex-wrap gap-1 border-b border-zinc-200" role="tablist">
        {tabs.map((tab) => {
          const active = tab.id === activeScreen;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              aria-selected={active}
              className={`border-b-2 px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${active ? "border-emerald-700 text-emerald-800" : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"}`}
              href={hrefFor(tournamentId, tab.id, defaultScreen, query)}
              key={tab.id}
              role="tab"
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <div aria-label={`${activeScreen} panel`} role="tabpanel" tabIndex={0}>
        {children}
      </div>
    </section>
  );
}
