"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePlayer } from "@/lib/auth/player-session";
import {
  changePlayerEmail,
  changePlayerPassword,
  claimPlayerAccountCredentials,
  linkRiotToPlayerAccount,
  PlayerAccountValidationError,
  unlinkDiscordFromPlayerAccount,
} from "@/lib/players/accounts";

const ACCOUNT_PATH = "/player/account";

function getFormString(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value : "";
}

function redirectWithParams(params: Record<string, string>): never {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== "") searchParams.set(key, value);
  }
  const query = searchParams.toString();
  redirect(query ? `${ACCOUNT_PATH}?${query}` : ACCOUNT_PATH);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof PlayerAccountValidationError) {
    return Object.values(error.errors).find((value) => typeof value === "string") ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

// Lets a credential-less (bot-created, Discord-only) account set a username
// and password for the first time.
export async function claimPlayerCredentialsAction(formData: FormData): Promise<void> {
  const player = await requirePlayer(ACCOUNT_PATH);
  const username = getFormString(formData, "username");
  const password = getFormString(formData, "password");
  const confirmPassword = getFormString(formData, "confirmPassword");
  const email = getFormString(formData, "email");
  try {
    await claimPlayerAccountCredentials({
      playerAccountId: player.playerAccountId,
      username,
      password,
      confirmPassword,
      email,
    });
  } catch (error) {
    redirectWithParams({ accountError: errorMessage(error, "Your account could not be updated.") });
  }
  revalidatePath(ACCOUNT_PATH);
  redirectWithParams({ accountUpdated: "credentials" });
}

export async function changePasswordAction(formData: FormData): Promise<void> {
  const player = await requirePlayer(ACCOUNT_PATH);
  const currentPassword = getFormString(formData, "currentPassword");
  const newPassword = getFormString(formData, "newPassword");
  const confirmNewPassword = getFormString(formData, "confirmNewPassword");
  try {
    await changePlayerPassword({
      playerAccountId: player.playerAccountId,
      currentPassword,
      newPassword,
      confirmNewPassword,
    });
  } catch (error) {
    redirectWithParams({ accountError: errorMessage(error, "Your password could not be changed.") });
  }
  redirectWithParams({ accountUpdated: "password" });
}

export async function changeEmailAction(formData: FormData): Promise<void> {
  const player = await requirePlayer(ACCOUNT_PATH);
  const email = getFormString(formData, "email");
  try {
    await changePlayerEmail({ playerAccountId: player.playerAccountId, email: email || null });
  } catch (error) {
    redirectWithParams({ accountError: errorMessage(error, "Your email could not be updated.") });
  }
  revalidatePath(ACCOUNT_PATH);
  redirectWithParams({ accountUpdated: "email" });
}

export async function linkRiotAccountAction(formData: FormData): Promise<void> {
  const player = await requirePlayer(ACCOUNT_PATH);
  const gameTag = getFormString(formData, "gameTag");
  try {
    await linkRiotToPlayerAccount({ playerAccountId: player.playerAccountId, gameTag });
  } catch (error) {
    redirectWithParams({ accountError: errorMessage(error, "That Riot account could not be linked.") });
  }
  revalidatePath(ACCOUNT_PATH);
  redirectWithParams({ accountUpdated: "riot" });
}

export async function unlinkDiscordAccountAction(): Promise<void> {
  const player = await requirePlayer(ACCOUNT_PATH);
  try {
    await unlinkDiscordFromPlayerAccount(player.playerAccountId);
  } catch (error) {
    redirectWithParams({ accountError: errorMessage(error, "Discord could not be unlinked.") });
  }
  revalidatePath(ACCOUNT_PATH);
  redirectWithParams({ accountUpdated: "discord-unlinked" });
}
