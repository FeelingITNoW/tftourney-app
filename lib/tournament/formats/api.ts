import type {
  TournamentFormat,
  TournamentFormatOption,
  TournamentStartRequirement,
  TournamentRankingMetric,
  TournamentRoundFormat,
  TournamentSortDirection,
  TournamentTieBreaker,
} from "./types";

export const DEFAULT_TOURNAMENT_FORMAT_ID = "default";

export const TOURNAMENT_FORMAT_OPTIONS: TournamentFormatOption[] = [
  {
    id: DEFAULT_TOURNAMENT_FORMAT_ID,
    name: "Default TFT Tournament Format",
  },
];

export function isValidTournamentFormatId(formatId: string): boolean {
  return TOURNAMENT_FORMAT_OPTIONS.some((format) => format.id === formatId);
}

const rankingMetrics: TournamentRankingMetric[] = [
  "points",
  "tournament_points",
  "current_round_firsts",
  "round_entry_seed",
];
const sortDirections: TournamentSortDirection[] = ["asc", "desc"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRankingMetric(value: unknown): value is TournamentRankingMetric {
  return typeof value === "string" && rankingMetrics.includes(value as TournamentRankingMetric);
}

function isSortDirection(value: unknown): value is TournamentSortDirection {
  return typeof value === "string" && sortDirections.includes(value as TournamentSortDirection);
}

function validateTieBreakers(
  value: unknown,
  path: string,
  errors: string[],
): value is TournamentTieBreaker[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return false;
  }

  value.forEach((tieBreaker, index) => {
    const tieBreakerPath = `${path}[${index}]`;

    if (!isRecord(tieBreaker) || !isRankingMetric(tieBreaker.rankingMetric)) {
      errors.push(`${tieBreakerPath}.rankingMetric is invalid.`);
    } else if (
      tieBreaker.rankingMetric !== "current_round_firsts" &&
      tieBreaker.rankingMetric !== "round_entry_seed"
    ) {
      errors.push(`${tieBreakerPath}.rankingMetric must be a tie-breaker metric.`);
    }

    if (!isRecord(tieBreaker) || !isSortDirection(tieBreaker.sortDirection)) {
      errors.push(`${tieBreakerPath}.sortDirection is invalid.`);
    }
  });

  return true;
}

function validateStandings(
  value: unknown,
  path: string,
  errors: string[],
): value is TournamentRoundFormat["standings"] {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return false;
  }

  if (!isRankingMetric(value.rankingMetric)) {
    errors.push(`${path}.rankingMetric is invalid.`);
  }

  if (!isSortDirection(value.sortDirection)) {
    errors.push(`${path}.sortDirection is invalid.`);
  }

  validateTieBreakers(value.tieBreakers, `${path}.tieBreakers`, errors);
  return true;
}

function validateRound(
  value: unknown,
  index: number,
  roundIds: Set<string>,
  errors: string[],
): value is TournamentRoundFormat {
  const path = `rounds[${index}]`;

  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return false;
  }

  if (typeof value.id !== "string" || value.id.trim() === "") {
    errors.push(`${path}.id is required.`);
  } else if (roundIds.has(value.id)) {
    errors.push(`${path}.id must be unique.`);
  } else {
    roundIds.add(value.id);
  }

  if (typeof value.name !== "string" || value.name.trim() === "") {
    errors.push(`${path}.name is required.`);
  }

  if (value.type !== undefined && value.type !== "qualifier" && value.type !== "final") {
    errors.push(`${path}.type must be qualifier or final.`);
  }

  if (value.lobbySeeding !== "snake" && value.lobbySeeding !== "random") {
    errors.push(`${path}.lobbySeeding must be snake or random.`);
  }

  validateStandings(value.standings, `${path}.standings`, errors);
  validateStandings(value.reseedStandings, `${path}.reseedStandings`, errors);

  if (value.advancement !== undefined) {
    if (!isRecord(value.advancement)) {
      errors.push(`${path}.advancement must be an object.`);
    } else {
      if (value.advancement.type !== "top_n") {
        errors.push(`${path}.advancement.type must be top_n.`);
      }
      if (!Number.isInteger(value.advancement.count) || (value.advancement.count as number) <= 0) {
        errors.push(`${path}.advancement.count must be a positive whole number.`);
      }
      if (value.advancement.rankingMetric !== "points") {
        errors.push(`${path}.advancement.rankingMetric must be points.`);
      }
      if (
        typeof value.advancement.destinationRoundId !== "string" ||
        value.advancement.destinationRoundId.trim() === ""
      ) {
        errors.push(`${path}.advancement.destinationRoundId is required.`);
      }
    }
  }

  if (value.winCondition !== undefined) {
    if (!isRecord(value.winCondition)) {
      errors.push(`${path}.winCondition must be an object.`);
    } else if (value.winCondition.type === "highest_points_after_games") {
      if (value.winCondition.rankingMetric !== "points") {
        errors.push(`${path}.winCondition.rankingMetric must be points.`);
      }
      if (
        !Number.isInteger(value.winCondition.games) ||
        (value.winCondition.games as number) <= 0
      ) {
        errors.push(`${path}.winCondition.games must be positive.`);
      }
      if (
        !Number.isInteger(value.games) ||
        (value.games as number) !== (value.winCondition.games as number)
      ) {
        errors.push(`${path}.games must equal winCondition.games.`);
      }
    } else if (value.winCondition.type === "checkmate") {
      if (value.winCondition.rankingMetric !== "points") {
        errors.push(`${path}.winCondition.rankingMetric must be points.`);
      }
      if (
        !Number.isInteger(value.winCondition.threshold) ||
        (value.winCondition.threshold as number) < 0
      ) {
        errors.push(`${path}.winCondition.threshold must be a non-negative whole number.`);
      }
      if (
        value.winCondition.maxGames !== undefined &&
        (!Number.isInteger(value.winCondition.maxGames) ||
          (value.winCondition.maxGames as number) <= 0)
      ) {
        errors.push(`${path}.winCondition.maxGames must be a positive whole number.`);
      }
      if (value.games !== undefined) {
        errors.push(`${path}.games must be omitted for checkmate rounds.`);
      }
      if (value.reseed !== 0) {
        errors.push(`${path}.reseed must be zero for checkmate rounds.`);
      }
    } else {
      errors.push(`${path}.winCondition.type is invalid.`);
    }
  }

  const isCheckmate = isRecord(value.winCondition) && value.winCondition.type === "checkmate";
  if (!isCheckmate && (!Number.isInteger(value.games) || (value.games as number) <= 0)) {
    errors.push(`${path}.games must be a positive whole number.`);
  }

  if (!Number.isInteger(value.reseed) || (value.reseed as number) < 0) {
    errors.push(`${path}.reseed must be a non-negative whole number.`);
  } else if (!isCheckmate && Number.isInteger(value.games) && (value.reseed as number) > (value.games as number)) {
    errors.push(`${path}.reseed must be between 0 and games.`);
  }

  return true;
}

export type TournamentFormatValidation =
  | { success: true; data: TournamentFormat; errors: string[] }
  | { success: false; data: null; errors: string[] };

export function validateTournamentFormat(
  value: unknown,
): TournamentFormatValidation {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { success: false, data: null, errors: ["Format must be an object."] };
  }

  if (typeof value.id !== "string" || value.id.trim() === "") {
    errors.push("Format id is required.");
  }
  if (typeof value.name !== "string" || value.name.trim() === "") {
    errors.push("Format name is required.");
  }
  if (!isRecord(value.placementPoints)) {
    errors.push("placementPoints must be an object.");
  }
  if (!Array.isArray(value.rounds) || value.rounds.length === 0) {
    errors.push("Format must define at least one round.");
  }

  const roundIds = new Set<string>();
  if (Array.isArray(value.rounds)) {
    value.rounds.forEach((round, index) => validateRound(round, index, roundIds, errors));
  }

  if (Array.isArray(value.rounds)) {
    const rounds = value.rounds as unknown[];
    value.rounds.forEach((round, index) => {
      if (!isRecord(round) || !isRecord(round.advancement)) {
        return;
      }

      const destinationRoundId = round.advancement.destinationRoundId;
      if (typeof destinationRoundId === "string" && !roundIds.has(destinationRoundId)) {
        errors.push(`rounds[${index}].advancement.destinationRoundId must reference a round.`);
      }
    });

    value.rounds.forEach((round, index) => {
      if (!isRecord(round) || !isRecord(round.winCondition) || round.winCondition.type !== "checkmate") {
        return;
      }

      const isFinal = round.type === "final" || index === rounds.length - 1;
      const incomingCounts = rounds
        .filter((candidate): candidate is Record<string, unknown> => isRecord(candidate) && isRecord(candidate.advancement))
        .filter((candidate) => (candidate.advancement as Record<string, unknown>).destinationRoundId === round.id)
        .map((candidate) => (candidate.advancement as Record<string, unknown>).count)
        .filter((count): count is number => Number.isInteger(count));

      if (!isFinal && !incomingCounts.includes(8)) {
        errors.push(`rounds[${index}].checkmate requires an eight-player round or final round.`);
      }
    });
  }

  if (errors.length > 0) {
    return { success: false, data: null, errors };
  }

  return {
    success: true,
    data: value as unknown as TournamentFormat,
    errors: [],
  };
}

export function isValidTournamentFormat(value: unknown): value is TournamentFormat {
  return validateTournamentFormat(value).success;
}

export function getTournamentStartRequirement(
  value: unknown,
): TournamentStartRequirement {
  if (!isRecord(value) || !Array.isArray(value.rounds)) {
    return { minimumEntrants: 1, exactEntrants: null };
  }

  const rounds = value.rounds.filter(isRecord);
  const hasCheckmate = rounds.some(
    (round) => isRecord(round.winCondition) && round.winCondition.type === "checkmate",
  );
  const firstRoundIsCheckmate =
    rounds.length > 0 &&
    isRecord(rounds[0]?.winCondition) &&
    rounds[0].winCondition.type === "checkmate";

  return {
    minimumEntrants: hasCheckmate ? 8 : 1,
    exactEntrants: firstRoundIsCheckmate ? 8 : null,
  };
}
