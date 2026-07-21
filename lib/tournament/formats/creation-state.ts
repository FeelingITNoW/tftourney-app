export type CustomTournamentCreationState = {
  message: string;
  fieldErrors: Record<string, string>;
  graphErrors: string[];
};

export const initialCustomTournamentCreationState: CustomTournamentCreationState = {
  message: "",
  fieldErrors: {},
  graphErrors: [],
};
