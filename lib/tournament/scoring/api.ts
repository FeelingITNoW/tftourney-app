import type {
  LobbyResultFormEntry,
  LobbyResultValidation,
  ScoredStanding,
} from "./types";

const WHOLE_NUMBER_PATTERN = /^\d+$/;

export function validateLobbyResults(
  entries: LobbyResultFormEntry[],
): LobbyResultValidation {
  if (entries.length === 0) {
    return {
      success: false,
      error: "The lobby does not contain any players.",
    };
  }

  const participantIds = new Set<string>();
  const placements = new Set<number>();
  const validatedResults = [];

  for (const entry of entries) {
    if (!entry.participantId || participantIds.has(entry.participantId)) {
      return {
        success: false,
        error: "Each lobby player must appear exactly once.",
      };
    }

    if (!WHOLE_NUMBER_PATTERN.test(entry.placement)) {
      return {
        success: false,
        error: "Every placement must be a whole number.",
      };
    }

    const placement = Number(entry.placement);

    if (placement < 1 || placement > entries.length) {
      return {
        success: false,
        error: `Placements must be between 1 and ${entries.length}.`,
      };
    }

    if (placements.has(placement)) {
      return {
        success: false,
        error: "Each player must have a unique placement.",
      };
    }

    participantIds.add(entry.participantId);
    placements.add(placement);
    validatedResults.push({
      participantId: entry.participantId,
      placement,
    });
  }

  return {
    success: true,
    data: validatedResults,
  };
}

export function sortScoresHighestFirst<TScore extends ScoredStanding>(
  scores: TScore[],
): TScore[] {
  return [...scores].sort(
    (firstScore, secondScore) =>
      secondScore.score - firstScore.score ||
      firstScore.seedNumber - secondScore.seedNumber ||
      firstScore.displayName.localeCompare(secondScore.displayName),
  );
}
