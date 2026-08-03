"use client";

import { useState } from "react";
import type { ScoresheetTab } from "@/lib/tournament/scoring/scoresheet";
import { OVERALL_TAB_ID } from "@/lib/tournament/scoring/scoresheet";

type ScoresheetProps = {
  tabs: ScoresheetTab[];
};

export function Scoresheet({ tabs }: ScoresheetProps) {
  const [activeTabId, setActiveTabId] = useState(OVERALL_TAB_ID);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  if (!activeTab) {
    return null;
  }

  const isOverallTab = activeTab.id === OVERALL_TAB_ID;

  return (
    <section className="py-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-950">Scoresheet</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {isOverallTab
              ? "Game-by-game scores across every played round."
              : `${activeTab.label} games ordered by cumulative tournament points.`}
          </p>
        </div>
      </div>

      <div
        aria-label="Scoresheet views"
        className="mt-5 flex gap-1 overflow-x-auto border-b border-zinc-200"
        role="tablist"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab.id;

          return (
            <button
              aria-controls="scoresheet-panel"
              aria-selected={isActive}
              className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-600 ${
                isActive
                  ? "border-emerald-700 text-emerald-800"
                  : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"
              }`}
              id={`scoresheet-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              role="tab"
              type="button"
            >
              <span className="flex flex-col items-center leading-tight">
                <span>{tab.label}</span>
                {tab.isCheckmate ? (
                  <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-violet-700">
                    Checkmate
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div
        aria-labelledby={`scoresheet-tab-${activeTab.id}`}
        id="scoresheet-panel"
        role="tabpanel"
      >
        {activeTab.scores.length === 0 ? (
          <div className="mt-5 rounded-md border border-zinc-200 bg-white p-5 text-sm text-zinc-500">
            No score rows were created for {activeTab.label.toLowerCase()}.
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto overscroll-x-contain rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-max border-separate border-spacing-0 text-left text-sm">
              <thead className="text-zinc-600">
                <tr>
                  <th
                    aria-sort="ascending"
                    className="sticky left-0 z-30 w-12 min-w-12 border-b border-r border-zinc-200 bg-zinc-50 px-3 py-3 text-right font-medium"
                  >
                    #
                  </th>
                  <th className="sticky left-12 z-30 min-w-52 border-b border-r border-zinc-200 bg-zinc-50 px-4 py-3 font-medium">
                    Player
                  </th>
                  {activeTab.columns.map((column) => (
                    <th
                      className="min-w-28 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-right font-medium"
                      key={column.id}
                    >
                      {column.label}
                    </th>
                  ))}
                  {!isOverallTab ? (
                    <th className="sticky right-28 z-30 min-w-28 border-b border-l border-zinc-200 bg-zinc-50 px-4 py-3 text-right font-medium shadow-[-4px_0_8px_-6px_rgba(24,24,27,0.3)]">
                      Round total
                    </th>
                  ) : null}
                  <th className="sticky right-0 z-30 min-w-28 border-b border-l border-zinc-200 bg-zinc-50 px-4 py-3 text-right font-medium shadow-[-4px_0_8px_-6px_rgba(24,24,27,0.45)]">
                    Overall
                  </th>
                </tr>
              </thead>
              <tbody>
                {activeTab.scores.map((score) => (
                  <tr key={score.participantId}>
                    <td className="sticky left-0 z-20 w-12 min-w-12 border-b border-r border-zinc-200 bg-white px-3 py-3 text-right text-zinc-500">
                      {score.rank}
                    </td>
                    <td className="sticky left-12 z-20 min-w-52 border-b border-r border-zinc-200 bg-white px-4 py-3 font-medium text-zinc-950">
                      {score.displayName}
                    </td>
                    {activeTab.columns.map((column) => {
                      const value = score.breakdown[column.id];
                      const label =
                        typeof value === "number"
                          ? value
                          : value === null
                            ? "Pending"
                            : "—";

                      return (
                        <td
                          className="border-b border-zinc-200 px-4 py-3 text-right text-zinc-600"
                          key={column.id}
                        >
                          {label}
                        </td>
                      );
                    })}
                    {!isOverallTab ? (
                      <td className="sticky right-28 z-20 min-w-28 border-b border-l border-zinc-200 bg-white px-4 py-3 text-right font-semibold text-zinc-950 shadow-[-4px_0_8px_-6px_rgba(24,24,27,0.3)]">
                        {score.roundScore ?? "—"}
                      </td>
                    ) : null}
                    <td className="sticky right-0 z-20 min-w-28 border-b border-l border-zinc-200 bg-white px-4 py-3 text-right font-semibold text-zinc-950 shadow-[-4px_0_8px_-6px_rgba(24,24,27,0.45)]">
                      {score.score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
