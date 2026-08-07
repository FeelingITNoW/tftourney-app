import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parsePlacementWords, playerNameSimilarity } from "../lib/ocr/placements/parser";
import type { OcrRosterEntry, OcrWord } from "../lib/ocr/placements/types";

async function fixtureWords(): Promise<OcrWord[]> {
  const fixture = JSON.parse(await readFile("test/fixtures/ocr/desktop-wrapped-name.json", "utf8")) as { words: OcrWord[] };
  return fixture.words;
}

const roster: OcrRosterEntry[] = [
  { id: "p1", displayName: "AXM raph1" },
  { id: "p2", displayName: "AXM Gettey" },
  { id: "p3", displayName: "AXM Maha" },
  { id: "p4", displayName: "TS Stryggar" },
  { id: "p5", displayName: "AXM Frnd Chicken" },
  { id: "p6", displayName: "numba 10" },
  { id: "p7", displayName: "tokyosniper" },
  { id: "p8", displayName: "TS mode" },
];

test("parses eight rows, wrapped names, and ignores a misread sixth-place glyph", async () => {
  const result = parsePlacementWords(await fixtureWords(), roster);
  assert.equal(result.status, "complete");
  assert.equal(result.strategy, "roster_guided");
  assert.deepEqual(result.placements.map((row) => [row.placement, row.matchedRosterEntry?.id]), [
    [1, "p1"], [2, "p2"], [3, "p3"], [4, "p4"],
    [5, "p5"], [6, "p6"], [7, "p7"], [8, "p8"],
  ]);
  assert.equal(result.placements[4]?.extractedName, "AXM Frnd Chicken");
  assert.equal(result.placements[5]?.extractedName, "numba 10");
});

test("parses scaled coordinates and preserves extracted names without a roster", async () => {
  const words = await fixtureWords();
  const scaled = words.map((word) => ({
    ...word,
    box: {
      left: word.box.left,
      right: word.box.right,
      top: word.box.top,
      bottom: word.box.bottom,
    },
  }));
  const result = parsePlacementWords(scaled);
  assert.equal(result.status, "review_required");
  assert.equal(result.placements[0]?.matchStatus, "not_requested");
  assert.ok(result.issues.some((issue) => issue.code === "ROSTER_VALIDATION_REQUIRED"));
  assert.deepEqual(result.placements.map((row) => row.placement), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("uses roster-guided parsing for an ordered portrait crop without rank anchors", () => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
  const words = names.map((text, index) => ({
    text,
    box: { left: 0.2, right: 0.5, top: 0.05 + index * 0.11, bottom: 0.08 + index * 0.11 },
  }));
  const result = parsePlacementWords(words, names.map((displayName, index) => ({ id: String(index + 1), displayName })));
  assert.equal(result.strategy, "roster_guided");
  assert.equal(result.status, "complete");
  assert.deepEqual(result.placements.map((row) => row.matchedRosterEntry?.displayName), names);
});

test("uses the roster fallback when a tight crop loses rank glyphs and has a wrapped name", () => {
  const word = (text: string, left: number, top: number, width = 0.06): OcrWord => ({
    text,
    box: { left, right: left + width, top, bottom: top + 0.04 },
  });
  const words: OcrWord[] = [
    word("STANDING", 0.015, 0.025, 0.1),
    word("PLAYER", 0.151, 0.027, 0.08),
    word("tokyosniper", 0.149, 0.115, 0.12),
    word("2", 0.039, 0.22, 0.025),
    word("4", 0.038, 0.441, 0.025),
    word("5", 0.039, 0.55, 0.025),
    word("6", 0.039, 0.663, 0.025),
    word("7", 0.039, 0.774, 0.025),
    word("8", 0.038, 0.88, 0.025),
    word("AXM", 0.15, 0.222, 0.04),
    word("raph1", 0.192, 0.222),
    word("TS", 0.15, 0.333, 0.025),
    word("mode", 0.175, 0.333),
    word("AXM", 0.15, 0.429, 0.04),
    word("Frnd", 0.192, 0.429, 0.055),
    word("Chicken", 0.15, 0.462, 0.07),
    word("AXM", 0.149, 0.552, 0.04),
    word("Maha", 0.192, 0.556),
    word("TS", 0.151, 0.666, 0.025),
    word("Stryggar", 0.174, 0.666, 0.07),
    word("numba", 0.149, 0.778),
    word("10", 0.206, 0.778, 0.03),
    word("AXM", 0.149, 0.885, 0.04),
    word("Gettey", 0.192, 0.888),
    word("|", 0.858, 0.333),
    word("O", 0.857, 0.873),
  ];
  const names = [
    "tokyosniper",
    "AXM raph1",
    "TS mode",
    "AXM Frnd Chicken",
    "AXM Maha",
    "TS Stryggar",
    "numba 10",
    "AXM Gettey",
  ];
  const result = parsePlacementWords(
    words,
    names.map((displayName, index) => ({ id: String(index + 1), displayName })),
  );
  assert.equal(result.status, "complete");
  assert.equal(result.strategy, "roster_guided");
  assert.deepEqual(result.placements.map((row) => row.extractedName), names);

  const withoutRoster = parsePlacementWords(words);
  assert.equal(withoutRoster.status, "review_required");
  assert.ok(withoutRoster.issues.some((issue) => issue.code === "ROSTER_VALIDATION_REQUIRED"));
  assert.equal(withoutRoster.strategy, "name_column");
  assert.deepEqual(withoutRoster.placements.map((row) => row.extractedName), names);

  const withAllRankGlyphs = [
    ...words,
    word("1", 0.039, 0.11, 0.025),
    word("3", 0.039, 0.33, 0.025),
  ];
  const orderedResult = parsePlacementWords(withAllRankGlyphs);
  assert.equal(orderedResult.strategy, "name_column");
  assert.deepEqual(orderedResult.placements.map((row) => row.extractedName), names);
  assert.deepEqual(orderedResult.debug?.finalizedOrder, names.map((extractedName, index) => ({
    placement: index + 1,
    extractedName,
  })));
  assert.ok(orderedResult.debug?.detectedWords.some((word) => word.text === "tokyosniper"));
});

test("keeps one-character OCR tokens in a short player name", () => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "S H I N", "Hotel"];
  const words = names.flatMap((name, index) => {
    const top = 0.1 + index * 0.1;
    return name === "S H I N"
      ? ["S", "H", "I", "N"].map((text, tokenIndex) => ({
          text,
          box: { left: 0.2 + tokenIndex * 0.035, right: 0.225 + tokenIndex * 0.035, top, bottom: top + 0.03 },
        }))
      : [{ text: name, box: { left: 0.2, right: 0.5, top, bottom: top + 0.03 } }];
  });
  const result = parsePlacementWords(words, names.map((displayName, index) => ({ id: String(index + 1), displayName })));
  assert.equal(result.status, "complete");
  assert.equal(result.placements[6]?.extractedName, "S H I N");
});

test("ignores text rows that are not aligned under the player-name column", () => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"];
  const words: OcrWord[] = names.map((text, index) => ({
    text,
    box: { left: 0.2, right: 0.36, top: 0.1 + index * 0.1, bottom: 0.13 + index * 0.1 },
  }));
  words.push(
    { text: "Victory", box: { left: 0.55, right: 0.66, top: 0.155, bottom: 0.185 } },
    { text: "Damage", box: { left: 0.55, right: 0.66, top: 0.655, bottom: 0.685 } },
  );

  const result = parsePlacementWords(words);
  assert.equal(result.status, "review_required");
  assert.equal(result.strategy, "name_column");
  assert.ok(result.issues.some((issue) => issue.code === "ROSTER_VALIDATION_REQUIRED"));
  assert.deepEqual(result.placements.map((row) => row.extractedName), names);
});

test("stops a player row before text that would exceed the 16-character game-name limit", () => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "AXM Frnd Chicken", "Foxtrot", "Golf", "Hotel"];
  const words: OcrWord[] = names.flatMap((name, index) => {
    const top = 0.1 + index * 0.1;
    const nameWords = name.split(" ").map((text, tokenIndex) => ({
      text,
      box: {
        left: 0.2 + tokenIndex * 0.055,
        right: 0.245 + tokenIndex * 0.055,
        top,
        bottom: top + 0.03,
      },
    }));
    return index === 4
      ? [...nameWords, { text: "Damage", box: { left: 0.42, right: 0.5, top, bottom: top + 0.03 } }]
      : nameWords;
  });

  const result = parsePlacementWords(words);
  assert.equal(result.status, "review_required");
  assert.equal(result.placements[4]?.extractedName, "AXM Frnd Chicken");
  assert.ok(result.issues.some((issue) => issue.code === "ROSTER_VALIDATION_REQUIRED"));
});

test("does not synthesize a 16-character prefix from an overlong OCR token", () => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "ABCDEFGHIJKLMNOPQ", "Foxtrot", "Golf", "Hotel"];
  const words = names.map((text, index) => ({
    text,
    box: { left: 0.2, right: 0.5, top: 0.1 + index * 0.1, bottom: 0.13 + index * 0.1 },
  }));

  const result = parsePlacementWords(words);
  assert.equal(result.status, "review_required");
  assert.equal(result.placements[4]?.extractedName, "");
  assert.ok(result.issues.some((issue) => issue.code === "EMPTY_PLAYER_NAME"));
});

test("does not count a Riot tag toward the 16-character game-name limit", () => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "1234567890123456#TAG", "Foxtrot", "Golf", "Hotel"];
  const words = names.map((text, index) => ({
    text,
    box: { left: 0.2, right: 0.5, top: 0.1 + index * 0.1, bottom: 0.13 + index * 0.1 },
  }));

  const result = parsePlacementWords(words);
  assert.equal(result.status, "review_required");
  assert.equal(result.placements[4]?.extractedName, "1234567890123456#TAG");
  assert.ok(result.issues.some((issue) => issue.code === "ROSTER_VALIDATION_REQUIRED"));
});

test("accepts unique exact roster matches even when two names are fuzzily close", () => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "cat 123456789", "Foxtrot", "Golf", "cat 1234567890"];
  const words = names.map((text, index) => ({
    text,
    box: { left: 0.2, right: 0.5, top: 0.1 + index * 0.1, bottom: 0.13 + index * 0.1 },
  }));
  const result = parsePlacementWords(words, names.map((displayName, index) => ({ id: String(index + 1), displayName })));
  assert.equal(result.status, "complete");
  assert.equal(result.placements[4]?.matchStatus, "matched");
  assert.equal(result.placements[7]?.matchStatus, "matched");
});

test("matches OCR names against only the game-name portion of Riot IDs", () => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "TS Stryggar"];
  const words = names.map((text, index) => ({
    text,
    box: { left: 0.2, right: 0.5, top: 0.1 + index * 0.1, bottom: 0.13 + index * 0.1 },
  }));
  const result = parsePlacementWords(words, names.map((displayName, index) => ({
    id: String(index + 1),
    displayName: `${displayName}#${index === 7 ? "004" : `TAG${index + 1}`}`,
  })));
  assert.equal(result.status, "complete");
  assert.equal(result.placements[7]?.matchedRosterEntry?.displayName, "TS Stryggar#004");
  assert.equal(result.placements[7]?.similarity, 1);
});

test("does not guess when two lobby Riot IDs have the same game name", () => {
  const result = parsePlacementWords(
    [{ text: "Alpha", box: { left: 0.2, right: 0.5, top: 0.1, bottom: 0.13 } }],
    [
      { id: "one", displayName: "Alpha#NA1" },
      { id: "two", displayName: "Alpha#EUW" },
    ],
  );
  assert.equal(result.placements[0]?.matchStatus, "ambiguous");
  assert.ok(result.issues.some((issue) => issue.code === "DUPLICATE_ROSTER_NAME"));
});

test("reports a detected player that is not in the lobby without dropping its row", () => {
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Outsider", "Foxtrot", "Golf", "Hotel"];
  const words = names.map((text, index) => ({
    text,
    box: { left: 0.2, right: 0.5, top: 0.1 + index * 0.1, bottom: 0.13 + index * 0.1 },
  }));
  const lobbyNames = names.map((name) => name === "Outsider" ? "Echo" : name);
  const result = parsePlacementWords(words, lobbyNames.map((displayName, index) => ({ id: String(index + 1), displayName })));
  assert.equal(result.placements.length, 8);
  assert.equal(result.placements[4]?.extractedName, "Outsider");
  assert.equal(result.placements[4]?.matchStatus, "unmatched");
  assert.ok(result.issues.some((issue) => issue.message.includes("not in this lobby roster")));
  assert.ok(!result.issues.some((issue) => issue.code === "INCOMPLETE_ROWS"));
});

test("requires review for fuzzy ambiguity and duplicate roster names", () => {
  const words = [{ text: "Alphx", box: { left: 0.2, right: 0.4, top: 0.2, bottom: 0.24 } }];
  const result = parsePlacementWords(words, [
    { id: "a", displayName: "Alpha" },
    { id: "b", displayName: "Alphx" },
  ]);
  assert.equal(result.status, "review_required");
  assert.ok(result.issues.some((issue) => issue.code === "INCOMPLETE_ROWS"));
});

test("normalizes Unicode and scores small OCR errors", () => {
  assert.equal(playerNameSimilarity("ＡＸＭ  Frnd", "AXM Frnd"), 1);
  assert.equal(playerNameSimilarity("TS Stryggar", "TS Stryggar#004"), 1);
  assert.ok(playerNameSimilarity("tokyosniper", "tokyosnipeг") > 0.8);
});

test("accepts a unique website-truncated prefix", () => {
  assert.ok(playerNameSimilarity("belatchengel…", "belatchengelha") > 0.86);
  assert.ok(playerNameSimilarity("belatchengel…", "zzzzzzzzzzzz") < 0.2);
});

test("does not accept a truncated prefix shared by multiple roster members", () => {
  const result = parsePlacementWords(
    [{ text: "Alpha…", box: { left: 0.2, right: 0.4, top: 0.2, bottom: 0.24 } }],
    [
      { id: "one", displayName: "AlphaOne" },
      { id: "two", displayName: "AlphaTwo" },
    ],
  );
  assert.equal(result.placements[0]?.matchStatus, "ambiguous");
  assert.ok(result.issues.some((issue) => issue.code === "AMBIGUOUS_PLAYER"));
});
