import { DatabaseRequestError, supabaseRestRequest } from "./supabase-rest";
import type { VerifiedRiotAccount } from "@/lib/riot/accounts";

export const TOURNAMENT_STATUS_ACCEPTING_PLAYERS = "accepting_players";

export type TournamentStatus =
  | typeof TOURNAMENT_STATUS_ACCEPTING_PLAYERS
  | "in_progress"
  | "completed"
  | "cancelled";

export type TournamentSummary = {
  id: string;
  name: string;
  playerCount: number;
  formatId: string;
  status: TournamentStatus;
  hasStarted: boolean;
  currentRoundId: string | null;
  currentRoundNumber: number | null;
  createdAt: string;
  registeredPlayerCount: number;
};

export type TournamentRegistration = {
  id: string;
  displayName: string;
  createdAt: string;
};

export type TournamentParticipant = {
  id: string;
  registrationId: string;
  displayName: string;
  seedNumber: number;
  createdAt: string;
};

export type TournamentScore = {
  id: string;
  participantId: string;
  displayName: string;
  seedNumber: number;
  roundId: string;
  score: number;
  createdAt: string;
};

export type TournamentDetail = Omit<
  TournamentSummary,
  "registeredPlayerCount"
> & {
  registrations: TournamentRegistration[];
  participants: TournamentParticipant[];
  scores: TournamentScore[];
};

const STANDARD_HOST_USER_ID = 1;

type TournamentRow = {
  id: string | number;
  name: string;
  max_players: number;
  format_id: string;
  status: TournamentStatus;
  current_round_id: string | number | null;
  created_at: string;
};

type TournamentRegistrationRow = {
  id: string | number;
  tournament_id: string | number;
  display_name: string | null;
  riot_puuid: string | null;
  created_at: string;
};

type TournamentParticipantRow = {
  id: string;
  tournament_id: string | number;
  registration_id: string | number;
  seed_number: number;
  display_name_at_start: string;
  created_at: string;
};

type TournamentScoreRow = {
  id: string;
  participant_id: string;
  round_id: string | number;
  score: number;
  created_at: string;
};

type TournamentRoundRow = {
  id: string | number;
  round_number: number;
};

type StartTournamentRow = {
  started_tournament_id: string;
  started_entrant_count: number;
  started_round_id: string;
  started_round_number: number;
};

const tournamentSelect =
  "id,name,max_players,format_id,status,current_round_id,created_at";

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

export async function createTournament(input: {
  name: string;
  playerCount: number;
  formatId: string;
  formatConfig: unknown;
}): Promise<TournamentSummary> {
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
    ? await supabaseRestRequest<TournamentRoundRow[]>("rounds", {
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
            select: "id,participant_id,round_id,score,created_at",
            participant_id: `in.(${participantIds.join(",")})`,
          },
        }
      : { query: { select: "id,participant_id,round_id,score,created_at", limit: "0" } },
  );
  const currentRound = tournament.current_round_id
    ? (
        await supabaseRestRequest<TournamentRoundRow[]>("rounds", {
          query: {
            select: "id,round_number",
            id: `eq.${tournament.current_round_id}`,
            limit: "1",
          },
        })
      )[0]
    : null;
  const participantById = new Map(
    participants.map((participant) => [
      participant.id,
      mapTournamentParticipantRow(participant),
    ]),
  );

  return {
    ...mapTournamentRow(tournament),
    currentRoundNumber: currentRound?.round_number ?? null,
    registrations: registrations.map(mapTournamentRegistrationRow),
    participants: participants.map(mapTournamentParticipantRow),
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
          score: score.score,
          createdAt: score.created_at,
        };
      })
      .filter((score): score is TournamentScore => score !== null)
      .sort((a, b) => a.seedNumber - b.seedNumber),
  };
}

export async function registerTournamentPlayer(input: {
  tournamentId: string;
  riotAccount: VerifiedRiotAccount;
}): Promise<TournamentRegistration> {
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

export async function startTournament(input: {
  tournamentId: string;
}): Promise<StartTournamentRow> {
  const rows = await supabaseRestRequest<StartTournamentRow[]>(
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
