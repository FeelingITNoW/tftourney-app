import assert from "node:assert/strict";
import test from "node:test";
import {
  sortScoresHighestFirst,
  validateLobbyResults,
} from "../lib/tournament/scoring/api";

const validResults = [
  { participantId: "player-1", placement: "1" },
  { participantId: "player-2", placement: "2" },
  { participantId: "player-3", placement: "3" },
];

test("accepts complete lobby results with unique placements", () => {
  assert.deepEqual(validateLobbyResults(validResults), {
    success: true,
    data: [
      { participantId: "player-1", placement: 1 },
      { participantId: "player-2", placement: 2 },
      { participantId: "player-3", placement: 3 },
    ],
  });
});

test("rejects duplicate placements", () => {
  const validation = validateLobbyResults([
    validResults[0],
    { ...validResults[1], placement: "1" },
    validResults[2],
  ]);

  assert.deepEqual(validation, {
    success: false,
    error: "Each player must have a unique placement.",
  });
});

test("rejects invalid placements", () => {
  for (const placement of ["-1", "1.5", "4"]) {
    const validation = validateLobbyResults([
      { ...validResults[0], placement },
      validResults[1],
      validResults[2],
    ]);

    assert.equal(validation.success, false);
  }
});

test("rejects duplicate lobby players", () => {
  const validation = validateLobbyResults([
    validResults[0],
    { ...validResults[1], participantId: "player-1" },
    validResults[2],
  ]);

  assert.deepEqual(validation, {
    success: false,
    error: "Each lobby player must appear exactly once.",
  });
});

test("sorts scores from highest to lowest with stable tournament tie-breakers", () => {
  const scores = [
    { displayName: "Third", score: 4, seedNumber: 3 },
    { displayName: "Second", score: 10, seedNumber: 2 },
    { displayName: "First", score: 10, seedNumber: 1 },
  ];

  assert.deepEqual(sortScoresHighestFirst(scores), [
    { displayName: "First", score: 10, seedNumber: 1 },
    { displayName: "Second", score: 10, seedNumber: 2 },
    { displayName: "Third", score: 4, seedNumber: 3 },
  ]);
  assert.equal(scores[0]?.displayName, "Third");
});
