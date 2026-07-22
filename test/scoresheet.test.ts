import assert from "node:assert/strict";
import test from "node:test";
import type {
  TournamentGameScore,
  TournamentRound,
  TournamentScore,
} from "../lib/db/tournaments/types";
import { buildScoresheetTabs } from "../lib/tournament/scoring/scoresheet";

const rounds: TournamentRound[] = [
  { id: "round-1", roundNumber: 1 },
  { id: "round-2", isCheckmate: true, roundNumber: 2 },
];

function score(
  participantId: string,
  displayName: string,
  roundId: string,
  value: number,
  seedNumber: number,
): TournamentScore {
  return {
    id: `${participantId}-${roundId}`,
    participantId,
    displayName,
    seedNumber,
    roundSeedNumber: seedNumber,
    roundId,
    score: value,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function gameScore(
  participantId: string,
  displayName: string,
  roundId: string,
  gameNumber: number,
  value: number | null,
  seedNumber: number,
): TournamentGameScore {
  return {
    participantId,
    displayName,
    seedNumber,
    roundId,
    gameNumber,
    placement: value === null ? null : 1,
    score: value,
  };
}

test("builds cumulative scoresheet tabs from played games only", () => {
  const scores = [
    score("player-1", "Alpha", "round-1", 10, 1),
    score("player-1", "Alpha", "round-2", 20, 1),
    score("player-2", "Bravo", "round-1", 20, 2),
    score("player-2", "Bravo", "round-2", 0, 2),
    score("player-3", "Charlie", "round-1", 15, 3),
  ];
  const gameScores = [
    gameScore("player-1", "Alpha", "round-1", 1, 10, 1),
    gameScore("player-2", "Bravo", "round-1", 1, 20, 2),
    gameScore("player-3", "Charlie", "round-1", 1, null, 3),
    gameScore("player-1", "Alpha", "round-1", 2, 0, 1),
    gameScore("player-2", "Bravo", "round-1", 2, 0, 2),
    gameScore("player-3", "Charlie", "round-1", 2, null, 3),
    gameScore("player-1", "Alpha", "round-2", 1, 20, 1),
    gameScore("player-2", "Bravo", "round-2", 1, null, 2),
    gameScore("player-1", "Alpha", "round-2", 2, null, 1),
    gameScore("player-2", "Bravo", "round-2", 2, null, 2),
  ];

  const tabs = buildScoresheetTabs(rounds, scores, gameScores);
  const overall = tabs[0];
  const roundTwo = tabs.find((tab) => tab.id === "round-2");

  assert.deepEqual(
    overall.columns.map((column) => column.label),
    ["R1 G1", "R1 G2", "R2 G1"],
  );
  assert.deepEqual(
    overall.scores.map((row) => [row.rank, row.displayName, row.score]),
    [
      [1, "Alpha", 30],
      [2, "Bravo", 20],
      [3, "Charlie", 15],
    ],
  );
  assert.deepEqual(
    overall.scores.map((row) => [
      row.breakdown["round-1:1"],
      row.breakdown["round-1:2"],
      row.breakdown["round-2:1"],
    ]),
    [
      [10, 0, 20],
      [20, 0, null],
      [null, null, undefined],
    ],
  );

  assert.deepEqual(
    roundTwo?.scores.map((row) => [row.rank, row.displayName, row.score]),
    [
      [1, "Alpha", 30],
      [2, "Bravo", 20],
    ],
  );
  assert.equal(roundTwo?.columns.length, 1);
  assert.equal(roundTwo?.isCheckmate, true);
  assert.deepEqual(
    roundTwo?.scores.map((row) => row.roundScore),
    [20, 0],
  );
  assert.equal(roundTwo?.scores[1]?.breakdown["round-2:1"], null);
});
