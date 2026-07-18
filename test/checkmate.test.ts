import assert from "node:assert/strict";
import test from "node:test";
import { resolveCheckmateOutcome } from "../lib/tournament/checkmate/api";

const players = [
  { id: "alpha", displayName: "Alpha", roundEntrySeed: 1 },
  { id: "bravo", displayName: "Bravo", roundEntrySeed: 2 },
  { id: "charlie", displayName: "Charlie", roundEntrySeed: 3 },
  { id: "delta", displayName: "Delta", roundEntrySeed: 4 },
  { id: "echo", displayName: "Echo", roundEntrySeed: 5 },
  { id: "foxtrot", displayName: "Foxtrot", roundEntrySeed: 6 },
  { id: "golf", displayName: "Golf", roundEntrySeed: 7 },
  { id: "hotel", displayName: "Hotel", roundEntrySeed: 8 },
];

function game(gameNumber: number, winner: string, winnerPoints = 8) {
  let nextPlacement = 2;
  return players.map((player) => ({
    participantId: player.id,
    gameNumber,
    placement: player.id === winner ? 1 : nextPlacement++,
    points: player.id === winner ? winnerPoints : 1,
  }));
}

test("requires points strictly above the threshold before first place", () => {
  const results = [
    ...game(1, "alpha"),
    ...game(2, "alpha"),
    ...game(3, "alpha"),
  ];
  const outcome = resolveCheckmateOutcome(players, results, {
    type: "checkmate",
    threshold: 18,
    rankingMetric: "points",
  });

  assert.equal(outcome.winnerId, null);
  assert.equal(outcome.isComplete, false);
});

test("stops at the first eligible win and puts the winner first", () => {
  const results = [
    ...game(1, "alpha", 8),
    ...game(2, "bravo", 8),
    ...game(3, "alpha", 8),
  ];
  const outcome = resolveCheckmateOutcome(players, results, {
    type: "checkmate",
    threshold: 8,
    rankingMetric: "points",
  });

  assert.equal(outcome.winnerId, "alpha");
  assert.equal(outcome.decisiveGame, 3);
  assert.deepEqual(outcome.standings.map((player) => player.id).slice(0, 2), ["alpha", "bravo"]);
});

test("uses maxGames as a points-ranking fallback", () => {
  const outcome = resolveCheckmateOutcome(
    players,
    [...game(1, "alpha"), ...game(2, "bravo")],
    { type: "checkmate", threshold: 100, rankingMetric: "points", maxGames: 2 },
  );

  assert.equal(outcome.winnerId, null);
  assert.equal(outcome.isComplete, true);
  assert.equal(outcome.completedGames, 2);
});
