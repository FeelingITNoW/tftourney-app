import type { VerifiedRiotAccount } from "@/lib/riot/accounts/types";

export type TournamentStatus =
  | "accepting_players"
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

export type TournamentRow = {
  id: string | number;
  name: string;
  max_players: number;
  format_id: string;
  status: TournamentStatus;
  current_round_id: string | number | null;
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
  score: number;
  created_at: string;
};

export type TournamentRoundRow = {
  id: string | number;
  round_number: number;
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

export type RegisterTournamentPlayerInput = {
  tournamentId: string;
  riotAccount: VerifiedRiotAccount;
};

export type StartTournamentInput = {
  tournamentId: string;
};
