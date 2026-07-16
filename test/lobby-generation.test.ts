import assert from "node:assert/strict";
import test from "node:test";
import { generateLobbyAssignments } from "../lib/tournament/lobbies/api";

const players = Array.from({ length: 16 }, (_, index) => ({
  id: `player-${index + 1}`,
  seedNumber: index + 1,
}));

function playerIdsByLobby(
  assignments: ReturnType<typeof generateLobbyAssignments<(typeof players)[number]>>,
) {
  return assignments.reduce<Record<number, string[]>>((lobbies, assignment) => {
    lobbies[assignment.lobbyNumber] ??= [];
    lobbies[assignment.lobbyNumber].push(assignment.player.id);
    return lobbies;
  }, {});
}

test("snake seeding reverses direction for each row of lobbies", () => {
  const assignments = generateLobbyAssignments(players, "snake");

  assert.deepEqual(playerIdsByLobby(assignments), {
    1: [
      "player-1",
      "player-4",
      "player-5",
      "player-8",
      "player-9",
      "player-12",
      "player-13",
      "player-16",
    ],
    2: [
      "player-2",
      "player-3",
      "player-6",
      "player-7",
      "player-10",
      "player-11",
      "player-14",
      "player-15",
    ],
  });
});

test("random seeding shuffles players before balancing them across lobbies", () => {
  const assignments = generateLobbyAssignments(players, "random", 8, () => 0);

  assert.deepEqual(playerIdsByLobby(assignments), {
    1: [
      "player-2",
      "player-4",
      "player-6",
      "player-8",
      "player-10",
      "player-12",
      "player-14",
      "player-16",
    ],
    2: [
      "player-3",
      "player-5",
      "player-7",
      "player-9",
      "player-11",
      "player-13",
      "player-15",
      "player-1",
    ],
  });
});

test("lobby generation balances a partially filled field", () => {
  const assignments = generateLobbyAssignments(players.slice(0, 10), "snake");
  const lobbies = playerIdsByLobby(assignments);

  assert.equal(lobbies[1]?.length, 5);
  assert.equal(lobbies[2]?.length, 5);
  assert.equal(new Set(assignments.map(({ player }) => player.id)).size, 10);
});
