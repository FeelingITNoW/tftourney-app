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
  createdAt: string;
  registeredPlayerCount: number;
};

export type TournamentPlayer = {
  id: string;
  displayName: string;
  createdAt: string;
};

export type TournamentDetail = Omit<
  TournamentSummary,
  "registeredPlayerCount"
> & {
  players: TournamentPlayer[];
};

export type TournamentRow = {
  id: string;
  name: string;
  player_count: number;
  format_id: string;
  status: TournamentStatus;
  has_started: boolean;
  created_at: string;
};

export type TournamentPlayerRow = {
  id: string;
  tournament_id: string;
  display_name: string | null;
  riot_puuid: string | null;
  created_at: string;
};
