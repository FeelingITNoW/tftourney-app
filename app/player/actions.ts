"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePlayer } from "@/lib/auth/player-session";
import { registerPlayerAccountForTournament } from "@/lib/players/registration";

function getFormString(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName);
  return typeof value === "string" ? value : "";
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