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
import { validateTournamentFormat } from "../lib/tournament/formats/api";

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

test("default tournament format specifies two games for every round", () => {
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
<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
  assert.equal(openingRound.games, 2);
=======
=======
>>>>>>> 60dbee6 (Added multiple games per round support)
  assert.equal(openingRound.games, 6);
  assert.equal(openingRound.reseed, 2);
  assert.deepEqual(openingRound.standings.tieBreakers, [
    { rankingMetric: "current_round_firsts", sortDirection: "desc" },
    { rankingMetric: "round_entry_seed", sortDirection: "asc" },
  ]);
  assert.equal(openingRound.reseedStandings.rankingMetric, "tournament_points");
<<<<<<< HEAD
>>>>>>> 67350be (Added multi-round support)
=======
=======
  assert.equal(openingRound.games, 2);
>>>>>>> ca21f53 (Added multiple games per round support)
>>>>>>> 60dbee6 (Added multiple games per round support)
=======
  assert.equal(openingRound.games, 2);
=======
  assert.equal(openingRound.games, 6);
  assert.equal(openingRound.reseed, 2);
  assert.deepEqual(openingRound.standings.tieBreakers, [
    { rankingMetric: "current_round_firsts", sortDirection: "desc" },
    { rankingMetric: "round_entry_seed", sortDirection: "asc" },
  ]);
  assert.equal(openingRound.reseedStandings.rankingMetric, "tournament_points");
>>>>>>> 67350be (Added multi-round support)
>>>>>>> 1300bff (Added multi-round support)
  assert.deepEqual(openingRound.advancement, {
    type: "top_n",
    count: 8,
    rankingMetric: "points",
    destinationRoundId: "final-round",
  });

  assert.equal(finalRound.lobbySeeding, "random");
  assert.equal(finalRound.games, 2);
  assert.deepEqual(finalRound.winCondition, {
    type: "highest_points_after_games",
    games: 2,
    rankingMetric: "points",
  });
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
