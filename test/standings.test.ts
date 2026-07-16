import assert from "node:assert/strict";
import test from "node:test";
import {
  rankReseedStandings,
  rankRoundStandings,
} from "../lib/tournament/standings/api";

const players = [
  {
    id: "player-3",
    displayName: "Charlie",
    roundEntrySeed: 3,
    tournamentPoints: 20,
    currentRoundPoints: 10,
    currentRoundFirsts: 0,
  },
  {
    id: "player-2",
    displayName: "Bravo",
    roundEntrySeed: 2,
    tournamentPoints: 20,
    currentRoundPoints: 10,
    currentRoundFirsts: 1,
  },
  {
    id: "player-1",
    displayName: "Alpha",
    roundEntrySeed: 1,
    tournamentPoints: 18,
    currentRoundPoints: 10,
    currentRoundFirsts: 1,
  },
];

test("round standings use points, firsts, seed, and deterministic fallbacks", () => {
  assert.deepEqual(
    rankRoundStandings(players).map((player) => player.id),
    ["player-1", "player-2", "player-3"],
  );
});

test("reseed standings use tournament totals before current-round firsts", () => {
  assert.deepEqual(
    rankReseedStandings(players).map((player) => player.id),
    ["player-2", "player-3", "player-1"],
  );
});
