import { DatabaseRequestError } from "../db/supabase-rest/api";
import {
  createPlayerAccount,
  findPlayerAccountByUsername,
  getPlayerAccountPasswordHashById,
  linkRiotAccountToPlayer,
  mapPlayerAccountRow,
  setPlayerCredentials,
  touchPlayerAccountLastSignedIn,
  unlinkDiscordAccountFromPlayer,
} from "../db/players/api";
import type { PlayerAccount } from "../db/players/types";
import { hashPassword, verifyPassword } from "../auth/player-credentials";
import {
  createPlayerSessionToken,
  playerSessionCookieOptions,
} from "../auth/player-session";
import type { PendingPlayerDiscordIdentity } from "../auth/player-discord-oauth";
import {
  validateOptionalEmail,
  validatePassword,
  validatePlayerSignup,
  validateUsername,
  type PlayerSignupErrors,
} from "./account-validation";
import { getRiotAccountByRiotId } from "../riot/accounts/api";
import { parseRiotGameTag } from "../tournament/players/api";

// Raised when a signup/credentials form fails validation, carrying
// field-specific errors so the form can highlight the offending input
// instead of showing one generic message.
export class PlayerAccountValidationError extends Error {
  errors: PlayerSignupErrors;
  constructor(errors: PlayerSignupErrors) {
    super(Object.values(errors)[0] ?? "That information is not valid.");
    this.name = "PlayerAccountValidationError";
    this.errors = errors;
  }
}

export type PlayerAuthResult = {
  player: PlayerAccount;
  sessionToken: string;
  sessionCookie: ReturnType<typeof playerSessionCookieOptions>;
};

function sessionForPlayer(playerAccountId: string): Pick<PlayerAuthResult, "sessionToken" | "sessionCookie"> {
  return {
    sessionToken: createPlayerSessionToken({ playerAccountId }),
    sessionCookie: playerSessionCookieOptions(),
  };
}

// Maps a raise'd Postgres exception message (embedded verbatim in the
// PostgREST error body, see registerTournamentPlayer in
// lib/db/tournaments/api.ts for the established pattern) to a clean error --
// a field error where the message maps to a form field, otherwise a plain
// Error carrying just the clean message instead of the raw PostgREST body.
function accountConflictError(error: unknown): Error | null {
  if (!(error instanceof DatabaseRequestError)) return null;
  if (error.message.includes("That username is already taken.")) {
    return new PlayerAccountValidationError({ username: "That username is already taken." });
  }
  if (error.message.includes("That email is already in use by another player.")) {
    return new PlayerAccountValidationError({ email: "That email is already in use by another player." });
  }
  if (error.message.includes("That Discord account is already linked to another player.")) {
    return new Error("That Discord account is already linked to another player.");
  }
  return null;
}

export type SignUpPlayerAccountInput = {
  username: string;
  password: string;
  confirmPassword: string;
  email?: string | null;
  /** A Discord identity to attach immediately, from the pending-signup cookie. */
  pendingDiscord?: PendingPlayerDiscordIdentity | null;
};

// Creates a brand-new player account from a username/password. This is now
// the only way an account is created from the web -- Discord sign-in alone
// no longer auto-creates one (see resolvePlayerDiscordSignIn); a Discord
// identity carried in from the OAuth callback is attached at creation time
// instead of requiring a second link step.
export async function signUpPlayerAccount(input: SignUpPlayerAccountInput): Promise<PlayerAuthResult> {
  const validation = validatePlayerSignup(input);
  if (!validation.success) throw new PlayerAccountValidationError(validation.errors);

  const passwordHash = await hashPassword(validation.data.password);
  let player: PlayerAccount;
  try {
    player = await createPlayerAccount({
      username: validation.data.username,
      passwordHash,
      email: validation.data.email,
      discordUserId: input.pendingDiscord?.discordUserId ?? null,
      discordUsername: input.pendingDiscord?.discordUsername ?? null,
      discordAvatar: input.pendingDiscord?.discordAvatar ?? null,
    });
  } catch (error) {
    throw accountConflictError(error) ?? error;
  }

  await touchPlayerAccountLastSignedIn(player.id);
  return { player, ...sessionForPlayer(player.id) };
}

// A single generic message for any sign-in failure (unknown username, wrong
// password, or a credential-less Discord-only account) -- never reveal which
// case occurred, so a failed attempt cannot be used to enumerate usernames.
const INVALID_CREDENTIALS_MESSAGE = "Incorrect username or password.";

export async function signInPlayerAccount(input: {
  username: string;
  password: string;
}): Promise<PlayerAuthResult> {
  const row = await findPlayerAccountByUsername(input.username);
  const passwordMatches = await verifyPassword(input.password, row?.password_hash ?? null);
  if (!row || !passwordMatches) {
    throw new Error(INVALID_CREDENTIALS_MESSAGE);
  }
  const player = mapPlayerAccountRow(row);
  await touchPlayerAccountLastSignedIn(player.id);
  return { player, ...sessionForPlayer(player.id) };
}

export type ClaimPlayerAccountCredentialsInput = {
  playerAccountId: string;
  username: string;
  password: string;
  confirmPassword: string;
  email?: string | null;
};

// Lets a credential-less, bot-created (Discord-only) account set a
// username/password for the first time, from /player/account.
export async function claimPlayerAccountCredentials(
  input: ClaimPlayerAccountCredentialsInput,
): Promise<PlayerAccount> {
  const validation = validatePlayerSignup(input);
  if (!validation.success) throw new PlayerAccountValidationError(validation.errors);

  const passwordHash = await hashPassword(validation.data.password);
  try {
    return await setPlayerCredentials({
      playerAccountId: input.playerAccountId,
      username: validation.data.username,
      passwordHash,
      email: validation.data.email,
    });
  } catch (error) {
    throw accountConflictError(error) ?? error;
  }
}

export type ChangePlayerPasswordInput = {
  playerAccountId: string;
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
};

export async function changePlayerPassword(input: ChangePlayerPasswordInput): Promise<PlayerAccount> {
  const currentHash = await getPlayerAccountPasswordHashById(input.playerAccountId);
  const currentMatches = await verifyPassword(input.currentPassword, currentHash);
  if (!currentMatches) {
    throw new PlayerAccountValidationError({ password: "Current password is incorrect." });
  }

  const newPassword = validatePassword(input.newPassword);
  if (!newPassword.success) {
    throw new PlayerAccountValidationError({ password: newPassword.error });
  }
  if (input.newPassword !== input.confirmNewPassword) {
    throw new PlayerAccountValidationError({ confirmPassword: "Passwords do not match." });
  }

  const passwordHash = await hashPassword(newPassword.data);
  return setPlayerCredentials({ playerAccountId: input.playerAccountId, passwordHash });
}

export async function changePlayerEmail(input: {
  playerAccountId: string;
  email: string | null;
}): Promise<PlayerAccount> {
  const email = validateOptionalEmail(input.email);
  if (!email.success) throw new PlayerAccountValidationError({ email: email.error });
  try {
    return await setPlayerCredentials({ playerAccountId: input.playerAccountId, email: email.data ?? "" });
  } catch (error) {
    throw accountConflictError(error) ?? error;
  }
}

// Re-validates a username on its own, for a field-level check before a full
// form submit. Exported for completeness/testability; forms use
// validatePlayerSignup end to end.
export { validateUsername };

export async function unlinkDiscordFromPlayerAccount(playerAccountId: string): Promise<PlayerAccount> {
  return unlinkDiscordAccountFromPlayer(playerAccountId);
}

export async function linkRiotToPlayerAccount(input: {
  playerAccountId: string;
  gameTag: string;
}): Promise<PlayerAccount> {
  const parsed = parseRiotGameTag(input.gameTag);
  if (!parsed) throw new Error("Enter a Riot ID in GameName#TAG format.");
  const account = await getRiotAccountByRiotId({ gameName: parsed.gameName, tagLine: parsed.tagLine });
  return linkRiotAccountToPlayer({
    playerAccountId: input.playerAccountId,
    puuid: account.puuid,
    gameTag: account.gameTag,
  });
}
