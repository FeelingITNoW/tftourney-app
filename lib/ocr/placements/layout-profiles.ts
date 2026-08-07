import type { OcrWord } from "./types";

export type PlacementLayoutProfile = {
  id: string;
  hints: string[];
  noiseTokens: string[];
};

const PROFILE_DEFINITIONS: PlacementLayoutProfile[] = [
  {
    id: "game-client",
    hints: ["standing", "player", "teamfightstactics"],
    noiseTokens: ["standing", "player", "teamfightstactics"],
  },
  {
    id: "ranked-results",
    hints: ["challenger", "grandmaster", "master", "lp"],
    noiseTokens: ["challenger", "grandmaster", "master", "diamond", "platinum", "gold", "silver", "bronze", "lp"],
  },
  {
    id: "compact-results",
    hints: ["gameid", "normal", "damage", "level"],
    noiseTokens: ["gameid", "normal", "damage", "level", "gold", "lp"],
  },
  {
    id: "table-results",
    hints: ["rank", "time", "round", "wins"],
    noiseTokens: ["rank", "time", "round", "wins", "losses", "lp", "damage"],
  },
];

export const GENERIC_LAYOUT_PROFILE: PlacementLayoutProfile = {
  id: "generic",
  hints: [],
  noiseTokens: [],
};

function normalizedWords(words: OcrWord[]): string[] {
  return words
    .map((word) => word.text.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter(Boolean);
}

export function detectPlacementLayoutProfile(words: OcrWord[]): PlacementLayoutProfile {
  const tokens = new Set(normalizedWords(words));
  let best: PlacementLayoutProfile | null = null;
  let bestScore = 0;

  for (const profile of PROFILE_DEFINITIONS) {
    const score = profile.hints.reduce((total, hint) => total + (tokens.has(hint) ? 1 : 0), 0);
    if (score > bestScore) {
      best = profile;
      bestScore = score;
    }
  }

  return best ?? GENERIC_LAYOUT_PROFILE;
}

export function isProfileNoise(value: string, profile: PlacementLayoutProfile): boolean {
  const normalized = value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (!normalized) return true;
  if (profile.noiseTokens.includes(normalized)) return true;
  if (/^\d{1,3}(?:lp|p)$/.test(normalized)) return true;
  if (/^\d{1,2}[-:]\d{1,2}$/.test(value.trim())) return true;
  if (/^\d{1,2}:\d{2}$/.test(value.trim())) return true;
  return false;
}

export function profileFingerprintScore(words: OcrWord[], profile: PlacementLayoutProfile): number {
  if (profile.hints.length === 0) return 0;
  const tokens = new Set(normalizedWords(words));
  return profile.hints.filter((hint) => tokens.has(hint)).length / profile.hints.length;
}
