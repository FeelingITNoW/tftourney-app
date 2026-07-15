import type {
  PlayerRegistrationData,
  PlayerRegistrationErrors,
  PlayerRegistrationInput,
  PlayerRegistrationValidation,
} from "./types";

export const RIOT_GAME_TAG_MIN_LENGTH = 5;
export const RIOT_GAME_TAG_MAX_LENGTH = 80;

const riotTagLinePattern = /^[A-Za-z0-9]{2,8}$/;

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

export function parseRiotGameTag(gameTag: string): PlayerRegistrationData | null {
  const normalizedGameTag = gameTag.trim();
  const separatorIndex = normalizedGameTag.lastIndexOf("#");

  if (separatorIndex <= 0 || separatorIndex === normalizedGameTag.length - 1) {
    return null;
  }

  const gameName = normalizedGameTag.slice(0, separatorIndex).trim();
  const tagLine = normalizedGameTag.slice(separatorIndex + 1).trim();

  if (
    normalizedGameTag.length < RIOT_GAME_TAG_MIN_LENGTH ||
    normalizedGameTag.length > RIOT_GAME_TAG_MAX_LENGTH ||
    gameName.length === 0 ||
    tagLine.length === 0 ||
    gameName.includes("#") ||
    hasControlCharacters(gameName) ||
    hasControlCharacters(tagLine) ||
    !riotTagLinePattern.test(tagLine)
  ) {
    return null;
  }

  return {
    gameName,
    tagLine,
    gameTag: `${gameName}#${tagLine}`,
  };
}

export function validatePlayerRegistration(
  input: PlayerRegistrationInput,
): PlayerRegistrationValidation {
  const errors: PlayerRegistrationErrors = {};
  const parsedRiotGameTag = parseRiotGameTag(input.gameTag);

  if (!parsedRiotGameTag) {
    errors.gameTag = "Enter a Riot ID in GameName#TAG format.";
    return {
      success: false,
      data: null,
      errors,
    };
  }

  return {
    success: true,
    data: parsedRiotGameTag,
    errors: {},
  };
}
