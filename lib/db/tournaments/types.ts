import type { VerifiedRiotAccount } from "@/lib/riot/accounts/types";
import type { TournamentStartRequirement } from "@/lib/tournament/formats/types";

export type TournamentStatus =
  | "accepting_players"
  | "in_progress"
  | "completed"
  | "cancelled";

export type TournamentProgressionAction =
  | "finalize_node"
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

export type TournamentSummary = {
  id: string;
  hostUserId: string;
  name: string;
  playerCount: number;
  formatId: string;
  status: TournamentStatus;
  hasStarted: boolean;
  currentRoundId: string | null;
  currentRoundNumber: number | null;
  activeNodeIds: string[];
  createdAt: string;
  registeredPlayerCount: number;
};

export type TournamentListPageViewModel = {
  items: TournamentSummary[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

export type TournamentSummaryRpcItem = {
  id: string | number;
  host_user_id: string | number;
  name: string;
  max_players: number;
  format_id: string;
  status: TournamentStatus;
  has_started: boolean;
  current_round_id: string | number | null;
  current_round_number: number | null;
  active_node_ids: Array<string | number>;
  created_at: string;
  registered_player_count: number;
};

export type TournamentSummaryRpcRow = {
  items: TournamentSummaryRpcItem[];
  total_count: number | string;
  page: number | string;
  page_size: number | string;
  total_pages: number | string;
};

export type TournamentRegistration = {
  id: string;
  displayName: string;
  registrationStatus: "registered" | "waitlisted" | "entered" | "withdrawn";
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
  sourceEdgeId?: string | null;
  sourceRank?: number | null;
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
  formatNodeId?: string | null;
  isCheckmate?: boolean;
  name?: string | null;
  status?: "pending" | "active" | "completed" | "cancelled" | "skipped";
  configuredGames?: number | null;
};

export type TournamentNode = TournamentRound & {
  entrantCount: number;
  completedGames: number;
  configuredGames: number | null;
  position?: { x: number; y: number } | null;
};

export type TournamentEdge = {
  id: string;
  formatEdgeId: string;
  sourceNodeId: string;
  destinationNodeId: string;
  priority: number;
  condition: unknown;
  status: "pending" | "resolved";
  advancedPlayerCount: number;
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

export type TournamentLobbyRosterParticipant = Pick<
  TournamentLobbyParticipant,
  "id" | "displayName" | "seedNumber" | "slotNumber"
>;

export type TournamentLobbyRoster = Omit<TournamentLobby, "participants"> & {
  participants: TournamentLobbyRosterParticipant[];
};

export type TournamentOverview = Omit<
  TournamentDetail,
  "lobbies" | "gameScores" | "scores" | "roundProgress" | "progressionAction"
>;

export type TournamentRoundDetail = {
  round: TournamentRound;
  lobbies: TournamentLobby[];
  gameScores: TournamentGameScore[];
  scores: TournamentScore[];
  roundProgress: TournamentRoundProgress | null;
  progressionAction: TournamentProgressionAction;
};

export type TournamentLobbyDetail = {
  tournament: Pick<
    TournamentSummary,
    "id" | "hostUserId" | "name" | "status" | "hasStarted"
  >;
  round: TournamentRound;
  lobby: TournamentLobby;
  scores: TournamentScore[];
};

export type TournamentPanelView = "lobbies" | "scoresheet" | "graph" | "details";

export type TournamentSheetStatus = import("@/lib/sheets/types").GoogleSheetExportStatus;

export type TournamentLobbiesPanelViewModel = {
  view: "lobbies";
  round: TournamentRound | null;
  lobbies: TournamentLobby[];
  gameSummaries: Array<{ gameNumber: number; lobbyCount: number; completedLobbyCount: number }>;
  selectedGameNumber: number | null;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  roundProgress: TournamentRoundProgress | null;
  progressionAction: TournamentProgressionAction;
};

export type TournamentScoresheetPanelViewModel = {
  view: "scoresheet";
  tabs: import("@/lib/tournament/scoring/scoresheet").ScoresheetTab[];
};

export type TournamentGraphPanelViewModel = {
  view: "graph";
  nodes: TournamentNode[];
  edges: TournamentEdge[];
};

export type TournamentDetailsPanelViewModel = {
  view: "details";
  registrations: TournamentRegistration[];
  participants: TournamentParticipant[];
};

export type TournamentDetailPageShellViewModel = Omit<
  TournamentSummary,
  "registeredPlayerCount"
> & {
  formatConfig?: unknown;
  startRequirement: TournamentStartRequirement;
  rounds: TournamentRound[];
  nodes: TournamentNode[];
  edges: TournamentEdge[];
  activeNodeIds: string[];
  selectedNodeId: string | null;
  sheetStatus: TournamentSheetStatus | null;
};

export type TournamentDetailPageViewModel = TournamentDetailPageShellViewModel & {
  panel:
    | TournamentLobbiesPanelViewModel
    | TournamentScoresheetPanelViewModel
    | TournamentGraphPanelViewModel
    | TournamentDetailsPanelViewModel;
};

export type TournamentLobbyPageViewModel = TournamentLobbyDetail;

export type TournamentExportViewModel = Pick<
  TournamentDetail,
  "id" | "hostUserId" | "name" | "status" | "formatConfig" | "registrations" | "participants" | "rounds" | "scores" | "gameScores"
>;

export type TournamentDetail = Omit<
  TournamentSummary,
  "registeredPlayerCount"
> & {
  formatConfig?: unknown;
  startRequirement: TournamentStartRequirement;
  registrations: TournamentRegistration[];
  participants: TournamentParticipant[];
  rounds: TournamentRound[];
  lobbies: TournamentLobby[];
  gameScores: TournamentGameScore[];
  scores: TournamentScore[];
  roundProgress: TournamentRoundProgress | null;
  progressionAction: TournamentProgressionAction;
  nodes: TournamentNode[];
  edges: TournamentEdge[];
  activeNodeIds: string[];
  selectedNodeId: string | null;
};

export type TournamentRow = {
  id: string | number;
  host_user_id?: string | number;
  name: string;
  max_players: number;
  format_id: string;
  status: TournamentStatus;
  current_round_id: string | number | null;
  format_config: unknown;
  created_at: string;
};

export type TournamentEdgeRow = {
  id: string | number;
  tournament_id: string | number;
  format_edge_id: string;
  source_round_id: string | number;
  destination_round_id: string | number;
  priority: number;
  condition: unknown;
  status: "pending" | "resolved";
  advanced_player_count: number;
};

export type TournamentRegistrationRow = {
  id: string | number;
  tournament_id: string | number;
  display_name: string | null;
  riot_puuid: string | null;
  player_account_id?: string | number | null;
  registration_status: "registered" | "waitlisted" | "entered" | "withdrawn";
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
  source_edge_id?: string | number | null;
  source_rank?: number | null;
  created_at: string;
};

export type TournamentRoundRow = {
  id: string | number;
  tournament_id?: string | number;
  round_number: number;
  format_round_id: string | null;
  stage_name?: string | null;
  status: "pending" | "active" | "completed" | "cancelled" | "skipped";
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
  hostUserId: string;
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
  discordUserId?: string;
  playerAccountId?: string;
};

export type AddRandomSeededTournamentPlayersInput = {
  tournamentId: string;
  count: number;
};

export type AddRandomSeededTournamentPlayersResult = {
  requestedCount: number;
  addedCount: number;
  skippedCount: number;
  remainingSlots: number;
};

export type StartTournamentInput = {
  tournamentId: string;
  initialAssignments?: Array<{ registrationId: string; nodeId: string }>;
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

export type LobbyScoreWriteMode = "record" | "correct";

export type SubmitLobbyResultsInput = UpdateLobbyResultsInput & {
  idempotencyKey?: string;
  source?: "web" | "discord";
  submissionId?: string;
  mode?: LobbyScoreWriteMode;
};

export type SubmitLobbyResultsResult = {
  updated_lobby_id: string;
  updated_participant_count: number;
  round_id: string;
  lobby_number: number;
  game_number: number;
  replayed: boolean;
};

export type RandomizePendingLobbyResultsResult = {
  randomized_lobby_count: number;
  randomized_participant_count: number;
};

export type RandomizePendingLobbyResultsInput = {
  tournamentId: string;
  nodeId: string;
};

export type FinalizeTournamentNodeInput = {
  tournamentId: string;
  nodeId: string;
};

export type FinalizeTournamentNodeResult = {
  transition_type: "node_finalized" | "node_already_finalized" | "tournament_completed";
  completed_node_id: string;
  activated_node_ids: string[];
  skipped_node_ids: string[];
  advanced_player_count: number;
};
