"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { PLAYER_SESSION_COOKIE_NAME, requirePlayer } from "@/lib/auth/player-session";
import {
  PLAYER_PENDING_DISCORD_COOKIE,
  PLAYER_PENDING_DISCORD_COOKIE_PATH,
  readPendingPlayerDiscordToken,
} from "@/lib/auth/player-discord-oauth";
import { checkInPlayerForTournament, registerPlayerAccountForTournament } from "@/lib/players/registration";
import {
  PlayerAccountValidationError,
  signInPlayerAccount,
  signUpPlayerAccount,
  type PlayerAuthResult,
} from "@/lib/players/accounts";

function getFormString(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value : "";
}

async function setPlayerSessionCookie(auth: PlayerAuthResult): Promise<void> {
  (await cookies()).set(PLAYER_SESSION_COOKIE_NAME, auth.sessionToken, auth.sessionCookie);
}

async function clearPendingDiscordCookie(): Promise<void> {
  (await cookies()).set(PLAYER_PENDING_DISCORD_COOKIE, "", { maxAge: 0, path: PLAYER_PENDING_DISCORD_COOKIE_PATH });
}

function redirectWithParams(path: string, params: Record<string, string>): never {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== "") searchParams.set(key, value);
  }
  const query = searchParams.toString();
  redirect(query ? `${path}?${query}` : path);
}

// Signs the currently signed-in player up for a tournament. Their stored Riot
// identity is reused when present; otherwise the supplied GameName#TAG is
// verified against Riot and linked first (see registerPlayerAccountForTournament).
export async function signUpForTournamentAction(formData: FormData): Promise<void> {
  const tournamentId = getFormString(formData, "tournamentId");
  const gameTag = getFormString(formData, "gameTag");
  const returnTo = "/player";
  if (!tournamentId) {
    redirectWithParams(returnTo, { playerError: "Tournament was not found." });
  }
  const player = await requirePlayer(returnTo);
  try {
    await registerPlayerAccountForTournament({
      playerAccountId: player.playerAccountId,
      tournamentId,
      gameTag: gameTag || null,
    });
  } catch (error) {
    redirectWithParams(returnTo, {
      playerError: error instanceof Error ? error.message : "Sign-up could not be completed.",
    });
  }
  revalidatePath(returnTo);
  redirectWithParams(returnTo, { playerSignedUp: tournamentId });
}

// Checks the currently signed-in player into a tournament using their durable
// account id -- the web counterpart to the Discord bot's check-in button, for
// a player who registered without linking Discord (see
// checkInPlayerForTournament / check_in_player_account).
export async function checkInForTournamentAction(formData: FormData): Promise<void> {
  const tournamentId = getFormString(formData, "tournamentId");
  const returnTo = "/player";
  if (!tournamentId) {
    redirectWithParams(returnTo, { playerError: "Tournament was not found." });
  }
  const player = await requirePlayer(returnTo);
  try {
    await checkInPlayerForTournament({ playerAccountId: player.playerAccountId, tournamentId });
  } catch (error) {
    redirectWithParams(returnTo, {
      playerError: error instanceof Error ? error.message : "Check-in could not be completed.",
    });
  }
  revalidatePath(returnTo);
  redirectWithParams(returnTo, { playerCheckedIn: tournamentId });
}

function signupErrorParams(error: unknown): Record<string, string> {
  if (error instanceof PlayerAccountValidationError) {
    const params: Record<string, string> = {};
    if (error.errors.username) params.usernameError = error.errors.username;
    if (error.errors.password) params.passwordError = error.errors.password;
    if (error.errors.confirmPassword) params.confirmPasswordError = error.errors.confirmPassword;
    if (error.errors.email) params.emailError = error.errors.email;
    return params;
  }
  return { formError: error instanceof Error ? error.message : "Your account could not be created." };
}

// Creates a new player account from a username/password (email optional). If
// the player arrived here from "Sign in with Discord" with no matching
// account, the pending-Discord cookie set by the OAuth callback is consumed
// so the Discord identity is attached at creation time.
export async function signUpPlayerAccountAction(formData: FormData): Promise<void> {
  const username = getFormString(formData, "username");
  const password = getFormString(formData, "password");
  const confirmPassword = getFormString(formData, "confirmPassword");
  const email = getFormString(formData, "email");
  const returnTo = getFormString(formData, "returnTo") || "/player";

  const pendingToken = (await cookies()).get(PLAYER_PENDING_DISCORD_COOKIE)?.value;
  const pendingDiscord = readPendingPlayerDiscordToken(pendingToken);

  let auth: PlayerAuthResult;
  try {
    auth = await signUpPlayerAccount({ username, password, confirmPassword, email, pendingDiscord });
  } catch (error) {
    redirectWithParams("/player/signup", { ...signupErrorParams(error), returnTo });
  }
  await setPlayerSessionCookie(auth);
  await clearPendingDiscordCookie();
  redirect(returnTo);
}

// Signs an existing player in with username/password.
export async function signInPlayerAccountAction(formData: FormData): Promise<void> {
  const username = getFormString(formData, "username");
  const password = getFormString(formData, "password");
  const returnTo = getFormString(formData, "returnTo") || "/player";

  let auth: PlayerAuthResult;
  try {
    auth = await signInPlayerAccount({ username, password });
  } catch {
    redirectWithParams("/player/signin", {
      playerAuthError: "invalid_credentials",
      returnTo,
    });
  }
  await setPlayerSessionCookie(auth);
  redirect(returnTo);
}

export async function signOutPlayerAction(): Promise<void> {
  (await cookies()).set(PLAYER_SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  redirect("/");
}