import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parsePlacementWords } from "../lib/ocr/placements/parser";
import type { OcrRosterEntry, OcrWord } from "../lib/ocr/placements/types";

type Fixture = { names: string[]; words: OcrWord[] };

async function fixture(name: string): Promise<Fixture> {
  return JSON.parse(await readFile(`test/fixtures/ocr/${name}.json`, "utf8")) as Fixture;
}

test("selects unique roster matches across the four supported layout families", async () => {
  for (const profile of ["game-client", "ranked-results", "compact-results", "table-results"]) {
    const current = await fixture("multi-layout-fixtures");
    const source = (current as unknown as Record<string, Fixture>)[profile];
    assert.ok(source, `missing ${profile} fixture`);
    const roster: OcrRosterEntry[] = source.names.map((displayName, index) => ({ id: `${profile}-${index + 1}`, displayName }));
    const result = parsePlacementWords(source.words, roster);
    assert.equal(result.status, "complete", profile);
    assert.deepEqual(result.placements.map((row) => row.matchedRosterEntry?.displayName), source.names, profile);
    assert.equal(result.placements.length, 8, profile);
  }
});

test("uses the generic hypothesis scorer for an unknown layout and still requires roster validation", async () => {
  const source = await fixture("unknown-layout");
  const roster = source.names.map((displayName, index) => ({ id: String(index + 1), displayName }));
  const withRoster = parsePlacementWords(source.words, roster);
  assert.equal(withRoster.status, "complete");
  assert.equal(withRoster.debug.selectedProfile, "generic");

  const withoutRoster = parsePlacementWords(source.words);
  assert.equal(withoutRoster.status, "review_required");
  assert.ok(withoutRoster.issues.some((issue) => issue.code === "ROSTER_VALIDATION_REQUIRED"));
  assert.deepEqual(withoutRoster.placements.map((row) => row.extractedName), source.names);
});
