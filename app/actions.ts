"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import defaultTournamentFormat from "@/lib/tournament/formats/default.json";
import {
  createTournament,
  deleteTournament,
  registerTournamentPlayer,
  startTournament,
} from "@/lib/db/tournaments/api";
import { getRiotAccountByRiotId } from "@/lib/riot/accounts/api";
import { validatePlayerRegistration } from "@/lib/tournament/players/api";
import { validateTournamentCreation } from "@/lib/tournament/validation/api";

function getFormString(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName);

  return typeof value === "string" ? value : "";
}

function redirectWithParams(path: string, params: Record<string, string>): never {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== "") {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();

  redirect(query ? `${path}?${query}` : path);
}

export async function createTournamentAction(formData: FormData) {
  const input = {
    name: getFormString(formData, "tournamentName"),
    playerCount: getFormString(formData, "playerCount"),
    formatId: getFormString(formData, "formatId"),
  };
  const validation = validateTournamentCreation(input);

  if (!validation.success) {
    redirectWithParams("/", {
      tournamentName: input.name,
      playerCount: input.playerCount,
      formatId: input.formatId,
      createError: Object.values(validation.errors)[0] ?? "Invalid tournament.",
    });
  }

  let tournamentId: string;

  try {
    const tournament = await createTournament({
      name: validation.data.name,
      playerCount: validation.data.playerCount,
      formatId: validation.data.formatId,
      formatConfig: defaultTournamentFormat,
    });
    tournamentId = tournament.id;
  } catch (error) {
    redirectWithParams("/", {
      tournamentName: input.name,
      playerCount: input.playerCount,
      formatId: input.formatId,
      createError:
        error instanceof Error
          ? error.message
          : "Tournament could not be created.",
    });
  }

  revalidatePath("/");
  redirect(`/tournaments/${tournamentId}`);
}

export async function registerPlayerAction(formData: FormData) {
  const tournamentId = getFormString(formData, "tournamentId");
  const input = {
    gameTag: getFormString(formData, "gameTag"),
  };
  const validation = validatePlayerRegistration(input);
  const detailPath = `/tournaments/${tournamentId}`;

  if (!tournamentId) {
    redirectWithParams("/", {
      createError: "Tournament was not found.",
    });
  }

  if (!validation.success) {
    redirectWithParams(detailPath, {
      registrationError:
        validation.errors.gameTag ?? "Player could not be registered.",
    });
  }

  try {
    const riotAccount = await getRiotAccountByRiotId({
      gameName: validation.data.gameName,
      tagLine: validation.data.tagLine,
    });

    await registerTournamentPlayer({
      tournamentId,
      riotAccount,
    });
  } catch (error) {
    redirectWithParams(detailPath, {
      registrationError:
        error instanceof Error ? error.message : "Player could not be registered.",
    });
  }

  revalidatePath(detailPath);
  redirect(detailPath);
}

export async function startTournamentAction(formData: FormData) {
  const tournamentId = getFormString(formData, "tournamentId");
  const detailPath = `/tournaments/${tournamentId}`;

  if (!tournamentId) {
    redirectWithParams("/", {
      createError: "Tournament was not found.",
    });
  }

  try {
    await startTournament({ tournamentId });
  } catch (error) {
    redirectWithParams(detailPath, {
      startError:
        error instanceof Error ? error.message : "Tournament could not be started.",
    });
  }

  revalidatePath("/");
  revalidatePath(detailPath);
  redirect(detailPath);
}

export async function deleteTournamentAction(formData: FormData) {
  const tournamentId = getFormString(formData, "tournamentId");
  const confirmation = getFormString(formData, "deleteConfirmation");
  const detailPath = `/tournaments/${tournamentId}`;

  if (!tournamentId) {
    redirectWithParams("/", {
      createError: "Tournament was not found.",
    });
  }

  if (confirmation !== "DELETE") {
    redirectWithParams(detailPath, {
      deleteError: "Type DELETE exactly to confirm tournament deletion.",
    });
  }

  try {
    await deleteTournament({ tournamentId });
  } catch (error) {
    redirectWithParams(detailPath, {
      deleteError:
        error instanceof Error ? error.message : "Tournament could not be deleted.",
    });
  }

  revalidatePath("/");
  revalidatePath(detailPath);
  redirect("/");
}
