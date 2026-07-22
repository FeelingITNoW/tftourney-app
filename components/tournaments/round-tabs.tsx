"use client";

import { useState, type ReactNode } from "react";

type RoundTabsProps = {
  details: ReactNode;
  graph: ReactNode;
  lobbies: ReactNode;
  scoresheet: ReactNode;
};

export function RoundTabs({ details, graph, lobbies, scoresheet }: RoundTabsProps) {
  const [activeTab, setActiveTab] = useState<
    "lobbies" | "scoresheet" | "graph" | "details"
  >("lobbies");

  return (
    <section className="border-t border-zinc-200 py-8">
      <div
        aria-label="Current round views"
        className="flex gap-1 border-b border-zinc-200"
        role="tablist"
      >
        <button
          aria-controls="current-round-lobbies"
          aria-selected={activeTab === "lobbies"}
          className={`border-b-2 px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${
            activeTab === "lobbies"
              ? "border-emerald-700 text-emerald-800"
              : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"
          }`}
          onClick={() => setActiveTab("lobbies")}
          id="current-round-lobbies-tab"
          role="tab"
          type="button"
        >
          Lobbies
        </button>
        <button
          aria-controls="current-round-scoresheet"
          aria-selected={activeTab === "scoresheet"}
          className={`border-b-2 px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${
            activeTab === "scoresheet"
              ? "border-emerald-700 text-emerald-800"
              : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"
          }`}
          onClick={() => setActiveTab("scoresheet")}
          id="current-round-scoresheet-tab"
          role="tab"
          type="button"
        >
          Scoresheet
        </button>
        <button
          aria-controls="current-round-graph"
          aria-selected={activeTab === "graph"}
          className={`border-b-2 px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${
            activeTab === "graph"
              ? "border-emerald-700 text-emerald-800"
              : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"
          }`}
          onClick={() => setActiveTab("graph")}
          id="current-round-graph-tab"
          role="tab"
          type="button"
        >
          Tournament graph
        </button>
        <button
          aria-controls="current-round-details"
          aria-selected={activeTab === "details"}
          className={`border-b-2 px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${
            activeTab === "details"
              ? "border-emerald-700 text-emerald-800"
              : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"
          }`}
          onClick={() => setActiveTab("details")}
          id="current-round-details-tab"
          role="tab"
          type="button"
        >
          Details &amp; players
        </button>
      </div>

      <div
        aria-labelledby="current-round-lobbies-tab"
        hidden={activeTab !== "lobbies"}
        id="current-round-lobbies"
        role="tabpanel"
        tabIndex={0}
      >
        {lobbies}
      </div>
      <div
        aria-labelledby="current-round-scoresheet-tab"
        hidden={activeTab !== "scoresheet"}
        id="current-round-scoresheet"
        role="tabpanel"
        tabIndex={0}
      >
        {scoresheet}
      </div>
      <div
        aria-labelledby="current-round-graph-tab"
        hidden={activeTab !== "graph"}
        id="current-round-graph"
        role="tabpanel"
        tabIndex={0}
      >
        {graph}
      </div>
      <div
        aria-labelledby="current-round-details-tab"
        hidden={activeTab !== "details"}
        id="current-round-details"
        role="tabpanel"
        tabIndex={0}
      >
        {details}
      </div>
    </section>
  );
}
