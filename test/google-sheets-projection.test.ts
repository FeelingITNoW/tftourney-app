import assert from "node:assert/strict";
import test from "node:test";
import type { TournamentDetail } from "../lib/db/tournaments/types";
import { buildTournamentWorkbook } from "../lib/sheets/projection";

const detail = {
  id: "tournament-1",
  name: "Summer Open",
  formatId: "default",
  formatConfig: {
    nodes: [
      { id: "opening", games: 2 },
      { id: "final", winCondition: { type: "checkmate", threshold: 18, rankingMetric: "points", maxGames: 3 } },
    ],
  },
  status: "in_progress",
  playerCount: 2,
  hasStarted: true,
  currentRoundId: "round-1",
  currentRoundNumber: 1,
  activeNodeIds: ["round-1"],
  createdAt: "2026-07-01T00:00:00.000Z",
  registrations: [
    { id: "registration-1", displayName: "Alpha", registrationStatus: "entered", createdAt: "2026-07-01T00:00:00.000Z" },
    { id: "registration-2", displayName: "Bravo", registrationStatus: "entered", createdAt: "2026-07-01T00:00:00.000Z" },
  ],
  participants: [
    { id: "player-1", registrationId: "registration-1", displayName: "Alpha", seedNumber: 1, createdAt: "2026-07-01T00:00:00.000Z" },
    { id: "player-2", registrationId: "registration-2", displayName: "Bravo", seedNumber: 2, createdAt: "2026-07-01T00:00:00.000Z" },
  ],
  rounds: [
    { id: "round-1", roundNumber: 1, formatNodeId: "opening", name: "Opening", status: "completed", configuredGames: 2, isCheckmate: false },
    { id: "round-2", roundNumber: 2, formatNodeId: "final", name: "Final", status: "active", configuredGames: null, isCheckmate: true },
  ],
  scores: [
    { id: "score-1", participantId: "player-1", displayName: "Alpha", seedNumber: 1, roundSeedNumber: 1, roundId: "round-1", score: 20, createdAt: "2026-07-01T00:00:00.000Z" },
    { id: "score-2", participantId: "player-2", displayName: "Bravo", seedNumber: 2, roundSeedNumber: 2, roundId: "round-1", score: 10, createdAt: "2026-07-01T00:00:00.000Z" },
    { id: "score-3", participantId: "player-1", displayName: "Alpha", seedNumber: 1, roundSeedNumber: 1, roundId: "round-2", score: 0, sourceEdgeId: "edge-1", sourceRank: 1, createdAt: "2026-07-01T00:00:00.000Z" },
  ],
  gameScores: [
    { participantId: "player-1", displayName: "Alpha", seedNumber: 1, roundId: "round-1", gameNumber: 1, placement: 1, score: 8 },
    { participantId: "player-2", displayName: "Bravo", seedNumber: 2, roundId: "round-1", gameNumber: 1, placement: 2, score: 7 },
    { participantId: "player-1", displayName: "Alpha", seedNumber: 1, roundId: "round-1", gameNumber: 2, placement: 1, score: 8 },
    { participantId: "player-2", displayName: "Bravo", seedNumber: 2, roundId: "round-1", gameNumber: 2, placement: 2, score: 3 },
    { participantId: "player-1", displayName: "Alpha", seedNumber: 1, roundId: "round-2", gameNumber: 1, placement: 1, score: 19 },
    { participantId: "player-1", displayName: "Alpha", seedNumber: 1, roundId: "round-2", gameNumber: 2, placement: 1, score: 8 },
  ],
  lobbies: [],
  roundProgress: null,
  progressionAction: null,
  nodes: [],
  edges: [],
  selectedNodeId: "round-1",
  startRequirement: { minimumEntrants: 2 },
} as unknown as TournamentDetail;

test("projects roster, future standard games, advancement, and checkmate into three tabs", () => {
  const workbook = buildTournamentWorkbook(detail, "2026-07-22T12:00:00.000Z");

  assert.deepEqual(workbook.tabs.map((tab) => tab.title), ["Players", "Scores", "Checkmate"]);
  assert.deepEqual(workbook.tabs[0].rows[3]?.map((cell) => cell.value), ["Seed", "Player", "Registration Status"]);

  const scores = workbook.tabs[1].rows;
  assert.deepEqual(scores[3]?.map((cell) => cell.value), ["Rank", "Player", "Total", "Opening G1", "Opening G2", "Status"]);
  assert.equal(scores[4]?.[1]?.value, "Alpha");
  assert.equal(scores[4]?.[5]?.value, "Playing Final");
  assert.equal(scores[5]?.[4]?.value, 3);

  const checkmate = workbook.tabs[2].rows;
  assert.ok(checkmate.some((row) => row[0]?.value === "Check = more than 18 points before a game"));
  assert.ok(checkmate.some((row) => row[row.length - 1]?.value === "WINNER"));

  const pendingWorkbook = buildTournamentWorkbook(
    { ...detail, gameScores: detail.gameScores.filter((score) => score.roundId !== "round-2") },
    "2026-07-22T12:00:00.000Z",
  );
  assert.equal(pendingWorkbook.tabs[1].rows[4]?.[5]?.value, "Advanced to Final");
});
