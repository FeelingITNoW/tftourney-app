export const DEFAULT_TOURNAMENT_FORMAT_ID = "default";

export type TournamentFormatOption = {
  id: string;
  name: string;
};

export const TOURNAMENT_FORMAT_OPTIONS: TournamentFormatOption[] = [
  {
    id: DEFAULT_TOURNAMENT_FORMAT_ID,
    name: "Default TFT Tournament Format",
  },
];

export function isValidTournamentFormatId(formatId: string): boolean {
  return TOURNAMENT_FORMAT_OPTIONS.some((format) => format.id === formatId);
}
