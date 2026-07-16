"use client";

import { useState } from "react";
import type { TournamentScore } from "@/lib/db/tournaments/types";
import { sortScoresHighestFirst } from "@/lib/tournament/scoring/api";

type ScoresheetProps = {
  roundLabel: string;
  scores: TournamentScore[];
};

export function Scoresheet({ roundLabel, scores }: ScoresheetProps) {
  const [sortedScores] = useState(() => sortScoresHighestFirst(scores));

  return (
    <section className="border-t border-zinc-200 py-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-950">Scoresheet</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Official entrants and current scores for {roundLabel}, ranked from
            highest to lowest points.
          </p>
        </div>
      </div>

      {sortedScores.length === 0 ? (
        <div className="mt-5 rounded-md border border-zinc-200 bg-white p-5 text-sm text-zinc-500">
          No score rows were created for this tournament.
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="w-20 px-4 py-3 font-medium">Seed</th>
                <th className="px-4 py-3 font-medium">Player</th>
                <th className="px-4 py-3 font-medium">Round</th>
                <th
                  aria-sort="descending"
                  className="w-24 px-4 py-3 text-right font-medium"
                >
                  Score
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {sortedScores.map((score) => (
                <tr key={score.id}>
                  <td className="px-4 py-3 text-zinc-500">
                    {score.seedNumber}
                  </td>
                  <td className="px-4 py-3 font-medium text-zinc-950">
                    {score.displayName}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{roundLabel}</td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-950">
                    {score.score}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
