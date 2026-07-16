"use client";

import { useState } from "react";
import type {
<<<<<<< HEAD
<<<<<<< HEAD
  TournamentGameScore,
  TournamentRound,
  TournamentScore,
} from "@/lib/db/tournaments/types";
import {
  aggregateParticipantScores,
  sortScoresHighestFirst,
} from "@/lib/tournament/scoring/api";
import type { ParticipantScoreStanding } from "@/lib/tournament/scoring/types";

type ScoresheetProps = {
  gameScores: TournamentGameScore[];
  rounds: TournamentRound[];
  scores: TournamentScore[];
};

type ScoresheetColumn = {
  id: string;
  label: string;
};

type ScoresheetRow = ParticipantScoreStanding & {
  breakdown: Record<string, number | null>;
};

type ScoresheetTab = {
  columns: ScoresheetColumn[];
  emptyCellLabel: string;
  id: string;
  label: string;
  scores: ScoresheetRow[];
};

const OVERALL_TAB_ID = "overall";

function buildOverallTab(
  rounds: TournamentRound[],
  scores: TournamentScore[],
): ScoresheetTab {
  const scoreByParticipantAndRound = new Map(
    scores.map((score) => [
      `${score.participantId}:${score.roundId}`,
      score.score,
    ]),
  );

  return {
    columns: rounds.map((round) => ({
      id: round.id,
      label: `Round ${round.roundNumber}`,
    })),
    emptyCellLabel: "—",
    id: OVERALL_TAB_ID,
    label: "Overall",
    scores: aggregateParticipantScores(scores).map((score) => ({
      ...score,
      breakdown: Object.fromEntries(
        rounds.map((round) => [
          round.id,
          scoreByParticipantAndRound.get(
            `${score.participantId}:${round.id}`,
          ) ?? null,
        ]),
      ),
    })),
  };
}

function buildRoundTab(
  round: TournamentRound,
  scores: TournamentScore[],
  gameScores: TournamentGameScore[],
): ScoresheetTab {
  const roundGameScores = gameScores.filter(
    (score) => score.roundId === round.id,
  );
  const gameNumbers = [
    ...new Set(roundGameScores.map((score) => score.gameNumber)),
  ].sort((firstGame, secondGame) => firstGame - secondGame);
  const scoreByParticipantAndGame = new Map(
    roundGameScores.map((score) => [
      `${score.participantId}:${score.gameNumber}`,
      score.score,
    ]),
  );

  return {
    columns: gameNumbers.map((gameNumber) => ({
      id: String(gameNumber),
      label: `Game ${gameNumber}`,
    })),
    emptyCellLabel: "Pending",
    id: round.id,
    label: `Round ${round.roundNumber}`,
    scores: sortScoresHighestFirst(
      scores.filter((score) => score.roundId === round.id),
    ).map((score) => ({
      ...score,
      breakdown: Object.fromEntries(
        gameNumbers.map((gameNumber) => [
          String(gameNumber),
          scoreByParticipantAndGame.get(
            `${score.participantId}:${gameNumber}`,
          ) ?? null,
        ]),
      ),
    })),
  };
}

function buildScoresheetTabs(
  rounds: TournamentRound[],
  scores: TournamentScore[],
  gameScores: TournamentGameScore[],
): ScoresheetTab[] {
  return [
    buildOverallTab(rounds, scores),
    ...rounds.map((round) => buildRoundTab(round, scores, gameScores)),
  ];
}

export function Scoresheet({ gameScores, rounds, scores }: ScoresheetProps) {
  const [tabs] = useState(() =>
    buildScoresheetTabs(rounds, scores, gameScores),
  );
  const [activeTabId, setActiveTabId] = useState(OVERALL_TAB_ID);
  const activeTab =
    tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  if (!activeTab) {
    return null;
=======
=======
>>>>>>> 60dbee6 (Added multiple games per round support)
  TournamentLobby,
  TournamentScore,
} from "@/lib/db/tournaments/types";
import { sortScoresHighestFirst } from "@/lib/tournament/scoring/api";

type ScoresheetProps = {
  lobbies: TournamentLobby[];
  roundLabel: string;
  scores: TournamentScore[];
};

export function Scoresheet({ lobbies, roundLabel, scores }: ScoresheetProps) {
  const [sortedScores] = useState(() => sortScoresHighestFirst(scores));
  const gameNumbers = [...new Set(lobbies.map((lobby) => lobby.gameNumber))].sort(
    (firstGame, secondGame) => firstGame - secondGame,
  );
  const pointsByGame = new Map<number, Map<string, number | null>>();

  for (const lobby of lobbies) {
    const gamePoints = pointsByGame.get(lobby.gameNumber) ?? new Map();

    for (const participant of lobby.participants) {
      gamePoints.set(participant.id, participant.points);
    }

    pointsByGame.set(lobby.gameNumber, gamePoints);
<<<<<<< HEAD
>>>>>>> 67350be (Added multi-round support)
=======
=======
  TournamentGameScore,
  TournamentRound,
  TournamentScore,
} from "@/lib/db/tournaments/types";
import {
  aggregateParticipantScores,
  sortScoresHighestFirst,
} from "@/lib/tournament/scoring/api";
import type { ParticipantScoreStanding } from "@/lib/tournament/scoring/types";

type ScoresheetProps = {
  gameScores: TournamentGameScore[];
  rounds: TournamentRound[];
  scores: TournamentScore[];
};

type ScoresheetColumn = {
  id: string;
  label: string;
};

type ScoresheetRow = ParticipantScoreStanding & {
  breakdown: Record<string, number | null>;
};

type ScoresheetTab = {
  columns: ScoresheetColumn[];
  emptyCellLabel: string;
  id: string;
  label: string;
  scores: ScoresheetRow[];
};

const OVERALL_TAB_ID = "overall";

function buildOverallTab(
  rounds: TournamentRound[],
  scores: TournamentScore[],
): ScoresheetTab {
  const scoreByParticipantAndRound = new Map(
    scores.map((score) => [
      `${score.participantId}:${score.roundId}`,
      score.score,
    ]),
  );

  return {
    columns: rounds.map((round) => ({
      id: round.id,
      label: `Round ${round.roundNumber}`,
    })),
    emptyCellLabel: "—",
    id: OVERALL_TAB_ID,
    label: "Overall",
    scores: aggregateParticipantScores(scores).map((score) => ({
      ...score,
      breakdown: Object.fromEntries(
        rounds.map((round) => [
          round.id,
          scoreByParticipantAndRound.get(
            `${score.participantId}:${round.id}`,
          ) ?? null,
        ]),
      ),
    })),
  };
}

function buildRoundTab(
  round: TournamentRound,
  scores: TournamentScore[],
  gameScores: TournamentGameScore[],
): ScoresheetTab {
  const roundGameScores = gameScores.filter(
    (score) => score.roundId === round.id,
  );
  const gameNumbers = [
    ...new Set(roundGameScores.map((score) => score.gameNumber)),
  ].sort((firstGame, secondGame) => firstGame - secondGame);
  const scoreByParticipantAndGame = new Map(
    roundGameScores.map((score) => [
      `${score.participantId}:${score.gameNumber}`,
      score.score,
    ]),
  );

  return {
    columns: gameNumbers.map((gameNumber) => ({
      id: String(gameNumber),
      label: `Game ${gameNumber}`,
    })),
    emptyCellLabel: "Pending",
    id: round.id,
    label: `Round ${round.roundNumber}`,
    scores: sortScoresHighestFirst(
      scores.filter((score) => score.roundId === round.id),
    ).map((score) => ({
      ...score,
      breakdown: Object.fromEntries(
        gameNumbers.map((gameNumber) => [
          String(gameNumber),
          scoreByParticipantAndGame.get(
            `${score.participantId}:${gameNumber}`,
          ) ?? null,
        ]),
      ),
    })),
  };
}

function buildScoresheetTabs(
  rounds: TournamentRound[],
  scores: TournamentScore[],
  gameScores: TournamentGameScore[],
): ScoresheetTab[] {
  return [
    buildOverallTab(rounds, scores),
    ...rounds.map((round) => buildRoundTab(round, scores, gameScores)),
  ];
}

export function Scoresheet({ gameScores, rounds, scores }: ScoresheetProps) {
  const [tabs] = useState(() =>
    buildScoresheetTabs(rounds, scores, gameScores),
  );
  const [activeTabId, setActiveTabId] = useState(OVERALL_TAB_ID);
  const activeTab =
    tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  if (!activeTab) {
    return null;
<<<<<<< HEAD
>>>>>>> ca21f53 (Added multiple games per round support)
=======
=======
  TournamentLobby,
  TournamentScore,
} from "@/lib/db/tournaments/types";
import { sortScoresHighestFirst } from "@/lib/tournament/scoring/api";

type ScoresheetProps = {
  lobbies: TournamentLobby[];
  roundLabel: string;
  scores: TournamentScore[];
};

export function Scoresheet({ lobbies, roundLabel, scores }: ScoresheetProps) {
  const [sortedScores] = useState(() => sortScoresHighestFirst(scores));
  const gameNumbers = [...new Set(lobbies.map((lobby) => lobby.gameNumber))].sort(
    (firstGame, secondGame) => firstGame - secondGame,
  );
  const pointsByGame = new Map<number, Map<string, number | null>>();

  for (const lobby of lobbies) {
    const gamePoints = pointsByGame.get(lobby.gameNumber) ?? new Map();

    for (const participant of lobby.participants) {
      gamePoints.set(participant.id, participant.points);
    }

    pointsByGame.set(lobby.gameNumber, gamePoints);
>>>>>>> 67350be (Added multi-round support)
>>>>>>> 1300bff (Added multi-round support)
>>>>>>> 60dbee6 (Added multiple games per round support)
  }

  return (
    <section className="py-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-950">Scoresheet</h2>
          <p className="mt-1 text-sm text-zinc-500">
<<<<<<< HEAD
<<<<<<< HEAD
            {activeTab.id === OVERALL_TAB_ID
              ? "Combined standings across every round"
              : `${activeTab.label} game-by-game standings`}
            , ranked from highest to lowest points.
=======
            Official entrants and points by game for {roundLabel}, ranked by
            total points.
>>>>>>> 67350be (Added multi-round support)
=======
            Official entrants and points by game for {roundLabel}, ranked by
            total points.
=======
=======
>>>>>>> 1300bff (Added multi-round support)
            {activeTab.id === OVERALL_TAB_ID
              ? "Combined standings across every round"
              : `${activeTab.label} game-by-game standings`}
            , ranked from highest to lowest points.
<<<<<<< HEAD
>>>>>>> ca21f53 (Added multiple games per round support)
=======
=======
            Official entrants and points by game for {roundLabel}, ranked by
            total points.
>>>>>>> 67350be (Added multi-round support)
>>>>>>> 1300bff (Added multi-round support)
>>>>>>> 60dbee6 (Added multiple games per round support)
          </p>
        </div>
      </div>

<<<<<<< HEAD
<<<<<<< HEAD
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
              {tab.label}
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
          <div className="mt-5 overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-max border-collapse text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="min-w-52 px-4 py-3 font-medium">Player</th>
                  {activeTab.columns.map((column) => (
                    <th
                      className="min-w-28 px-4 py-3 text-right font-medium"
                      key={column.id}
                    >
                      {column.label}
                    </th>
                  ))}
                  <th
                    aria-sort="descending"
                    className="min-w-24 px-4 py-3 text-right font-medium"
                  >
                    Total
                  </th>
=======
=======
>>>>>>> 60dbee6 (Added multiple games per round support)
      {sortedScores.length === 0 ? (
        <div className="mt-5 rounded-md border border-zinc-200 bg-white p-5 text-sm text-zinc-500">
          No score rows were created for this tournament.
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="w-20 px-4 py-3 font-medium">Round seed</th>
                <th className="px-4 py-3 font-medium">Player</th>
                {gameNumbers.map((gameNumber) => (
                  <th className="w-24 px-4 py-3 text-right font-medium" key={gameNumber}>
                    Game {gameNumber}
                  </th>
                ))}
                <th
                  aria-sort="descending"
                  className="w-24 border-l border-zinc-200 px-4 py-3 text-right font-medium"
                >
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {sortedScores.map((score) => (
                <tr key={score.id}>
                  <td className="px-4 py-3 text-zinc-500">
                    {score.roundSeedNumber}
                  </td>
                  <td className="px-4 py-3 font-medium text-zinc-950">
                    {score.displayName}
                  </td>
                  {gameNumbers.map((gameNumber) => {
                    const points = pointsByGame
                      .get(gameNumber)
                      ?.get(score.participantId);

                    return (
                      <td
                        className="px-4 py-3 text-right font-medium text-zinc-700"
                        key={gameNumber}
                      >
                        {points ?? "—"}
                      </td>
                    );
                  })}
                  <td className="border-l border-zinc-200 px-4 py-3 text-right font-semibold text-zinc-950">
                    {score.score}
                  </td>
<<<<<<< HEAD
>>>>>>> 67350be (Added multi-round support)
=======
=======
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
              {tab.label}
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
          <div className="mt-5 overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-max border-collapse text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="min-w-52 px-4 py-3 font-medium">Player</th>
                  {activeTab.columns.map((column) => (
                    <th
                      className="min-w-28 px-4 py-3 text-right font-medium"
                      key={column.id}
                    >
                      {column.label}
                    </th>
                  ))}
                  <th
                    aria-sort="descending"
                    className="min-w-24 px-4 py-3 text-right font-medium"
                  >
                    Total
                  </th>
<<<<<<< HEAD
>>>>>>> ca21f53 (Added multiple games per round support)
>>>>>>> 60dbee6 (Added multiple games per round support)
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {activeTab.scores.map((score) => (
                  <tr key={score.participantId}>
                    <td className="px-4 py-3 font-medium text-zinc-950">
                      {score.displayName}
                    </td>
                    {activeTab.columns.map((column) => (
                      <td
                        className="px-4 py-3 text-right text-zinc-600"
                        key={column.id}
                      >
                        {score.breakdown[column.id] ?? activeTab.emptyCellLabel}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-semibold text-zinc-950">
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
