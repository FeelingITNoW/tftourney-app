export type LobbyResultFormEntry = {
  participantId: string;
  placement: string;
};

export type ValidatedLobbyResult = {
  participantId: string;
  placement: number;
};

export type LobbyResultValidation =
  | {
      success: true;
      data: ValidatedLobbyResult[];
    }
  | {
      success: false;
      error: string;
    };

export type ScoredStanding = {
  displayName: string;
  score: number;
  seedNumber: number;
};
