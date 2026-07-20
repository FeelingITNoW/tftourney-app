import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { validatePlayerRegistration } from "../lib/tournament/players/api";
import {
  isValidTournamentName,
  isValidTournamentPlayerCount,
  validateTournamentCreation,
} from "../lib/tournament/validation/api";
import { selectTournamentEntrants } from "../lib/tournament/start/api";
import {
  getTournamentStartRequirement,
  selectOrderedTopNAdvancements,
  validateTournamentFormat,
} from "../lib/tournament/formats/api";

test("accepts tournament player counts that divide exactly into TFT lobbies", () => {
  for (const playerCount of [8, 16, 32, 64, 512]) {
    assert.equal(isValidTournamentPlayerCount(playerCount), true);
  }
});

test("rejects tournament player counts that are not exactly divisible by 8", () => {
  for (const playerCount of [1, 7, 9, 15, 31, 65, 513]) {
    assert.equal(isValidTournamentPlayerCount(playerCount), false);
  }
});

test("accepts valid TFT tournament names", () => {
  for (const name of [
    "Friday TFT Open",
    "Set 13 Championship",
    "TFT: Launch Cup",
    "APAC Masters - Week 1",
  ]) {
    assert.equal(isValidTournamentName(name), true);
  }
});

test("rejects invalid TFT tournament names", () => {
  for (const name of [
    "",
    "  ",
    "T",
    "-Starts With Punctuation",
    "TFT <script>",
    "A".repeat(81),
  ]) {
    assert.equal(isValidTournamentName(name), false);
  }
});

test("returns normalized tournament data when creation input is valid", () => {
  const result = validateTournamentCreation({
    name: "  Friday   TFT   Open  ",
    playerCount: "32",
  });

  assert.equal(result.success, true);

  if (result.success) {
    assert.deepEqual(result.data, {
      name: "Friday TFT Open",
      playerCount: 32,
      formatId: "default",
    });
  }
});

test("returns field errors when creation input is invalid", () => {
  const result = validateTournamentCreation({
    name: "TFT <script>",
    playerCount: "30",
  });

  assert.equal(result.success, false);
  assert.match(result.errors.name ?? "", /Use 3-80 characters/);
  assert.match(result.errors.playerCount ?? "", /divisible by 8/);
});

test("accepts valid Riot IDs for player registration", () => {
  const result = validatePlayerRegistration({
    gameTag: "  Player One # NA1  ",
  });

  assert.equal(result.success, true);

  if (result.success) {
    assert.deepEqual(result.data, {
      gameName: "Player One",
      tagLine: "NA1",
      gameTag: "Player One#NA1",
    });
  }
});

test("rejects invalid Riot IDs for player registration", () => {
  for (const gameTag of ["", "Player", "#TAG", "Player#", "Player#bad tag"]) {
    const result = validatePlayerRegistration({ gameTag });

    assert.equal(result.success, false);
    assert.match(result.errors.gameTag ?? "", /GameName#TAG/);
  }
});

test("default tournament format specifies fixed-game opening and checkmate final rounds", () => {
  const format = JSON.parse(
    readFileSync(
      join(process.cwd(), "lib/tournament/formats/default.json"),
      "utf8",
    ),
  );

  assert.equal(format.isDefault, true);
  assert.deepEqual(format.placementPoints, {
    "1": 8,
    "2": 7,
    "3": 6,
    "4": 5,
    "5": 4,
    "6": 3,
    "7": 2,
    "8": 1,
  });
  assert.equal(format.rounds.length, 2);

  const [openingRound, finalRound] = format.rounds;
  assert.equal(openingRound.lobbySeeding, "snake");
  assert.equal(openingRound.games, 6);
  assert.equal(openingRound.reseed, 2);
  assert.deepEqual(openingRound.standings.tieBreakers, [
    { rankingMetric: "current_round_firsts", sortDirection: "desc" },
    { rankingMetric: "round_entry_seed", sortDirection: "asc" },
  ]);
  assert.equal(openingRound.reseedStandings.rankingMetric, "tournament_points");
  assert.deepEqual(openingRound.advancement, {
    type: "top_n",
    count: 8,
    rankingMetric: "points",
    destinationRoundId: "final-round",
  });

  assert.equal(finalRound.lobbySeeding, "random");
  assert.equal(finalRound.games, undefined);
  assert.equal(finalRound.reseed, 0);
  assert.deepEqual(finalRound.winCondition, {
    type: "checkmate",
    threshold: 18,
    rankingMetric: "points",
  });
});

test("three-round 128-player format advances 128 to 64 to an eight-player checkmate final", () => {
  const format = JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        "lib/tournament/formats/three-round-128.json",
      ),
      "utf8",
    ),
  );

  const validation = validateTournamentFormat(format);
  assert.equal(validation.success, true, validation.errors.join(" "));
  assert.equal(format.rounds.length, 3);
  assert.equal(format.rounds[0].games, 6);
  assert.equal(format.rounds[0].advancement.count, 64);
  assert.equal(format.rounds[0].advancement.destinationRoundId, "second-round");
  assert.equal(format.rounds[1].games, 6);
  assert.equal(format.rounds[1].advancement.count, 8);
  assert.equal(format.rounds[1].advancement.destinationRoundId, "final-round");
  assert.equal(format.rounds[2].winCondition.type, "checkmate");
});

test("validates game blocks, reseed bounds, destinations, and tie-breakers", () => {
  const format = JSON.parse(
    readFileSync(
      join(process.cwd(), "lib/tournament/formats/default.json"),
      "utf8",
    ),
  );
  const valid = validateTournamentFormat(format);
  assert.equal(valid.success, true);

  format.rounds[0].reseed = format.rounds[0].games + 1;
  const invalid = validateTournamentFormat(format);
  assert.equal(invalid.success, false);
  assert.match(invalid.errors.join(" "), /reseed must be between 0 and games/);
});

test("requires eight entrants when a format includes checkmate", () => {
  assert.deepEqual(
    getTournamentStartRequirement({
      rounds: [
        { winCondition: { type: "highest_points_after_games" } },
        { winCondition: { type: "checkmate" } },
      ],
    }),
    { minimumEntrants: 8, exactEntrants: null },
  );

  assert.deepEqual(
    getTournamentStartRequirement({
      rounds: [{ winCondition: { type: "checkmate" } }],
    }),
    { minimumEntrants: 8, exactEntrants: 8 },
  );
});

test("rejects non-final checkmate rounds without an eight-player destination", () => {
  const format = JSON.parse(
    readFileSync(
      join(process.cwd(), "lib/tournament/formats/default.json"),
      "utf8",
    ),
  );
  format.rounds[0].games = undefined;
  format.rounds[0].reseed = 0;
  format.rounds[0].winCondition = {
    type: "checkmate",
    threshold: 18,
    rankingMetric: "points",
  };

  const result = validateTournamentFormat(format);

  assert.equal(result.success, false);
  assert.match(result.errors.join(" "), /requires an eight-player round or final round/);
});

test("selects the earliest registered players when starting a tournament", () => {
  const entrants = selectTournamentEntrants(
    [
      {
        id: "player-3",
        displayName: "Third",
        createdAt: "2026-07-14T10:03:00.000Z",
      },
      {
        id: "player-1",
        displayName: "First",
        createdAt: "2026-07-14T10:01:00.000Z",
      },
      {
        id: "player-2",
        displayName: "Second",
        createdAt: "2026-07-14T10:02:00.000Z",
      },
    ],
    2,
  );

  assert.deepEqual(
    entrants.map((entrant) => ({
      id: entrant.id,
      seedNumber: entrant.seedNumber,
    })),
    [
      { id: "player-1", seedNumber: 1 },
      { id: "player-2", seedNumber: 2 },
    ],
  );
});

test("allows a tournament to start with fewer entrants than the player limit", () => {
  const entrants = selectTournamentEntrants(
    [
      {
        id: "player-1",
        displayName: "First",
        createdAt: "2026-07-14T10:01:00.000Z",
      },
      {
        id: "player-2",
        displayName: "Second",
        createdAt: "2026-07-14T10:02:00.000Z",
      },
    ],
    16,
  );

  assert.equal(entrants.length, 2);
  assert.deepEqual(
    entrants.map((entrant) => entrant.seedNumber),
    [1, 2],
  );
});

test("routes ordered exclusive top-N edges and eliminates the remainder", () => {
  const players = Array.from({ length: 64 }, (_, index) => ({ id: `player-${index + 1}` }));
  const result = selectOrderedTopNAdvancements(players, [
    {
      id: "to-final",
      sourceNodeId: "a",
      destinationNodeId: "c",
      priority: 1,
      condition: { type: "top_n", count: 4, rankingMetric: "points" },
    },
    {
      id: "to-lower",
      sourceNodeId: "a",
      destinationNodeId: "b",
      priority: 2,
      condition: { type: "top_n", count: 56, rankingMetric: "points" },
    },
  ]);

  assert.deepEqual(result.advancements[0]?.participantIds, ["player-1", "player-2", "player-3", "player-4"]);
  assert.equal(result.advancements[1]?.participantIds.length, 56);
  assert.deepEqual(result.eliminatedParticipantIds, ["player-61", "player-62", "player-63", "player-64"]);
});

test("rejects graph cycles and duplicate edge priorities", () => {
  const format = {
    schemaVersion: 2,
    id: "graph",
    name: "Graph",
    placementPoints: { "1": 8 },
    startRequirement: { minimumEntrants: 8, exactEntrants: 8 },
    nodes: [
      { id: "a", name: "A", initialEntrantSlots: "all", mergeSeeding: "random", lobbySeeding: "snake", games: 1, reseed: 0, standings: { rankingMetric: "points", sortDirection: "desc", tieBreakers: [] }, reseedStandings: { rankingMetric: "points", sortDirection: "desc", tieBreakers: [] } },
      { id: "b", name: "B", mergeSeeding: "random", lobbySeeding: "snake", games: 1, reseed: 0, standings: { rankingMetric: "points", sortDirection: "desc", tieBreakers: [] }, reseedStandings: { rankingMetric: "points", sortDirection: "desc", tieBreakers: [] } },
    ],
    edges: [
      { id: "a-b", sourceNodeId: "a", destinationNodeId: "b", priority: 1, condition: { type: "top_n", count: 4, rankingMetric: "points" } },
      { id: "b-a", sourceNodeId: "b", destinationNodeId: "a", priority: 1, condition: { type: "top_n", count: 4, rankingMetric: "points" } },
    ],
  };
  const result = validateTournamentFormat(format);
  assert.equal(result.success, false);
  assert.match(result.errors.join(" "), /acyclic/);
});

test("accepts the 64-player A/B/C split graph", () => {
  const format = JSON.parse(readFileSync(join(process.cwd(), "lib/tournament/formats/64-three-node.json"), "utf8"));
  const result = validateTournamentFormat(format);
  assert.equal(result.success, true, result.errors.join(" "));
  assert.equal(format.edges[0].condition.count, 4);
  assert.equal(format.edges[1].condition.count, 56);
});
