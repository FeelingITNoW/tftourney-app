export type TournamentCreationInput = {
  name: string;
  playerCount: string | number;
  formatId?: string;
};

export type TournamentCreationData = {
  name: string;
  playerCount: number;
  formatId: string;
};

export type TournamentCreationErrors = Partial<
  Record<keyof TournamentCreationInput, string>
>;

export type TournamentCreationValidation =
  | {
      success: true;
      data: TournamentCreationData;
      errors: TournamentCreationErrors;
    }
  | {
      success: false;
      data: null;
      errors: TournamentCreationErrors;
    };
