"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import defaultTournamentFormat from "@/lib/tournament/formats/default.json";
import {
  createTournament,
  deleteTournament,
  addRandomSeededTournamentPlayers,
  finalizeTournamentNode,
  randomizePendingLobbyResults,
  registerTournamentPlayer,
  startTournament,
  updateLobbyResults,
  assertTournamentHost,
} from "@/lib/db/tournaments/api";
import { requireOrganizer } from "@/lib/auth/session";
import { getRiotAccountByRiotId } from "@/lib/riot/accounts/api";
import { validatePlayerRegistration } from "@/lib/tournament/players/api";
import { validateLobbyResults } from "@/lib/tournament/scoring/api";
import { validateTournamentCreation } from "@/lib/tournament/validation/api";
import {
  canonicalizeTournamentFormat,
  validateTournamentFormat,
} from "@/lib/tournament/formats/api";
import { analyzeTournamentFormat } from "@/lib/tournament/formats/presets";
import type { CustomTournamentCreationState } from "@/lib/tournament/formats/creation-state";
import { scheduleTournamentSheetSync } from "@/lib/sheets/dispatch";
import { supabaseRestRequest } from "@/lib/db/supabase-rest/api";
import {
  enqueueDiscordOutbox,
  getTournamentCheckInState,
  getTournamentDiscordConfig,
  prepareConnectedTournamentStart,
  createManagerInviteToken,
  isTournamentManager,
} from "@/lib/discord/api";

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

async function requireTournamentHost(tournamentId: string, returnTo: string): Promise<string> {
  const organizer = await requireOrganizer(returnTo);
  try {
    await assertTournamentHost(tournamentId, organizer.hostUserId);
  } catch {
    redirectWithParams(returnTo, {
      authorizationError: "Only the tournament host can manage this tournament.",
    });
  }
  return organizer.hostUserId;
}

async function requireTournamentOperator(tournamentId: string, returnTo: string): Promise<string> {
  const organizer = await requireOrganizer(returnTo);
  try {
    await assertTournamentHost(tournamentId, organizer.hostUserId);
  } catch {
    if (!(await isTournamentManager(tournamentId, organizer.hostUserId).catch(() => false))) {
      redirectWithParams(returnTo, {
        authorizationError: "Only a tournament host or appointed manager can record results.",
      });
    }
  }
  return organizer.hostUserId;
}

export async function createTournamentAction(formData: FormData) {
  const organizer = await requireOrganizer("/");
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
      hostUserId: organizer.hostUserId,
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

export async function createCustomTournamentAction(
  _previousState: CustomTournamentCreationState,
  formData: FormData,
): Promise<CustomTournamentCreationState> {
  const organizer = await requireOrganizer("/tournaments/new");
  const name = getFormString(formData, "tournamentName");
  const playerCount = getFormString(formData, "playerCount");
  const rawFormat = getFormString(formData, "formatConfig");
  const creationValidation = validateTournamentCreation({
    name,
    playerCount,
    formatId: "default",
  });

  if (!creationValidation.success) {
    return {
      message: "Fix the highlighted tournament fields.",
      fieldErrors: creationValidation.errors as Record<string, string>,
      graphErrors: [],
    };
  }

  if (rawFormat.length > 262_144) {
    return {
      message: "The format is too large to save.",
      fieldErrors: {},
      graphErrors: ["Keep the format under 256 KB."],
    };
  }

  let parsedFormat: unknown;
  try {
    parsedFormat = JSON.parse(rawFormat);
  } catch {
    return {
      message: "The format could not be read.",
      fieldErrors: {},
      graphErrors: ["The format JSON is invalid."],
    };
  }

  const formatValidation = validateTournamentFormat(parsedFormat);
  if (!formatValidation.success) {
    return {
      message: "Fix the format graph before saving.",
      fieldErrors: {},
      graphErrors: formatValidation.errors,
    };
  }

  const canonical = canonicalizeTournamentFormat(parsedFormat);
  if (!canonical) {
    return {
      message: "Fix the format graph before saving.",
      fieldErrors: {},
      graphErrors: ["The format could not be canonicalized."],
    };
  }

  const entrantCount = creationValidation.data.playerCount;
  const exactEntrants = canonical.startRequirement.exactEntrants;
  if (exactEntrants !== undefined && exactEntrants !== entrantCount) {
    return {
      message: "The player count does not match the format.",
      fieldErrors: { playerCount: `This format requires exactly ${exactEntrants} entrants.` },
      graphErrors: [],
    };
  }
  if (canonical.startRequirement.minimumEntrants > entrantCount) {
    return {
      message: "The player count does not meet the format requirement.",
      fieldErrors: {
        playerCount: `This format requires at least ${canonical.startRequirement.minimumEntrants} entrants.`,
      },
      graphErrors: [],
    };
  }

  const analysis = analyzeTournamentFormat(canonical, entrantCount);
  if (!analysis.valid) {
    return {
      message: "Fix the format graph before saving.",
      fieldErrors: {},
      graphErrors: analysis.errors,
    };
  }

  let tournamentId: string;
  try {
    const tournament = await createTournament({
      hostUserId: organizer.hostUserId,
      name: creationValidation.data.name,
      playerCount: entrantCount,
      formatId: canonical.id,
      formatConfig: canonical,
    });
    tournamentId = tournament.id;
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Tournament could not be created.",
      fieldErrors: {},
      graphErrors: [],
    };
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

  const hostUserId = await requireTournamentHost(tournamentId, detailPath);

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
    scheduleTournamentSheetSync(tournamentId, hostUserId);
  } catch (error) {
    redirectWithParams(detailPath, {
      registrationError:
        error instanceof Error ? error.message : "Player could not be registered.",
    });
  }

  revalidatePath(detailPath);
  redirect(detailPath);
}

export async function addRandomSeededPlayersAction(formData: FormData) {
  const tournamentId = getFormString(formData, "tournamentId");
  const requestedCount = Number(getFormString(formData, "randomPlayerCount"));
  const detailPath = `/tournaments/${tournamentId}`;

  if (!tournamentId) {
    redirectWithParams("/", {
      createError: "Tournament was not found.",
    });
  }

  const hostUserId = await requireTournamentHost(tournamentId, detailPath);

  if (!Number.isInteger(requestedCount) || requestedCount < 1) {
    redirectWithParams(detailPath, {
      randomPlayerError: "Choose at least one test player to add.",
    });
  }

  let result: Awaited<ReturnType<typeof addRandomSeededTournamentPlayers>>;
  try {
    result = await addRandomSeededTournamentPlayers({
      tournamentId,
      count: requestedCount,
    });
    scheduleTournamentSheetSync(tournamentId, hostUserId);
  } catch (error) {
    redirectWithParams(detailPath, {
      randomPlayerError:
        error instanceof Error
          ? error.message
          : "Random test players could not be added.",
    });
  }

  revalidatePath("/");
  revalidatePath(detailPath);
  redirectWithParams(detailPath, {
    randomPlayersAdded: String(result.addedCount),
    randomPlayersSkipped: String(result.skippedCount),
  });
}

export async function startTournamentAction(formData: FormData) {
  const tournamentId = getFormString(formData, "tournamentId");
  const detailPath = `/tournaments/${tournamentId}`;

  if (!tournamentId) {
    redirectWithParams("/", {
      createError: "Tournament was not found.",
    });
  }

  const hostUserId = await requireTournamentHost(tournamentId, detailPath);

  try {
    await prepareConnectedTournamentStart(tournamentId);
    await startTournament({ tournamentId });
    await enqueueDiscordOutbox({
      tournamentId,
      eventType: "sync_lobby_threads",
      dedupeKey: `sync_lobby_threads:start:${tournamentId}:${Date.now()}`,
      payload: { reason: "tournament_started" },
    });
    scheduleTournamentSheetSync(tournamentId, hostUserId);
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

export async function openTournamentCheckInAction(formData: FormData) {
  const tournamentId = getFormString(formData, "tournamentId");
  const detailPath = `/tournaments/${tournamentId}`;
  if (!tournamentId) redirectWithParams("/", { createError: "Tournament was not found." });
  await requireTournamentHost(tournamentId, detailPath);
  try {
    const config = await getTournamentDiscordConfig(tournamentId);
    if (!config) throw new Error("Connect this tournament to Discord before opening check-in.");
    const state = await getTournamentCheckInState(tournamentId);
    if (state?.status === "open") throw new Error("Check-in is already open.");
    await supabaseRestRequest("tournaments", {
      method: "PATCH",
      query: { id: `eq.${tournamentId}` },
      prefer: "return=minimal",
      body: { check_in_status: "open", check_in_opened_at: new Date().toISOString(), check_in_closed_at: null },
    });
    await supabaseRestRequest("tournament_registrations", {
      method: "PATCH",
      query: { tournament_id: `eq.${tournamentId}`, or: "(registration_status.eq.registered,registration_status.eq.waitlisted)" },
      prefer: "return=minimal",
      body: { checked_in_at: null },
    });
    await enqueueDiscordOutbox({ tournamentId, eventType: "checkin_opened", dedupeKey: `checkin:opened:${Date.now()}` });
  } catch (error) {
    redirectWithParams(detailPath, { checkInError: error instanceof Error ? error.message : "Check-in could not be opened." });
  }
  revalidatePath(detailPath);
  redirectWithParams(detailPath, { checkInUpdated: "opened" });
}

export async function closeTournamentCheckInAction(formData: FormData) {
  const tournamentId = getFormString(formData, "tournamentId");
  const detailPath = `/tournaments/${tournamentId}`;
  if (!tournamentId) redirectWithParams("/", { createError: "Tournament was not found." });
  await requireTournamentHost(tournamentId, detailPath);
  try {
    const state = await getTournamentCheckInState(tournamentId);
    if (!state || state.status !== "open") throw new Error("Check-in is not open.");
    await supabaseRestRequest("tournaments", {
      method: "PATCH",
      query: { id: `eq.${tournamentId}` },
      prefer: "return=minimal",
      body: { check_in_status: "closed", check_in_closed_at: new Date().toISOString() },
    });
    await enqueueDiscordOutbox({ tournamentId, eventType: "checkin_closed", dedupeKey: `checkin:closed:${Date.now()}` });
  } catch (error) {
    redirectWithParams(detailPath, { checkInError: error instanceof Error ? error.message : "Check-in could not be closed." });
  }
  revalidatePath(detailPath);
  redirectWithParams(detailPath, { checkInUpdated: "closed" });
}

export async function connectDiscordAction(formData: FormData) {
  const tournamentId = getFormString(formData, "tournamentId");
  const guildId = getFormString(formData, "guildId");
  const detailPath = `/tournaments/${tournamentId}`;
  if (!tournamentId) redirectWithParams("/", { createError: "Tournament was not found." });
  await requireTournamentHost(tournamentId, detailPath);
  if (!/^\d{5,25}$/.test(guildId)) redirectWithParams(detailPath, { discordError: "Enter a valid Discord server ID." });
  try {
    await supabaseRestRequest("tournament_discord_configs", {
      method: "POST",
      query: { on_conflict: "tournament_id" },
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { tournament_id: tournamentId, guild_id: guildId, state: "pending", last_error: null },
    });
    await enqueueDiscordOutbox({ tournamentId, eventType: "provision_tournament", dedupeKey: `provision:${guildId}:${Date.now()}`, payload: { guildId } });
  } catch (error) {
    redirectWithParams(detailPath, { discordError: error instanceof Error ? error.message : "Discord could not be connected." });
  }
  revalidatePath(detailPath);
  redirectWithParams(detailPath, { discordConnected: "true" });
}

export async function createManagerInviteAction(formData: FormData) {
  const tournamentId = getFormString(formData, "tournamentId");
  const detailPath = `/tournaments/${tournamentId}`;
  if (!tournamentId) redirectWithParams("/", { createError: "Tournament was not found." });
  await requireTournamentHost(tournamentId, detailPath);
  const invite = createManagerInviteToken();
  try {
    await supabaseRestRequest("tournament_manager_invites", {
      method: "POST",
      prefer: "return=minimal",
      body: { tournament_id: tournamentId, token_hash: invite.hash, expires_at: invite.expiresAt },
    });
  } catch (error) {
    redirectWithParams(detailPath, { discordError: error instanceof Error ? error.message : "Manager invite could not be created." });
  }
  const baseUrl = process.env.TFTOURNEY_APP_URL ?? "http://localhost:3000";
  redirectWithParams(detailPath, { managerInvite: `${baseUrl.replace(/\/$/, "")}/discord/manager-invites/${invite.token}` });
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

  await requireTournamentHost(tournamentId, detailPath);

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

  if (!tournamentId || !lobbyId) {
    redirectWithParams(detailPath, {
      scoreError: "Lobby was not found.",
    });
  }

  const hostUserId = await requireTournamentOperator(tournamentId, lobbyPath);

  const participantIds = getFormStrings(formData, "participantId");
  const placements = getFormStrings(formData, "placement");
  const returnGame = getFormString(formData, "returnGame");
  const returnPage = getFormString(formData, "returnPage");
  const returnNode = getFormString(formData, "returnNode");
  const returnParams = {
    game: returnGame,
    page: returnPage,
    node: returnNode,
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
    scheduleTournamentSheetSync(tournamentId, hostUserId);
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
  revalidatePath(lobbyPath);
  revalidatePath(`${detailPath}/lobbies`, "layout");
  redirectWithParams(lobbyPath, { saved: "true", ...returnParams });
}

export async function randomizePendingLobbyResultsAction(formData: FormData) {
  const tournamentId = getFormString(formData, "tournamentId");
  const nodeId = getFormString(formData, "nodeId");
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
  const hostUserId = await requireTournamentHost(tournamentId, detailPath);
  if (!nodeId) {
    redirectWithParams(detailPath, {
      progressionError: "Select a tournament node before randomizing results.",
    });
  }

  try {
    await randomizePendingLobbyResults({ tournamentId, nodeId });
    scheduleTournamentSheetSync(tournamentId, hostUserId);
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
  redirectWithParams(detailPath, { randomized: "true", node: nodeId, ...returnParams });
}

export async function finalizeTournamentNodeAction(formData: FormData) {
  const tournamentId = getFormString(formData, "tournamentId");
  const nodeId = getFormString(formData, "nodeId");
  const detailPath = `/tournaments/${tournamentId}`;
  if (!tournamentId || !nodeId) {
    redirectWithParams(detailPath, { progressionError: "Tournament node was not found." });
  }
  const hostUserId = await requireTournamentHost(tournamentId, detailPath);
  try {
    await finalizeTournamentNode({ tournamentId, nodeId });
    scheduleTournamentSheetSync(tournamentId, hostUserId);
  } catch (error) {
    redirectWithParams(detailPath, {
      progressionError:
        error instanceof Error ? error.message : "The tournament node could not be finalized.",
      node: nodeId,
    });
  }
  revalidatePath("/");
  revalidatePath(detailPath);
  redirectWithParams(detailPath, { progressed: "true", node: nodeId });
}
