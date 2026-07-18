export type CheckmateWinCondition = {
  type: "checkmate";
  threshold: number;
  rankingMetric: "points";
  maxGames?: number;
};

export type CheckmatePlayer = {
  id: string;
  displayName: string;
  roundEntrySeed: number;
};

export type CheckmateGameResult = {
  participantId: string;
  gameNumber: number;
  placement: number;
  points: number;
};

export type CheckmateOutcome = {
  decisiveGame: number | null;
  winnerId: string | null;
  completedGames: number;
  isComplete: boolean;
  standings: Array<CheckmatePlayer & {
    points: number;
    firsts: number;
  }>;
};
