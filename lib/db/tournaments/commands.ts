import {
  DatabaseRequestError,
  supabaseRestRequest,
} from "../supabase-rest/api";
import type {
  CreateTournamentInput,
  DeleteTournamentInput,
  RegisterTournamentPlayerInput,
  SubmitLobbyResultsInput,
  SubmitLobbyResultsResult,
  StartTournamentInput,
  StartTournamentResult,
  TournamentRegistration,
  TournamentRegistrationRow,
  TournamentRow,
  TournamentSummary,
  AddRandomSeededTournamentPlayersInput,
  AddRandomSeededTournamentPlayersResult,
  FinalizeTournamentNodeInput,
  FinalizeTournamentNodeResult,
  RandomizePendingLobbyResultsResult,
  RandomizePendingLobbyResultsInput,
  UpdateLobbyResultsInput,
  UpdateLobbyResultsResult,
} from "./types";
import { canonicalizeTournamentFormat } from "../../tournament/formats/api";
import {
  getRiotAccountByRiotId,
  RiotAccountNotFoundError,
} from "../../riot/accounts/api";
import { SEEDED_RIOT_IDS, selectRandomSeededRiotIds } from "../../riot/accounts/seed";
import { parseRiotGameTag } from "../../tournament/players/api";
import { mapTournamentRegistrationRow, mapTournamentRow, TOURNAMENT_STATUS_ACCEPTING_PLAYERS } from "./mappers";

const tournamentSelect =
  "id,host_user_id,name,max_players,format_id,status,current_round_id,format_config,created_at";

export async function createTournament(
  input: CreateTournamentInput,
): Promise<TournamentSummary> {
  const rows = await supabaseRestRequest<TournamentRow[]>("tournaments", {
    method: "POST",
    query: {
      select: tournamentSelect,
    },
    prefer: "return=representation",
    body: {
      host_user_id: input.hostUserId,
      name: input.name,
      max_players: input.playerCount,
      format_id: input.formatId,
      format_config: (() => {
        const canonical = canonicalizeTournamentFormat(input.formatConfig);
        if (!canonical) throw new Error("Invalid tournament format configuration.");
        return canonical;
      })(),
      status: TOURNAMENT_STATUS_ACCEPTING_PLAYERS,
    },
  });

  const tournament = rows[0];

  if (!tournament) {
    throw new Error("Database did not return the created tournament.");
  }

  return {
    ...mapTournamentRow(tournament),
    registeredPlayerCount: 0,
  };
}

export async function deleteTournament(
  input: DeleteTournamentInput,
): Promise<void> {
  const deletedTournaments = await supabaseRestRequest<
    Pick<TournamentRow, "id">[]
  >("tournaments", {
    method: "DELETE",
    query: {
      id: `eq.${input.tournamentId}`,
      select: "id",
    },
    prefer: "return=representation",
  });

  if (!deletedTournaments?.length) {
    throw new Error("Tournament was not found.");
  }
}

export async function registerTournamentPlayer(
  input: RegisterTournamentPlayerInput,
): Promise<TournamentRegistration> {
  let rows: TournamentRegistrationRow[];
  const tournaments = await supabaseRestRequest<TournamentRow[]>("tournaments", {
    query: {
      select: tournamentSelect,
      id: `eq.${input.tournamentId}`,
      limit: "1",
    },
  });
  const tournament = tournaments[0];

  if (!tournament) {
    throw new Error("Tournament was not found.");
  }

  if (tournament.status !== TOURNAMENT_STATUS_ACCEPTING_PLAYERS) {
    throw new Error("Registration is closed because the tournament has started.");
  }

  try {
    rows = await supabaseRestRequest<TournamentRegistrationRow[]>(
      "tournament_registrations",
      {
        method: "POST",
        query: {
          select: "id,tournament_id,display_name,riot_puuid,player_account_id,created_at",
        },
        prefer: "return=representation",
        body: {
          tournament_id: input.tournamentId,
          riot_puuid: input.riotAccount.puuid,
          display_name: input.riotAccount.gameTag,
          ...(input.discordUserId ? { discord_user_id: input.discordUserId } : {}),
          ...(input.playerAccountId ? { player_account_id: input.playerAccountId } : {}),
        },
      },
    );
  } catch (error) {
    if (
      error instanceof DatabaseRequestError &&
      error.code === "23505"
    ) {
      throw new Error(error.message.includes("discord_user_id")
        ? "This Discord user is already registered."
        : error.message.includes("player_account")
          ? "You are already registered for this tournament."
          : "That Riot account is already registered.");
    }

    throw error;
  }

  const player = rows[0];

  if (!player) {
    throw new Error("Database did not return the registered player.");
  }

  return mapTournamentRegistrationRow(player);
}

export async function addRandomSeededTournamentPlayers(
  input: AddRandomSeededTournamentPlayersInput,
): Promise<AddRandomSeededTournamentPlayersResult> {
  const requestedCount = Number.isFinite(input.count)
    ? Math.max(0, Math.floor(input.count))
    : 0;
  const tournaments = await supabaseRestRequest<TournamentRow[]>("tournaments", {
    query: {
      select: tournamentSelect,
      id: `eq.${input.tournamentId}`,
      limit: "1",
    },
  });
  const tournament = tournaments[0];

  if (!tournament) {
    throw new Error("Tournament was not found.");
  }

  if (tournament.status !== TOURNAMENT_STATUS_ACCEPTING_PLAYERS) {
    throw new Error("Random test players can only be added before the tournament starts.");
  }

  const registrations = await supabaseRestRequest<
    Pick<TournamentRegistrationRow, "display_name" | "riot_puuid">[]
  >("tournament_registrations", {
    query: {
      select: "display_name,riot_puuid",
      tournament_id: `eq.${input.tournamentId}`,
    },
  });
  const remainingSlots = Math.max(0, tournament.max_players - registrations.length);
  const targetCount = Math.min(requestedCount, remainingSlots);

  if (targetCount === 0) {
    return {
      requestedCount,
      addedCount: 0,
      skippedCount: 0,
      remainingSlots,
    };
  }

  const existingIds = registrations
    .map((registration) => registration.display_name)
    .filter((displayName): displayName is string => Boolean(displayName));
  const existingPuuids = new Set(
    registrations
      .map((registration) => registration.riot_puuid)
      .filter((puuid): puuid is string => Boolean(puuid)),
  );
  const candidates = selectRandomSeededRiotIds(existingIds, SEEDED_RIOT_IDS.length);
  let addedCount = 0;
  let skippedCount = 0;

  for (const candidate of candidates) {
    if (addedCount >= targetCount) {
      break;
    }

    const parsed = parseRiotGameTag(candidate);
    if (!parsed) {
      skippedCount += 1;
      continue;
    }

    let riotAccount;
    try {
      riotAccount = await getRiotAccountByRiotId({
        gameName: parsed.gameName,
        tagLine: parsed.tagLine,
      });
    } catch (error) {
      if (error instanceof RiotAccountNotFoundError) {
        skippedCount += 1;
        continue;
      }

      throw error;
    }

    if (existingPuuids.has(riotAccount.puuid)) {
      skippedCount += 1;
      continue;
    }

    try {
      await registerTournamentPlayer({
        tournamentId: input.tournamentId,
        riotAccount,
      });
      existingPuuids.add(riotAccount.puuid);
      addedCount += 1;
    } catch (error) {
      if (
        error instanceof DatabaseRequestError &&
        error.code === "23505"
      ) {
        skippedCount += 1;
        continue;
      }
      if (error instanceof Error && error.message === "That Riot account is already registered.") {
        skippedCount += 1;
        continue;
      }

      throw error;
    }
  }

  skippedCount += Math.max(0, targetCount - addedCount - skippedCount);

  return {
    requestedCount,
    addedCount,
    skippedCount,
    remainingSlots: remainingSlots - addedCount,
  };
}

export async function startTournament(
  input: StartTournamentInput,
): Promise<StartTournamentResult> {
  const rows = await supabaseRestRequest<StartTournamentResult[]>(
    "rpc/start_tournament",
    {
      method: "POST",
      body: {
        p_tournament_id: input.tournamentId,
        p_initial_assignments: input.initialAssignments ?? [],
      },
    },
  );
  const result = rows[0];

  if (!result) {
    throw new Error("Database did not return the started tournament.");
  }

  return result;
}

export async function updateLobbyResults(
  input: UpdateLobbyResultsInput,
): Promise<UpdateLobbyResultsResult> {
  const rows = await supabaseRestRequest<UpdateLobbyResultsResult[]>(
    "rpc/update_lobby_results",
    {
      method: "POST",
      body: {
        p_tournament_id: input.tournamentId,
        p_lobby_id: input.lobbyId,
        p_results: input.results.map((result) => ({
          participantId: result.participantId,
          placement: result.placement,
        })),
      },
    },
  );
  const result = rows[0];

  if (!result) {
    throw new Error("Database did not return the updated lobby.");
  }

  return result;
}

export async function submitLobbyResults(
  input: SubmitLobbyResultsInput,
): Promise<SubmitLobbyResultsResult> {
  const rows = await supabaseRestRequest<SubmitLobbyResultsResult[]>(
    "rpc/submit_lobby_results",
    {
      method: "POST",
      body: {
        p_tournament_id: input.tournamentId,
        p_lobby_id: input.lobbyId,
        p_results: input.results.map((result) => ({
          participantId: result.participantId,
          placement: result.placement,
        })),
        p_idempotency_key: input.idempotencyKey ?? null,
        p_source: input.source ?? "web",
        p_submission_id: input.submissionId ?? null,
        p_mode: input.mode ?? "record",
      },
    },
  );
  const result = rows[0];
  if (!result) throw new Error("Database did not return the submitted lobby.");
  return result;
}

export async function randomizePendingLobbyResults(
  input: RandomizePendingLobbyResultsInput,
): Promise<RandomizePendingLobbyResultsResult> {
  const rows = await supabaseRestRequest<RandomizePendingLobbyResultsResult[]>("rpc/randomize_pending_lobby_results", {
    method: "POST",
    body: { p_tournament_id: input.tournamentId, p_node_id: input.nodeId },
  });
  const result = rows[0];

  if (!result) {
    throw new Error("Database did not return randomized lobby results.");
  }

  return result;
}

export async function finalizeTournamentNode(
  input: FinalizeTournamentNodeInput,
): Promise<FinalizeTournamentNodeResult> {
  const rows = await supabaseRestRequest<FinalizeTournamentNodeResult[]>(
    "rpc/finalize_tournament_node",
    {
      method: "POST",
      body: {
        p_tournament_id: input.tournamentId,
        p_node_id: input.nodeId,
      },
    },
  );
  const result = rows[0];
  if (!result) throw new Error("Database did not return the node transition.");
  return result;
}
