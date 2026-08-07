import {
  detectPlacementLayoutProfile,
  isProfileNoise,
  profileFingerprintScore,
  type PlacementLayoutProfile,
} from "./layout-profiles";
import type {
  OcrBoundingBox,
  OcrRosterEntry,
  OcrWord,
  PlacementIssue,
  PlacementParseResult,
  PlacementRow,
} from "./types";

const MATCH_THRESHOLD = 0.82;
const MATCH_MARGIN = 0.08;
const MAX_ROSTER_ENTRIES = 8;
const MAX_GAME_NAME_LENGTH = 16;
const MAX_CANDIDATES_PER_ROW = 64;
const MAX_BEAM_STATES = 96;
const MIN_LAYOUT_CONFIDENCE = 0.55;
const LAYOUT_HEADINGS = new Set([
  "standing",
  "player",
  "standingplayer",
  "firstplace",
  "teamfightstactics",
  "normal",
  "gameid",
]);

type IndexedWord = OcrWord & { index: number };
type TextLine = { words: IndexedWord[]; centerY: number };
type RowBand = { centerY: number; lower: number; upper: number };
type NameCandidate = {
  text: string;
  words: IndexedWord[];
  startX: number;
  centerY: number;
  lexicalScore: number;
  confidence: number;
};
type AnchorSet = {
  centers: number[];
  words: IndexedWord[];
  support: number;
  x: number;
};
type LayoutHypothesis = {
  source: "anchors" | "column" | "regular" | "partial";
  rowCenters: number[];
  rows: NameCandidate[][];
  anchors: AnchorSet | null;
  columnLeft: number | null;
  profile: PlacementLayoutProfile;
  profileScore: number;
  anchorSupport: number;
  rowRegularity: number;
  candidateAlignment: number;
};
type SelectedLayout = LayoutHypothesis & {
  selected: NameCandidate[];
  assignments: Array<number | null>;
  similarity: number;
  safeMatches: number;
  confidence: number;
};
type RosterMatch = { entryIndex: number; score: number; safe: boolean };

function center(box: OcrBoundingBox): { x: number; y: number } {
  return {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
  };
}

function wordHeight(word: OcrWord): number {
  return Math.max(word.box.bottom - word.box.top, 0.001);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
}

function clamp(value: number, lower = 0, upper = 1): number {
  return Math.max(lower, Math.min(upper, value));
}

function normalizedGameName(value: string): string {
  const [gameName = ""] = value.normalize("NFKC").split("#", 1);
  return gameName.replace(/[.…]+$/u, "").trim();
}

export function normalizePlayerName(value: string): string {
  return normalizedGameName(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function hasTruncationMarker(value: string): boolean {
  const gameName = value.normalize("NFKC").split("#", 1)[0]?.trim() ?? "";
  return /(?:\.{3}|…)$/u.test(gameName);
}

function gameNameLength(value: string): number {
  return Array.from(normalizedGameName(value)).length;
}

function levenshteinDistance(first: string, second: string): number {
  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);

  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = firstIndex;

    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      const above = previous[secondIndex] ?? 0;
      const cost = first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1;
      previous[secondIndex] = Math.min(
        (previous[secondIndex - 1] ?? 0) + 1,
        above + 1,
        diagonal + cost,
      );
      diagonal = above;
    }
  }

  return previous[second.length] ?? Math.max(first.length, second.length);
}

export function playerNameSimilarity(first: string, second: string): number {
  const normalizedFirst = normalizePlayerName(first);
  const normalizedSecond = normalizePlayerName(second);

  if (!normalizedFirst || !normalizedSecond) return 0;
  if (normalizedFirst === normalizedSecond) return 1;
  if (
    hasTruncationMarker(first) &&
    normalizedFirst.length >= 4 &&
    normalizedSecond.startsWith(normalizedFirst)
  ) {
    return clamp(0.86 + normalizedFirst.length / Math.max(normalizedSecond.length, 1) * 0.14);
  }

  const distance = levenshteinDistance(normalizedFirst, normalizedSecond);
  return Math.max(
    0,
    1 - distance / Math.max(normalizedFirst.length, normalizedSecond.length),
  );
}

function normalizedRoster(roster: OcrRosterEntry[] | undefined): OcrRosterEntry[] {
  return roster?.slice(0, MAX_ROSTER_ENTRIES) ?? [];
}

function isLayoutHeading(value: string): boolean {
  return LAYOUT_HEADINGS.has(normalizePlayerName(value));
}

function textWords(words: IndexedWord[]): IndexedWord[] {
  return words.filter((word) => word.text.trim() && center(word.box).y > 0.005);
}

function lineTolerance(words: IndexedWord[]): number {
  return Math.max(0.012, median(words.map(wordHeight)) * 1.35);
}

function groupWordLines(words: IndexedWord[], tolerance = lineTolerance(words)): TextLine[] {
  const sorted = [...words].sort((first, second) => {
    const firstCenter = center(first.box);
    const secondCenter = center(second.box);
    return firstCenter.y - secondCenter.y || firstCenter.x - secondCenter.x;
  });
  const lines: IndexedWord[][] = [];

  for (const word of sorted) {
    const y = center(word.box).y;
    const line = lines.at(-1);
    const lineY = line ? median(line.map((entry) => center(entry.box).y)) : Number.POSITIVE_INFINITY;
    if (line && Math.abs(y - lineY) <= Math.max(tolerance, wordHeight(word) * 1.2)) {
      line.push(word);
    } else {
      lines.push([word]);
    }
  }

  return lines.map((line) => {
    const sortedLine = line.sort((first, second) => {
      const verticalDifference = center(first.box).y - center(second.box).y;
      return Math.abs(verticalDifference) > tolerance * 0.45
        ? verticalDifference
        : first.box.left - second.box.left;
    });
    return {
      words: sortedLine,
      centerY: median(sortedLine.map((word) => center(word.box).y)),
    };
  });
}

function clusterByLeft(words: IndexedWord[], tolerance: number): IndexedWord[][] {
  const columns: IndexedWord[][] = [];
  for (const word of [...words].sort((first, second) => first.box.left - second.box.left)) {
    const column = columns.find((entries) => {
      const average = entries.reduce((sum, entry) => sum + entry.box.left, 0) / entries.length;
      return Math.abs(word.box.left - average) <= tolerance;
    });
    if (column) column.push(word);
    else columns.push([word]);
  }
  return columns;
}

function chooseRegularCenters(centers: number[]): number[] {
  const sorted = [...new Set(centers.map((value) => Number(value.toFixed(5))))].sort(
    (first, second) => first - second,
  );
  if (sorted.length <= 8) return sorted;

  let best = sorted.slice(0, 8);
  let bestScore = Number.POSITIVE_INFINITY;
  for (let start = 0; start <= sorted.length - 8; start += 1) {
    const window = sorted.slice(start, start + 8);
    const gaps = window.slice(1).map((value, index) => value - (window[index] ?? value));
    const average = median(gaps);
    const score = gaps.reduce((sum, gap) => sum + Math.abs(gap - average), 0);
    if (score < bestScore) {
      best = window;
      bestScore = score;
    }
  }
  return best;
}

function rowBands(centers: number[]): RowBand[] {
  return centers.map((centerY, index) => {
    const previous = index > 0 ? centers[index - 1] : null;
    const next = index < centers.length - 1 ? centers[index + 1] : null;
    const previousGap = previous === null ? next === null ? 0.1 : next - centerY : centerY - previous;
    const nextGap = next === null ? previousGap : next - centerY;
    return {
      centerY,
      lower: Math.max(0, centerY - previousGap / 2),
      upper: Math.min(1, centerY + nextGap / 2),
    };
  });
}

function fitPlacementAnchors(words: IndexedWord[], tolerance: number): AnchorSet[] {
  const numeric = words.filter((word) => {
    const value = Number.parseInt(word.text.trim(), 10);
    return /^\d{1,2}$/.test(word.text.trim()) && value >= 1 && value <= 8;
  });
  const result: AnchorSet[] = [];

  for (const column of clusterByLeft(numeric, tolerance * 2.5)) {
    const entries = column
      .map((word) => ({ word, value: Number.parseInt(word.text.trim(), 10), y: center(word.box).y }))
      .sort((first, second) => first.y - second.y);
    const unique = entries.filter((entry, index, all) => all.findIndex((candidate) => candidate.value === entry.value) === index);
    if (unique.length < 2) continue;
    const first = unique[0];
    const last = unique.at(-1);
    if (!first || !last || last.value <= first.value) continue;
    const step = (last.y - first.y) / (last.value - first.value);
    if (step <= tolerance * 2) continue;
    const intercept = first.y - step * first.value;
    const residual = unique.reduce((sum, entry) => sum + Math.abs(entry.y - (intercept + step * entry.value)), 0) / unique.length;
    if (residual > Math.max(tolerance * 2.5, step * 0.3)) continue;

    result.push({
      centers: Array.from({ length: 8 }, (_, index) => intercept + step * (index + 1)),
      words: unique.map((entry) => entry.word),
      support: unique.length / 8,
      x: median(unique.map((entry) => center(entry.word.box).x)),
    });
  }

  return result.sort((first, second) => second.support - first.support).slice(0, 3);
}

function trimNameWords(words: IndexedWord[]): string {
  const accepted: string[] = [];
  for (const word of words) {
    const token = word.text.trim();
    if (!token) continue;
    const candidate = [...accepted, token].join(" ");
    if (gameNameLength(candidate) > MAX_GAME_NAME_LENGTH) {
      // A token that is already too long is more likely to be a neighbouring
      // field or OCR noise than a valid TFT game name. Do not manufacture a
      // truncated identity that could accidentally match a roster member.
      if (accepted.length === 0) return "";
      break;
    }
    accepted.push(token);
    if (token.includes("#")) break;
  }
  return accepted.join(" ");
}

function candidateLexicalScore(text: string, startX: number, words: IndexedWord[], profile: PlacementLayoutProfile): number {
  const normalized = normalizePlayerName(text);
  const hasLetters = /\p{L}/u.test(normalized);
  const noise = text.split(/\s+/u).some((token) => isProfileNoise(token, profile));
  const numericOnly = /^\d+$/u.test(normalized);
  const numericPrefix = /^\d+\s+/u.test(text.trim());
  const confidence = median(words.map((word) => word.confidence ?? 0.5));
  const largestGap = words.slice(1).reduce((largest, word, index) => {
    const previous = words[index];
    return Math.max(largest, previous ? word.box.left - previous.box.right : 0);
  }, 0);
  const typicalWidth = median(words.map((word) => word.box.right - word.box.left));
  const typicalHeight = median(words.map(wordHeight));
  const gapPenalty = largestGap > Math.max(typicalHeight * 3, typicalWidth * 4) ? -0.9 : 0;
  return (
    (hasLetters ? 0.55 : 0.05) +
    (gameNameLength(text) >= 3 && gameNameLength(text) <= MAX_GAME_NAME_LENGTH ? 0.2 : 0) +
    (startX < 0.55 ? 0.15 : -0.1) +
    (numericOnly ? -0.25 : 0) +
    (numericPrefix ? -0.45 : 0) +
    (noise ? -0.55 : 0) +
    gapPenalty +
    Math.min(gameNameLength(text), MAX_GAME_NAME_LENGTH) * 0.015 +
    confidence * 0.1
  );
}

function candidateKey(candidate: NameCandidate): string {
  return `${candidate.text.toLocaleLowerCase()}@${candidate.startX.toFixed(3)}@${candidate.centerY.toFixed(3)}`;
}

function enumerateLineCandidates(line: TextLine, profile: PlacementLayoutProfile): NameCandidate[] {
  const candidates: NameCandidate[] = [];
  for (let start = 0; start < line.words.length; start += 1) {
    for (let end = start; end < line.words.length; end += 1) {
      const sourceWords = line.words.slice(start, end + 1);
      const text = trimNameWords(sourceWords);
      if (!text) continue;
      if (gameNameLength(text) > MAX_GAME_NAME_LENGTH) break;
      candidates.push({
        text,
        words: sourceWords,
        startX: sourceWords[0]?.box.left ?? 1,
        centerY: median(sourceWords.map((word) => center(word.box).y)),
        lexicalScore: candidateLexicalScore(text, sourceWords[0]?.box.left ?? 1, sourceWords, profile),
        confidence: median(sourceWords.map((word) => word.confidence ?? 0.5)),
      });
      if (sourceWords.some((word) => word.text.includes("#"))) break;
    }
  }
  return candidates;
}

function candidatesForBand(words: IndexedWord[], band: RowBand, profile: PlacementLayoutProfile, tolerance: number): NameCandidate[] {
  const rowWords = words.filter((word) => {
    const y = center(word.box).y;
    return y >= band.lower && y < band.upper;
  });
  const lines = groupWordLines(rowWords, tolerance);
  const candidates = lines.flatMap((line) => enumerateLineCandidates(line, profile));

  for (let index = 0; index < lines.length - 1; index += 1) {
    const first = lines[index];
    const second = lines[index + 1];
    if (!first || !second) continue;
    if (second.centerY - first.centerY > tolerance * 4) continue;
    for (const firstCandidate of enumerateLineCandidates(first, profile)) {
      for (const secondCandidate of enumerateLineCandidates(second, profile)) {
        if (secondCandidate.startX > firstCandidate.startX + tolerance * 4) continue;
        const wordsForCandidate = [...firstCandidate.words, ...secondCandidate.words];
        const text = trimNameWords(wordsForCandidate);
        if (!text || gameNameLength(text) > MAX_GAME_NAME_LENGTH) continue;
        candidates.push({
          text,
          words: wordsForCandidate,
          startX: firstCandidate.startX,
          centerY: firstCandidate.centerY,
          lexicalScore: candidateLexicalScore(text, firstCandidate.startX, wordsForCandidate, profile),
          confidence: median(wordsForCandidate.map((word) => word.confidence ?? 0.5)),
        });
      }
    }
  }

  const unique = new Map<string, NameCandidate>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const existing = unique.get(key);
    if (!existing || candidate.lexicalScore > existing.lexicalScore) unique.set(key, candidate);
  }
  const sorted = [...unique.values()].sort((first, second) => second.lexicalScore - first.lexicalScore);
  return sorted.slice(0, MAX_CANDIDATES_PER_ROW);
}

function rowRegularity(centers: number[]): number {
  if (centers.length < 3) return 0.25;
  const gaps = centers.slice(1).map((value, index) => value - (centers[index] ?? value));
  const average = median(gaps);
  if (average <= 0) return 0;
  const deviation = gaps.reduce((sum, gap) => sum + Math.abs(gap - average), 0) / gaps.length;
  return clamp(1 - deviation / average);
}

function candidateAlignment(rows: NameCandidate[][]): number {
  return leftEdgeConsistency(rows.flatMap((candidates) => candidates[0] ? [candidates[0]] : []));
}

function leftEdgeConsistency(candidates: NameCandidate[]): number {
  const values = candidates.map((candidate) => candidate.startX);
  if (values.length < 2) return 0.25;
  const middle = median(values);
  const deviation = median(values.map((value) => Math.abs(value - middle)));
  const textHeight = median(candidates.flatMap((candidate) => candidate.words.map(wordHeight)));
  return clamp(1 - deviation / Math.max(textHeight * 3, 0.001));
}

function buildHypothesis(
  source: LayoutHypothesis["source"],
  centers: number[],
  words: IndexedWord[],
  profile: PlacementLayoutProfile,
  profileScore: number,
  anchors: AnchorSet | null,
  columnLeft: number | null,
  tolerance: number,
): LayoutHypothesis | null {
  if (centers.length === 0) return null;
  const bands = rowBands(centers);
  const rows = bands.map((band) => {
    const candidates = candidatesForBand(words, band, profile, tolerance);
    if (columnLeft === null) return candidates;
    const aligned = candidates.filter((candidate) =>
      Math.abs(candidate.startX - columnLeft) <= tolerance * 2.5,
    );
    return aligned.length > 0 ? aligned : candidates;
  });
  return {
    source,
    rowCenters: centers,
    rows,
    anchors,
    columnLeft,
    profile,
    profileScore,
    anchorSupport: anchors?.support ?? 0,
    rowRegularity: rowRegularity(centers),
    candidateAlignment: candidateAlignment(rows),
  };
}

function generateHypotheses(words: IndexedWord[], profile: PlacementLayoutProfile): LayoutHypothesis[] {
  const height = median(words.map(wordHeight));
  const tolerance = Math.max(0.012, height * 1.35);
  const hypotheses: LayoutHypothesis[] = [];
  const profileScore = profileFingerprintScore(words, profile);
  const anchors = fitPlacementAnchors(words, tolerance);

  for (const anchor of anchors) {
    const hypothesis = buildHypothesis("anchors", anchor.centers, words, profile, profileScore, anchor, null, tolerance);
    if (hypothesis) hypotheses.push(hypothesis);
  }

  const startWords = words.filter((word) => /\p{L}/u.test(word.text) && !isLayoutHeading(word.text));
  const columnTolerance = Math.max(0.012, height * 0.75);
  for (const column of clusterByLeft(startWords, columnTolerance).filter((entries) => entries.length >= 2).slice(0, 10)) {
    const centers = chooseRegularCenters(groupWordLines(column, tolerance).map((line) => line.centerY));
    if (centers.length < 2) continue;
    const columnLeft = median(column.map((word) => word.box.left));
    const hypothesis = buildHypothesis("column", centers, words, profile, profileScore, null, columnLeft, tolerance);
    if (hypothesis) hypotheses.push(hypothesis);
  }

  const lineCenters = groupWordLines(textWords(words), tolerance).map((line) => line.centerY);
  const regularCenters = chooseRegularCenters(lineCenters);
  if (regularCenters.length >= 2) {
    const hypothesis = buildHypothesis("regular", regularCenters, words, profile, profileScore, null, null, tolerance);
    if (hypothesis) hypotheses.push(hypothesis);
  }

  return hypotheses;
}

function rosterNames(roster: OcrRosterEntry[]): string[] {
  return roster.map((entry) => normalizePlayerName(entry.displayName));
}

function rosterMatchScores(candidate: NameCandidate, roster: OcrRosterEntry[]): Array<RosterMatch & { exact: boolean; prefix: boolean }> {
  const normalizedCandidates = rosterNames(roster);
  const normalizedCandidate = normalizePlayerName(candidate.text);
  const truncationPrefix = hasTruncationMarker(candidate.text) && normalizedCandidate.length >= 4;
  const prefixMatches = truncationPrefix
    ? normalizedCandidates.filter((name) => name.startsWith(normalizedCandidate)).length
    : 0;
  const duplicateNames = new Set(
    normalizedCandidates.filter((name, index, all) => name && all.indexOf(name) !== index),
  );
  const scores = roster.map((entry, entryIndex) => ({
    entryIndex,
    score: playerNameSimilarity(candidate.text, entry.displayName),
  })).sort((first, second) => second.score - first.score);
  const best = scores[0];
  if (!best) return [];
  return scores.map((entry, index) => {
    const exact = normalizedCandidate === normalizedCandidates[entry.entryIndex];
    const prefix = prefixMatches === 1 && normalizedCandidates[entry.entryIndex]?.startsWith(normalizedCandidate);
    const duplicate = duplicateNames.has(normalizedCandidates[entry.entryIndex] ?? "");
    const nextBest = index === 0 ? scores[1] : best;
    const safe = !duplicate && (exact || Boolean(prefix) || (entry.score >= MATCH_THRESHOLD && (!nextBest || entry.score - nextBest.score >= MATCH_MARGIN)));
    return { ...entry, safe, exact, prefix };
  });
}

function safeRosterMatch(candidate: NameCandidate, roster: OcrRosterEntry[]): RosterMatch[] {
  return rosterMatchScores(candidate, roster).filter((match) => match.safe);
}

type AssignmentState = {
  safeMatches: number;
  similarity: number;
  lexical: number;
  choices: NameCandidate[];
  assignments: Array<number | null>;
};

function betterAssignment(first: AssignmentState, second: AssignmentState): AssignmentState {
  if (first.safeMatches !== second.safeMatches) return first.safeMatches > second.safeMatches ? first : second;
  const firstAlignment = leftEdgeConsistency(first.choices);
  const secondAlignment = leftEdgeConsistency(second.choices);
  if (firstAlignment !== secondAlignment) return firstAlignment > secondAlignment ? first : second;
  if (first.similarity !== second.similarity) return first.similarity > second.similarity ? first : second;
  return first.lexical >= second.lexical ? first : second;
}

function selectWithRoster(hypothesis: LayoutHypothesis, roster: OcrRosterEntry[]): AssignmentState {
  let states = new Map<number, AssignmentState>([[0, { safeMatches: 0, similarity: 0, lexical: 0, choices: [], assignments: [] }]]);
  for (const row of hypothesis.rows) {
    const candidates = row.length > 0 ? row : [{ text: "", words: [], startX: 1, centerY: 0, lexicalScore: -1, confidence: 0 }];
    const next = new Map<number, AssignmentState>();
    for (const [mask, state] of states) {
      for (const candidate of candidates) {
        const matches = safeRosterMatch(candidate, roster);
        const options: Array<{ entryIndex: number | null; score: number; safe: boolean }> = [{ entryIndex: null, score: 0, safe: false }];
        for (const match of matches) {
          if (match.safe && (mask & (1 << match.entryIndex)) === 0) options.push(match);
        }
        for (const option of options) {
          const nextMask = option.entryIndex === null ? mask : mask | (1 << option.entryIndex);
          const candidateState: AssignmentState = {
            safeMatches: state.safeMatches + (option.safe ? 1 : 0),
            similarity: state.similarity + option.score,
            lexical: state.lexical + candidate.lexicalScore,
            choices: [...state.choices, candidate],
            assignments: [...state.assignments, option.entryIndex],
          };
          const existing = next.get(nextMask);
          next.set(nextMask, existing ? betterAssignment(existing, candidateState) : candidateState);
        }
      }
    }
    states = new Map([...next.entries()].sort((first, second) => {
      const firstScore = first[1].safeMatches * 100 + leftEdgeConsistency(first[1].choices) * 10 + first[1].similarity + first[1].lexical * 0.01;
      const secondScore = second[1].safeMatches * 100 + leftEdgeConsistency(second[1].choices) * 10 + second[1].similarity + second[1].lexical * 0.01;
      return secondScore - firstScore;
    }).slice(0, MAX_BEAM_STATES));
  }
  return [...states.values()].reduce((best, state) => betterAssignment(best, state));
}

function selectWithoutRoster(hypothesis: LayoutHypothesis): AssignmentState {
  let states: AssignmentState[] = [{ safeMatches: 0, similarity: 0, lexical: 0, choices: [], assignments: [] }];
  for (const row of hypothesis.rows) {
    const candidates = row.length > 0 ? row.slice(0, 24) : [{ text: "", words: [], startX: 1, centerY: 0, lexicalScore: -1, confidence: 0 }];
    const next: AssignmentState[] = [];
    for (const state of states) {
      for (const candidate of candidates) {
        const alignment = leftEdgeConsistency([...state.choices, candidate]);
        next.push({
          safeMatches: 0,
          similarity: alignment,
          lexical: state.lexical + candidate.lexicalScore,
          choices: [...state.choices, candidate],
          assignments: [...state.assignments, null],
        });
      }
    }
    states = next.sort((first, second) => (second.lexical + second.similarity) - (first.lexical + first.similarity)).slice(0, MAX_BEAM_STATES);
  }
  return states.reduce((best, state) => betterAssignment(best, state));
}

function confidenceForSelection(
  hypothesis: LayoutHypothesis,
  selection: AssignmentState,
  rosterProvided: boolean,
): number {
  const selectedAlignment = leftEdgeConsistency(selection.choices);
  const candidateConfidence = median(selection.choices.map((candidate) => candidate.confidence));
  const matchConfidence = rosterProvided ? selection.safeMatches / Math.max(selection.choices.length, 1) : 0;
  return clamp(
    hypothesis.anchorSupport * 0.25 +
    hypothesis.rowRegularity * 0.25 +
    Math.max(hypothesis.candidateAlignment, selectedAlignment) * 0.2 +
    candidateConfidence * 0.1 +
    matchConfidence * 0.2,
  );
}

function selectLayouts(hypotheses: LayoutHypothesis[], roster: OcrRosterEntry[] | undefined): SelectedLayout[] {
  return hypotheses
    .map((hypothesis) => {
      const selection = roster ? selectWithRoster(hypothesis, roster) : selectWithoutRoster(hypothesis);
      const selectedAlignment = leftEdgeConsistency(selection.choices);
      return {
        ...hypothesis,
        selected: selection.choices,
        assignments: selection.assignments,
        similarity: selection.similarity,
        safeMatches: selection.safeMatches,
        candidateAlignment: selectedAlignment,
        confidence: confidenceForSelection(hypothesis, selection, Boolean(roster)),
      };
    })
    .sort((first, second) => {
      if (first.selected.length !== second.selected.length) return second.selected.length - first.selected.length;
      if (roster && first.safeMatches !== second.safeMatches) return second.safeMatches - first.safeMatches;
      if (first.anchorSupport !== second.anchorSupport) return second.anchorSupport - first.anchorSupport;
      if (first.candidateAlignment !== second.candidateAlignment) return second.candidateAlignment - first.candidateAlignment;
      if (first.rowRegularity !== second.rowRegularity) return second.rowRegularity - first.rowRegularity;
      if (first.similarity !== second.similarity) return second.similarity - first.similarity;
      return second.confidence - first.confidence;
    });
}

function matchRows(
  selected: NameCandidate[],
  assignments: Array<number | null>,
  roster: OcrRosterEntry[] | undefined,
): { rows: PlacementRow[]; issues: PlacementIssue[] } {
  const entries = normalizedRoster(roster);
  const issues: PlacementIssue[] = [];
  if (!roster) {
    return {
      rows: selected.map((candidate, index) => ({
        placement: index + 1,
        extractedName: candidate.text,
        matchStatus: "not_requested",
        matchedRosterEntry: null,
        similarity: null,
      })),
      issues: [
        ...selected.flatMap((candidate, index) => candidate.text ? [] : [{ code: "EMPTY_PLAYER_NAME" as const, message: "No player name was detected.", placement: index + 1 }]),
        { code: "ROSTER_VALIDATION_REQUIRED", message: "A roster is required before OCR placements can be marked complete." },
      ],
    };
  }

  const duplicateNames = new Set(
    entries.map((entry) => normalizePlayerName(entry.displayName)).filter((name, index, all) => name && all.indexOf(name) !== index),
  );
  const rows = selected.map((candidate, index) => {
    const assignedIndex = assignments[index] ?? null;
    const assigned = assignedIndex === null ? null : entries[assignedIndex];
    const scored = entries.map((entry, entryIndex) => ({ entryIndex, score: playerNameSimilarity(candidate.text, entry.displayName) })).sort((first, second) => second.score - first.score);
    const best = scored[0] ? { index: scored[0].entryIndex, score: scored[0].score } : null;
    const second = scored[1];
    const candidateName = normalizePlayerName(candidate.text);
    const bestName = best ? normalizePlayerName(entries[best.index]?.displayName ?? "") : "";
    const exact = best ? normalizePlayerName(candidate.text) === bestName : false;
    const prefixMatches = hasTruncationMarker(candidate.text)
      ? entries.filter((entry) => normalizePlayerName(entry.displayName).startsWith(candidateName)).length
      : 0;
    const prefix = best ? prefixMatches === 1 && bestName.startsWith(candidateName) : false;
    const duplicate = best ? duplicateNames.has(bestName) : false;

    if (assigned && assignedIndex !== null) {
      return {
        placement: index + 1,
        extractedName: candidate.text,
        matchStatus: "matched" as const,
        matchedRosterEntry: { id: assigned.id, displayName: assigned.displayName, similarity: playerNameSimilarity(candidate.text, assigned.displayName) },
        similarity: playerNameSimilarity(candidate.text, assigned.displayName),
      };
    }
    if (!best || best.score < MATCH_THRESHOLD) {
      issues.push({ code: "UNMATCHED_PLAYER", message: `Detected player ${candidate.text || "(empty name)"} is not in this lobby roster, or the OCR text differs too much to match safely.`, placement: index + 1 });
      return { placement: index + 1, extractedName: candidate.text, matchStatus: "unmatched" as const, matchedRosterEntry: null, similarity: best?.score ?? 0 };
    }
    if (duplicate || (!exact && !prefix && second && best.score - second.score < MATCH_MARGIN)) {
      issues.push({ code: duplicate ? "DUPLICATE_ROSTER_NAME" : "AMBIGUOUS_PLAYER", message: `The detected name ${candidate.text} has no safe unique roster match.`, placement: index + 1 });
      return { placement: index + 1, extractedName: candidate.text, matchStatus: "ambiguous" as const, matchedRosterEntry: null, similarity: best.score };
    }
    return { placement: index + 1, extractedName: candidate.text, matchStatus: "matched" as const, matchedRosterEntry: { id: entries[best.index]!.id, displayName: entries[best.index]!.displayName, similarity: best.score }, similarity: best.score };
  });
  return { rows, issues };
}

function rankAnchorsForDebug(anchor: AnchorSet | null): OcrWord[] {
  return anchor?.words.map((word) => {
    const { index, ...rest } = word;
    void index;
    return rest;
  }) ?? [];
}

function candidateDiagnostics(selected: SelectedLayout): PlacementParseResult["debug"]["candidateDiagnostics"] {
  return selected.rows.map((row, index) => ({
    placement: index + 1,
    selected: selected.selected[index]?.text ?? "",
    alternatives: row.slice(0, 6).map((candidate) => candidate.text).filter((text) => text !== selected.selected[index]?.text),
  }));
}

export function parsePlacementWords(words: OcrWord[], roster?: OcrRosterEntry[]): PlacementParseResult {
  const indexed = words.map((word, index) => ({ ...word, index }));
  const profile = detectPlacementLayoutProfile(words);
  const hypotheses = generateHypotheses(indexed, profile);
  const selections = selectLayouts(hypotheses, roster);
  const selected = selections[0];
  const fallbackWords = textWords(indexed).slice(0, 1);
  const fallbackCandidate: NameCandidate = fallbackWords[0]
    ? { text: trimNameWords(fallbackWords), words: fallbackWords, startX: fallbackWords[0].box.left, centerY: center(fallbackWords[0].box).y, lexicalScore: 0, confidence: fallbackWords[0].confidence ?? 0.5 }
    : { text: "", words: [], startX: 1, centerY: 0, lexicalScore: -1, confidence: 0 };
  const effective: SelectedLayout = selected ?? {
    source: fallbackWords.length > 0 ? "partial" : "regular",
    rowCenters: fallbackWords.length > 0 ? [fallbackCandidate.centerY] : [],
    rows: fallbackWords.length > 0 ? [[fallbackCandidate]] : [],
    anchors: null,
    columnLeft: fallbackWords[0]?.box.left ?? null,
    profile,
    profileScore: profileFingerprintScore(words, profile),
    anchorSupport: 0,
    rowRegularity: 0,
    candidateAlignment: 0,
    selected: fallbackWords.length > 0 ? [fallbackCandidate] : [],
    assignments: [null],
    similarity: 0,
    safeMatches: 0,
    confidence: 0,
  };
  const matched = matchRows(effective.selected, effective.assignments, roster);
  const issues = [...matched.issues];
  if (effective.selected.length !== 8) {
    issues.unshift({ code: "INCOMPLETE_ROWS", message: `Detected ${effective.selected.length} player rows; expected 8.` });
  }
  if (!roster || effective.confidence < MIN_LAYOUT_CONFIDENCE) {
    if (effective.confidence < MIN_LAYOUT_CONFIDENCE) issues.push({ code: "LOW_LAYOUT_CONFIDENCE", message: "The OCR layout evidence is too weak to trust automatically." });
  }
  if (effective.source === "partial" || effective.selected.length === 0) {
    issues.push({ code: "UNSUPPORTED_LAYOUT", message: "The screenshot did not contain a recognizable ordered standings layout." });
  }

  const complete = Boolean(
    roster &&
    effective.selected.length === 8 &&
    effective.safeMatches === 8 &&
    effective.confidence >= MIN_LAYOUT_CONFIDENCE &&
    matched.rows.every((row) => row.matchStatus === "matched") &&
    issues.length === 0,
  );
  const second = selections[1];
  const runnerUpMargin = second ? clamp(effective.confidence - second.confidence) : effective.confidence;
  const strategy: PlacementParseResult["strategy"] =
    roster ? "roster_guided" :
    effective.source === "partial" ? "unresolved" :
    effective.candidateAlignment >= 0.5 || effective.columnLeft !== null ? "name_column" : "rank_anchors";

  return {
    schemaVersion: 2,
    status: complete ? "complete" : "review_required",
    strategy,
    placements: matched.rows,
    issues,
    debug: {
      detectedWords: words.map((word) => ({ ...word, box: { ...word.box } })),
      orderedNameCandidates: effective.selected.map((candidate) => candidate.text),
      rankAnchors: rankAnchorsForDebug(effective.anchors),
      selectedProfile: effective.profile.id,
      layoutConfidence: effective.confidence,
      runnerUpMargin,
      rowCenters: effective.rowCenters,
      candidateDiagnostics: candidateDiagnostics(effective),
      finalizedOrder: effective.selected.map((candidate, index) => ({ placement: index + 1, extractedName: candidate.text })),
      rosterProvided: roster !== undefined,
      rosterSize: roster?.length ?? 0,
    },
  };
}

export function parsePlacementImage(
  image: Uint8Array,
  detector: (image: Uint8Array) => Promise<{ words: OcrWord[] }>,
  roster?: OcrRosterEntry[],
): Promise<PlacementParseResult> {
  return detector(image).then(({ words }) => parsePlacementWords(words, roster));
}
