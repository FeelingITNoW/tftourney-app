"use client";

import { useState, type ReactNode } from "react";

type CurrentRoundView = "current-round" | "scoresheet";

type CurrentRoundViewTabsProps = {
  currentRoundView: ReactNode;
  scoresheetView: ReactNode;
};

const views: Array<{ id: CurrentRoundView; label: string }> = [
  { id: "current-round", label: "Current round" },
  { id: "scoresheet", label: "Scoresheet" },
];

export function CurrentRoundViewTabs({
  currentRoundView,
  scoresheetView,
}: CurrentRoundViewTabsProps) {
  const [activeView, setActiveView] =
    useState<CurrentRoundView>("current-round");

  return (
    <section className="border-t border-zinc-200 pb-8">
      <div
        aria-label="Current round workspace"
        className="flex gap-1 overflow-x-auto border-b border-zinc-200"
        role="tablist"
      >
        {views.map((view) => {
          const isActive = view.id === activeView;

          return (
            <button
              aria-controls={`current-round-panel-${view.id}`}
              aria-selected={isActive}
              className={`whitespace-nowrap border-b-2 px-5 py-4 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-600 ${
                isActive
                  ? "border-emerald-700 text-emerald-800"
                  : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"
              }`}
              id={`current-round-tab-${view.id}`}
              key={view.id}
              onClick={() => setActiveView(view.id)}
              role="tab"
              type="button"
            >
              {view.label}
            </button>
          );
        })}
      </div>

      <div
        aria-labelledby="current-round-tab-current-round"
        hidden={activeView !== "current-round"}
        id="current-round-panel-current-round"
        role="tabpanel"
      >
        {currentRoundView}
      </div>
      <div
        aria-labelledby="current-round-tab-scoresheet"
        hidden={activeView !== "scoresheet"}
        id="current-round-panel-scoresheet"
        role="tabpanel"
      >
        {scoresheetView}
      </div>
    </section>
  );
}
