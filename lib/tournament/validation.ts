export type TournamentCreationInput = {
  name: string;
  playerCount: string | number;
};

export type TournamentCreationData = {
  name: string;
  playerCount: number;
};

export type TournamentCreationErrors = Partial<
  Record<keyof TournamentCreationInput, string>
>;

export type TournamentCreationValidation =
  | {
      success: true;
      data: TournamentCreationData;
      errors: TournamentCreationErrors;
    }
  | {
      success: false;
      data: null;
      errors: TournamentCreationErrors;
    };

export const TOURNAMENT_NAME_MIN_LENGTH = 3;
export const TOURNAMENT_NAME_MAX_LENGTH = 80;
export const MIN_TOURNAMENT_PLAYERS = 8;
export const MAX_TOURNAMENT_PLAYERS = 512;
export const PLAYERS_PER_TFT_LOBBY = 8;

const tournamentNamePattern = /^[A-Za-z0-9][A-Za-z0-9 ._:'&-]*$/;

export function isValidTournamentName(name: string): boolean {
  const normalizedName = name.trim().replace(/\s+/g, " ");

  return (
    normalizedName.length >= TOURNAMENT_NAME_MIN_LENGTH &&
    normalizedName.length <= TOURNAMENT_NAME_MAX_LENGTH &&
    tournamentNamePattern.test(normalizedName)
  );
}

export function isValidTournamentPlayerCount(playerCount: number): boolean {
  return (
    Number.isInteger(playerCount) &&
    playerCount >= MIN_TOURNAMENT_PLAYERS &&
    playerCount <= MAX_TOURNAMENT_PLAYERS &&
    playerCount % PLAYERS_PER_TFT_LOBBY === 0
  );
}

export function validateTournamentCreation(
  input: TournamentCreationInput,
): TournamentCreationValidation {
  const errors: TournamentCreationErrors = {};
  const normalizedName = input.name.trim().replace(/\s+/g, " ");
  const parsedPlayerCount =
    typeof input.playerCount === "number"
      ? input.playerCount
      : Number(input.playerCount);

  if (!isValidTournamentName(normalizedName)) {
    errors.name =
      "Use 3-80 characters and start with a letter or number. Allowed punctuation: . _ : ' & -";
  }

  if (!isValidTournamentPlayerCount(parsedPlayerCount)) {
    errors.playerCount =
      "Player count must be a whole number from 8 to 512 and divisible by 8.";
  }

  if (Object.keys(errors).length > 0) {
    return {
      success: false,
      data: null,
      errors,
    };
  }

  return {
    success: true,
    data: {
      name: normalizedName,
      playerCount: parsedPlayerCount,
    },
    errors: {},
  };
}
