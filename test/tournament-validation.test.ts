import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidTournamentName,
  isValidTournamentPlayerCount,
  validateTournamentCreation,
} from "../lib/tournament/validation";

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
