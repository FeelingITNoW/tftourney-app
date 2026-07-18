"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import defaultTournamentFormat from "@/lib/tournament/formats/default.json";
import {
  createTournament,
  deleteTournament,
  randomizePendingLobbyResults,
  registerTournamentPlayer,
  progressTournamentRound,
  startTournament,
  updateLobbyResults,
} from "@/lib/db/tournaments/api";
import { getRiotAccountByRiotId } from "@/lib/riot/accounts/api";
import { validatePlayerRegistration } from "@/lib/tournament/players/api";
import { validateLobbyResults } from "@/lib/tournament/scoring/api";
import { validateTournamentCreation } from "@/lib/tournament/validation/api";

function getFormString(formData: FormData, fieldName: string): string {
  const value = formData.get(fieldName);

  return typeof value === "string" ? value : "";
}

function getFormStrings(formData: FormData, fieldName: string): string[] {
  return formData
    .getAll(fieldName)
    .map((value) => (typeof value === "string" ? value : ""));
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

export async function updateLobbyScoresAction(formData: FormData) {
  const tournamentId = getFormString(formData, "tournamentId");
  const lobbyId = getFormString(formData, "lobbyId");
  const detailPath = `/tournaments/${tournamentId}`;
  const lobbyPath = `${detailPath}/lobbies/${lobbyId}`;
  const currentRoundPath = `${detailPath}/rounds/current`;

  if (!tournamentId || !lobbyId) {
    redirectWithParams(detailPath, {
      scoreError: "Lobby was not found.",
    });
  }

  const participantIds = getFormStrings(formData, "participantId");
  const placements = getFormStrings(formData, "placement");
  const returnGame = getFormString(formData, "returnGame");
  const returnPage = getFormString(formData, "returnPage");
  const returnParams = {
    game: returnGame,
    page: returnPage,
  };

  if (participantIds.length !== placements.length) {
    redirectWithParams(lobbyPath, {
      scoreError: "Submit one placement for every lobby player.",
      ...returnParams,
    });
  }

  const validation = validateLobbyResults(
    participantIds.map((participantId, index) => ({
      participantId,
      placement: placements[index] ?? "",
    })),
  );

  if (!validation.success) {
    redirectWithParams(lobbyPath, {
      scoreError: validation.error,
      ...returnParams,
    });
  }

  try {
    await updateLobbyResults({
      tournamentId,
      lobbyId,
      results: validation.data,
    });
  } catch (error) {
    redirectWithParams(lobbyPath, {
      scoreError:
        error instanceof Error
          ? error.message
          : "Lobby scores could not be updated.",
      ...returnParams,
    });
  }

  revalidatePath(detailPath);
  revalidatePath(currentRoundPath);
  revalidatePath(lobbyPath);
  revalidatePath(`${detailPath}/lobbies`, "layout");
  redirectWithParams(lobbyPath, { saved: "true", ...returnParams });
}

export async function randomizePendingLobbyResultsAction(formData: FormData) {
  const tournamentId = getFormString(formData, "tournamentId");
  const returnGame = getFormString(formData, "game");
  const returnPage = getFormString(formData, "page");
  const detailPath = `/tournaments/${tournamentId}`;
  const returnParams = {
    game: returnGame,
    page: returnPage,
  };

  if (!tournamentId) {
    redirectWithParams("/", {
      createError: "Tournament was not found.",
    });
  }

  try {
    await randomizePendingLobbyResults({ tournamentId });
  } catch (error) {
    redirectWithParams(detailPath, {
      progressionError:
        error instanceof Error
          ? error.message
          : "Lobby results could not be randomized.",
      ...returnParams,
    });
  }

  revalidatePath("/");
  revalidatePath(detailPath);
  revalidatePath(`${detailPath}/lobbies`, "layout");
  redirectWithParams(detailPath, { randomized: "true", ...returnParams });
}

export async function progressTournamentRoundAction(formData: FormData) {
  const tournamentId = getFormString(formData, "tournamentId");
  const detailPath = `/tournaments/${tournamentId}`;

  if (!tournamentId) {
    redirectWithParams("/", {
      createError: "Tournament was not found.",
    });
  }

  try {
    await progressTournamentRound({ tournamentId });
  } catch (error) {
    redirectWithParams(detailPath, {
      progressionError:
        error instanceof Error
          ? error.message
          : "The tournament round could not be progressed.",
    });
  }

  revalidatePath("/");
  revalidatePath(detailPath);
  revalidatePath(`${detailPath}/lobbies`, "layout");
  redirectWithParams(detailPath, { progressed: "true" });
}
