import {
  DatabaseRequestError,
  supabaseRestRequest,
} from "../supabase-rest/api";
import type {
  CreateTournamentInput,
  DeleteTournamentInput,
  RegisterTournamentPlayerInput,
  StartTournamentInput,
  StartTournamentResult,
  TournamentDetail,
  TournamentGameScore,
  TournamentLobby,
  TournamentLobbyParticipantRow,
  TournamentLobbyRow,
  TournamentParticipant,
  TournamentParticipantRow,
  TournamentRegistration,
  TournamentRegistrationRow,
  TournamentRoundRow,
  TournamentScore,
  TournamentScoreRow,
  TournamentRow,
  TournamentSummary,
  ProgressTournamentRoundInput,
  ProgressTournamentRoundResult,
  TournamentNextRoundMetadata,
  TournamentRoundProgress,
  TournamentProgressionAction,
  UpdateLobbyResultsInput,
  UpdateLobbyResultsResult,
} from "./types";
import type { TournamentRoundFormat } from "@/lib/tournament/formats/types";

export const TOURNAMENT_STATUS_ACCEPTING_PLAYERS = "accepting_players";

const STANDARD_HOST_USER_ID = 1;

const tournamentSelect =
  "id,name,max_players,format_id,status,current_round_id,format_config,created_at";

type StoredTournamentFormat = {
  rounds?: Array<Record<string, unknown>>;
};

function getConfiguredRound(
  formatConfig: unknown,
  formatRoundId: string | null | undefined,
): TournamentRoundFormat | null {
  if (
    !formatRoundId ||
    typeof formatConfig !== "object" ||
    formatConfig === null
  ) {
    return null;
  }

  const rounds = (formatConfig as StoredTournamentFormat).rounds;
  const configuredRound = rounds?.find((round) => round.id === formatRoundId);

  if (!configuredRound) {
    return null;
  }

  return {
    ...configuredRound,
    games: Number(configuredRound.games ?? 6),
    reseed: Number(configuredRound.reseed ?? 0),
  } as unknown as TournamentRoundFormat;
}

function getRoundProgress(
  lobbies: TournamentLobby[],
  configuredRound: TournamentRoundFormat | null,
): TournamentRoundProgress | null {
  if (!configuredRound) {
    return null;
  }

  const games = new Map<number, TournamentLobby[]>();
  for (const lobby of lobbies) {
    games.set(lobby.gameNumber, [...(games.get(lobby.gameNumber) ?? []), lobby]);
  }

  const completedGameNumbers = new Set(
    [...games.entries()]
      .filter(
        ([, gameLobbies]) =>
          gameLobbies.length > 0 &&
          gameLobbies.every(
            (lobby) =>
              lobby.participants.length > 0 &&
              lobby.participants.every(
                (participant) =>
                  participant.resultStatus === "confirmed" ||
                  participant.resultStatus === "corrected",
              ),
          ),
      )
      .map(([gameNumber]) => gameNumber),
  );
  const allGamesComplete = Array.from(
    { length: configuredRound.games },
    (_, index) => index + 1,
  ).every((gameNumber) => completedGameNumbers.has(gameNumber));
  const maxGameNumber = Math.max(...games.keys(), 0);
  const blockSize =
    configuredRound.reseed > 0 ? configuredRound.reseed : configuredRound.games;
  const currentBlockStartGame = maxGameNumber
    ? Math.floor((maxGameNumber - 1) / blockSize) * blockSize + 1
    : null;
  const currentBlockEndGame = currentBlockStartGame
    ? Math.min(currentBlockStartGame + blockSize - 1, configuredRound.games)
    : null;

  return {
    completedGames: completedGameNumbers.size,
    configuredGames: configuredRound.games,
    currentBlockStartGame,
    currentBlockEndGame,
    nextReseedGame:
      currentBlockEndGame && currentBlockEndGame < configuredRound.games
        ? currentBlockEndGame + 1
        : null,
    isComplete: allGamesComplete,
  };
}

function getNextRoundMetadata(
  currentRound: TournamentRoundRow | null,
  currentFormatRound: TournamentRoundFormat | null,
  formatConfig: unknown,
): TournamentNextRoundMetadata | null {
  const advancement = currentFormatRound?.advancement;
  if (!currentRound || !advancement) {
    return null;
  }

  const destinationRound = getConfiguredRound(
    formatConfig,
    advancement.destinationRoundId,
  );
  if (!destinationRound) {
    return null;
  }

  return {
    roundNumber: currentRound.round_number + 1,
    roundName: destinationRound.name,
    destinationRoundId: advancement.destinationRoundId,
    advancementCount: advancement.count,
  };
}

function mapTournamentRow(row: TournamentRow): Omit<
  TournamentSummary,
  "registeredPlayerCount"
> {
  return {
    id: String(row.id),
    name: row.name,
    playerCount: row.max_players,
    formatId: row.format_id,
    status: row.status,
    hasStarted: row.status !== TOURNAMENT_STATUS_ACCEPTING_PLAYERS,
    currentRoundId:
      row.current_round_id === null ? null : String(row.current_round_id),
    currentRoundNumber: null,
    createdAt: row.created_at,
  };
}

function mapTournamentRegistrationRow(
  row: TournamentRegistrationRow,
): TournamentRegistration {
  return {
    id: String(row.id),
    displayName: row.display_name ?? row.riot_puuid ?? "Unknown player",
    createdAt: row.created_at,
  };
}

function mapTournamentParticipantRow(
  row: TournamentParticipantRow,
): TournamentParticipant {
  return {
    id: row.id,
    registrationId: String(row.registration_id),
    displayName: row.display_name_at_start,
    seedNumber: row.seed_number,
    createdAt: row.created_at,
  };
}

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
      host_user_id: STANDARD_HOST_USER_ID,
      name: input.name,
      max_players: input.playerCount,
      format_id: input.formatId,
      format_config: input.formatConfig,
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

export async function listTournaments(): Promise<TournamentSummary[]> {
  const tournaments = await supabaseRestRequest<TournamentRow[]>("tournaments", {
    query: {
      select: tournamentSelect,
      order: "created_at.desc",
    },
  });

  if (tournaments.length === 0) {
    return [];
  }

  const tournamentIds = tournaments.map((tournament) => tournament.id);
  const registrations = await supabaseRestRequest<
    Pick<TournamentRegistrationRow, "tournament_id">[]
  >("tournament_registrations", {
    query: {
      select: "tournament_id",
      tournament_id: `in.(${tournamentIds.join(",")})`,
    },
  });

  const playerCountByTournamentId = new Map<string, number>();

  for (const registration of registrations) {
    const tournamentId = String(registration.tournament_id);
    playerCountByTournamentId.set(
      tournamentId,
      (playerCountByTournamentId.get(tournamentId) ?? 0) + 1,
    );
  }

  const currentRoundIds = tournaments
    .map((tournament) => tournament.current_round_id)
    .filter((roundId): roundId is string | number => roundId !== null)
    .map(String);
  const rounds = currentRoundIds.length
    ? await supabaseRestRequest<Pick<TournamentRoundRow, "id" | "round_number">[]>("rounds", {
        query: {
          select: "id,round_number",
          id: `in.(${currentRoundIds.join(",")})`,
        },
      })
    : [];
  const currentRoundNumberById = new Map(
    rounds.map((round) => [String(round.id), round.round_number]),
  );

  return tournaments.map((tournament) => ({
    ...mapTournamentRow(tournament),
    currentRoundNumber:
      tournament.current_round_id === null
        ? null
        : currentRoundNumberById.get(String(tournament.current_round_id)) ?? null,
    registeredPlayerCount:
      playerCountByTournamentId.get(String(tournament.id)) ?? 0,
  }));
}

export async function getTournamentDetail(
  tournamentId: string,
): Promise<TournamentDetail | null> {
  const tournaments = await supabaseRestRequest<TournamentRow[]>("tournaments", {
    query: {
      select: tournamentSelect,
      id: `eq.${tournamentId}`,
      limit: "1",
    },
  });

  const tournament = tournaments[0];

  if (!tournament) {
    return null;
  }

  const registrations = await supabaseRestRequest<TournamentRegistrationRow[]>(
    "tournament_registrations",
    {
      query: {
        select: "id,tournament_id,display_name,riot_puuid,created_at",
        tournament_id: `eq.${tournamentId}`,
        order: "created_at.asc",
      },
    },
  );
  const participants = await supabaseRestRequest<TournamentParticipantRow[]>(
    "tournament_participants",
    {
      query: {
        select:
          "id,tournament_id,registration_id,seed_number,display_name_at_start,created_at",
        tournament_id: `eq.${tournamentId}`,
        order: "seed_number.asc",
      },
    },
  );
  const participantIds = participants.map((participant) => participant.id);
  const scores = await supabaseRestRequest<TournamentScoreRow[]>(
    "participant_round_scores",
    participantIds.length
      ? {
          query: {
            select: "id,participant_id,round_id,round_seed_number,score,created_at",
            participant_id: `in.(${participantIds.join(",")})`,
          },
        }
      : {
          query: {
            select: "id,participant_id,round_id,round_seed_number,score,created_at",
            limit: "0",
          },
        },
  );
  const rounds = await supabaseRestRequest<TournamentRoundRow[]>("rounds", {
    query: {
      select: "id,round_number,format_round_id,status",
      tournament_id: `eq.${tournamentId}`,
      order: "round_number.asc",
    },
  });
  const currentRound = rounds.find(
    (round) => String(round.id) === String(tournament.current_round_id),
  );
  const roundIds = rounds.map((round) => round.id);
  const allLobbies = roundIds.length
    ? await supabaseRestRequest<TournamentLobbyRow[]>("lobbies", {
        query: {
          select: "id,round_id,game_number,lobby_number",
          round_id: `in.(${roundIds.join(",")})`,
          order: "game_number.asc,lobby_number.asc",
        },
      })
    : [];
  const lobbies = allLobbies.filter(
    (lobby) => String(lobby.round_id) === String(tournament.current_round_id),
  );
  const lobbyIds = allLobbies.map((lobby) => lobby.id);
  const lobbyParticipants = lobbyIds.length
    ? await supabaseRestRequest<TournamentLobbyParticipantRow[]>(
        "lobby_participants",
        {
          query: {
            select:
              "id,lobby_id,participant_id,slot_number,placement,points,result_status",
            lobby_id: `in.(${lobbyIds.join(",")})`,
            order: "slot_number.asc",
          },
        },
      )
    : [];
  const participantById = new Map(
    participants.map((participant) => [
      participant.id,
      mapTournamentParticipantRow(participant),
    ]),
  );
  const lobbyById = new Map(
    allLobbies.map((lobby) => [String(lobby.id), lobby]),
  );
  const roundSeedByParticipantRound = new Map(
    scores.map((score) => [
      `${String(score.round_id)}:${score.participant_id}`,
      score.round_seed_number,
    ]),
  );
  const lobbyParticipantsByLobbyId = new Map<
    string,
    TournamentLobby["participants"]
  >();

  for (const lobbyParticipant of lobbyParticipants) {
    const participant = participantById.get(lobbyParticipant.participant_id);

    if (!participant) {
      continue;
    }

    const lobbyId = String(lobbyParticipant.lobby_id);
    const assignedParticipants =
      lobbyParticipantsByLobbyId.get(lobbyId) ?? [];
    assignedParticipants.push({
      id: participant.id,
      displayName: participant.displayName,
      seedNumber: participant.seedNumber,
      roundSeedNumber:
        roundSeedByParticipantRound.get(
          `${String(lobbyById.get(lobbyId)?.round_id ?? tournament.current_round_id)}:${participant.id}`,
        ) ?? participant.seedNumber,
      slotNumber: lobbyParticipant.slot_number,
      placement: lobbyParticipant.placement,
      points: lobbyParticipant.points,
      resultStatus: lobbyParticipant.result_status,
    });
    lobbyParticipantsByLobbyId.set(lobbyId, assignedParticipants);
  }

  const gameScores = lobbyParticipants
    .map((lobbyParticipant) => {
      const participant = participantById.get(lobbyParticipant.participant_id);
      const lobby = lobbyById.get(String(lobbyParticipant.lobby_id));

      if (!participant || !lobby) {
        return null;
      }

      return {
        participantId: participant.id,
        displayName: participant.displayName,
        seedNumber: participant.seedNumber,
        roundId: String(lobby.round_id),
        gameNumber: lobby.game_number,
        score:
          lobbyParticipant.result_status === "confirmed" ||
          lobbyParticipant.result_status === "corrected"
            ? lobbyParticipant.points
            : null,
      };
    })
    .filter((score): score is TournamentGameScore => score !== null);
  const mappedLobbies = lobbies.map((lobby) => ({
    id: String(lobby.id),
    roundId: String(lobby.round_id),
    gameNumber: lobby.game_number,
    lobbyNumber: lobby.lobby_number,
    participants: lobbyParticipantsByLobbyId.get(String(lobby.id)) ?? [],
  }));
  const currentFormatRound = getConfiguredRound(
    tournament.format_config,
    currentRound?.format_round_id,
  );
  const roundProgress = getRoundProgress(mappedLobbies, currentFormatRound);
  const nextRound = getNextRoundMetadata(
    currentRound ?? null,
    currentFormatRound,
    tournament.format_config,
  );
  const progressionAction: TournamentProgressionAction =
    tournament.status === "in_progress" && roundProgress?.isComplete
      ? nextRound
        ? "create_next_round"
        : "complete_tournament"
      : null;

  return {
    ...mapTournamentRow(tournament),
    currentRoundNumber: currentRound?.round_number ?? null,
    registrations: registrations.map(mapTournamentRegistrationRow),
    participants: participants.map(mapTournamentParticipantRow),
    rounds: rounds.map((round) => ({
      id: String(round.id),
      roundNumber: round.round_number,
    })),
    lobbies: mappedLobbies,
    gameScores,
    scores: scores
      .map((score) => {
        const participant = participantById.get(score.participant_id);

        if (!participant) {
          return null;
        }

        return {
          id: score.id,
          participantId: score.participant_id,
          displayName: participant.displayName,
          seedNumber: participant.seedNumber,
          roundId: String(score.round_id),
          roundSeedNumber: score.round_seed_number,
          score: score.score,
          createdAt: score.created_at,
        };
      })
      .filter((score): score is TournamentScore => score !== null)
      .sort((a, b) => a.seedNumber - b.seedNumber),
    roundProgress,
    nextRound,
    progressionAction,
  };
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
          select: "id,tournament_id,display_name,riot_puuid,created_at",
        },
        prefer: "return=representation",
        body: {
          tournament_id: input.tournamentId,
          riot_puuid: input.riotAccount.puuid,
          display_name: input.riotAccount.gameTag,
        },
      },
    );
  } catch (error) {
    if (
      error instanceof DatabaseRequestError &&
      error.message.includes("23505")
    ) {
      throw new Error("That Riot account is already registered.");
    }

    throw error;
  }

  const player = rows[0];

  if (!player) {
    throw new Error("Database did not return the registered player.");
  }

  return mapTournamentRegistrationRow(player);
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

export async function progressTournamentRound(
  input: ProgressTournamentRoundInput,
): Promise<ProgressTournamentRoundResult> {
  const rows = await supabaseRestRequest<ProgressTournamentRoundResult[]>(
    "rpc/progress_tournament_round",
    {
      method: "POST",
      body: {
        p_tournament_id: input.tournamentId,
      },
    },
  );
  const result = rows[0];

  if (!result) {
    throw new Error("Database did not return the round transition.");
  }

  return result;
}
