import type { VerifiedRiotAccount } from "@/lib/riot/accounts/types";
import type { TournamentStartRequirement } from "@/lib/tournament/formats/types";

export type TournamentStatus =
  | "accepting_players"
  | "in_progress"
  | "completed"
  | "cancelled";

export type TournamentProgressionAction =
  | "create_next_round"
  | "complete_tournament"
  | null;

export type TournamentRoundProgress = {
  roundFormat: "fixed_games" | "checkmate";
  completedGames: number;
  configuredGames: number | null;
  checkmateThreshold: number | null;
  maxGames: number | null;
  decisiveGame: number | null;
  winnerParticipantId: string | null;
  currentBlockStartGame: number | null;
  currentBlockEndGame: number | null;
  nextReseedGame: number | null;
  isComplete: boolean;
};

export type TournamentNextRoundMetadata = {
  roundNumber: number;
  roundName: string;
  destinationRoundId: string;
  advancementCount: number;
};

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
  roundSeedNumber: number;
  roundId: string;
  score: number;
  createdAt: string;
};

export type TournamentGameScore = {
  participantId: string;
  displayName: string;
  seedNumber: number;
  roundId: string;
  gameNumber: number;
  placement: number | null;
  score: number | null;
};

export type TournamentRound = {
  id: string;
  roundNumber: number;
};

export type TournamentLobbyParticipant = {
  id: string;
  displayName: string;
  seedNumber: number;
  roundSeedNumber: number;
  slotNumber: number;
  placement: number | null;
  points: number | null;
  resultStatus: "pending" | "confirmed" | "corrected" | "disputed";
};

export type TournamentLobby = {
  id: string;
  roundId: string;
  gameNumber: number;
  lobbyNumber: number;
  participants: TournamentLobbyParticipant[];
};

export type TournamentDetail = Omit<
  TournamentSummary,
  "registeredPlayerCount"
> & {
  startRequirement: TournamentStartRequirement;
  registrations: TournamentRegistration[];
  participants: TournamentParticipant[];
  rounds: TournamentRound[];
  lobbies: TournamentLobby[];
  gameScores: TournamentGameScore[];
  scores: TournamentScore[];
  roundProgress: TournamentRoundProgress | null;
  nextRound: TournamentNextRoundMetadata | null;
  progressionAction: TournamentProgressionAction;
};

export type TournamentRow = {
  id: string | number;
  name: string;
  max_players: number;
  format_id: string;
  status: TournamentStatus;
  current_round_id: string | number | null;
  format_config: unknown;
  created_at: string;
};

export type TournamentRegistrationRow = {
  id: string | number;
  tournament_id: string | number;
  display_name: string | null;
  riot_puuid: string | null;
  created_at: string;
};

export type TournamentParticipantRow = {
  id: string;
  tournament_id: string | number;
  registration_id: string | number;
  seed_number: number;
  display_name_at_start: string;
  created_at: string;
};

export type TournamentScoreRow = {
  id: string;
  participant_id: string;
  round_id: string | number;
  round_seed_number: number;
  score: number;
  created_at: string;
};

export type TournamentRoundRow = {
  id: string | number;
  round_number: number;
  format_round_id: string | null;
  status: "pending" | "active" | "completed" | "cancelled";
};

export type TournamentLobbyRow = {
  id: string | number;
  round_id: string | number;
  game_number: number;
  lobby_number: number;
};

export type TournamentLobbyParticipantRow = {
  id: string | number;
  lobby_id: string | number;
  participant_id: string;
  slot_number: number;
  placement: number | null;
  points: number | null;
  result_status: "pending" | "confirmed" | "corrected" | "disputed";
};

export type StartTournamentResult = {
  started_tournament_id: string;
  started_entrant_count: number;
  started_round_id: string;
  started_round_number: number;
};

export type CreateTournamentInput = {
  name: string;
  playerCount: number;
  formatId: string;
  formatConfig: unknown;
};

export type DeleteTournamentInput = {
  tournamentId: string;
};

export type RegisterTournamentPlayerInput = {
  tournamentId: string;
  riotAccount: VerifiedRiotAccount;
};

export type StartTournamentInput = {
  tournamentId: string;
};

export type LobbyResultInput = {
  participantId: string;
  placement: number;
};

export type UpdateLobbyResultsInput = {
  tournamentId: string;
  lobbyId: string;
  results: LobbyResultInput[];
};

export type UpdateLobbyResultsResult = {
  updated_lobby_id: string;
  updated_participant_count: number;
};

export type RandomizePendingLobbyResultsResult = {
  randomized_lobby_count: number;
  randomized_participant_count: number;
};

export type ProgressTournamentRoundInput = {
  tournamentId: string;
};

export type ProgressTournamentRoundResult = {
  transition_type: "round_created" | "tournament_completed";
  completed_round_id: string;
  new_round_id: string | null;
  advanced_player_count: number;
};
