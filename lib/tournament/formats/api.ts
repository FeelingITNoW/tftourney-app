import type {
  TournamentFormat,
  TournamentFormatOption,
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

  if (value.lobbySeeding !== "snake" && value.lobbySeeding !== "random") {
    errors.push(`${path}.lobbySeeding must be snake or random.`);
  }

  if (!Number.isInteger(value.games) || (value.games as number) <= 0) {
    errors.push(`${path}.games must be a positive whole number.`);
  }

  if (
    !Number.isInteger(value.reseed) ||
    (value.reseed as number) < 0 ||
    (Number.isInteger(value.games) && (value.reseed as number) > (value.games as number))
  ) {
    errors.push(`${path}.reseed must be between 0 and games.`);
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
    } else if (
      value.winCondition.type !== "highest_points_after_games" ||
      value.winCondition.rankingMetric !== "points"
    ) {
      errors.push(`${path}.winCondition is invalid.`);
    } else if (
      !Number.isInteger(value.winCondition.games) ||
      (value.winCondition.games as number) <= 0 ||
      (Number.isInteger(value.games) &&
        (value.winCondition.games as number) !== (value.games as number))
    ) {
      errors.push(`${path}.winCondition.games must equal games.`);
    }
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
    value.rounds.forEach((round, index) => {
      if (!isRecord(round) || !isRecord(round.advancement)) {
        return;
      }

      const destinationRoundId = round.advancement.destinationRoundId;
      if (typeof destinationRoundId === "string" && !roundIds.has(destinationRoundId)) {
        errors.push(`rounds[${index}].advancement.destinationRoundId must reference a round.`);
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
