import type { LobbySeedingStrategy } from "../lobbies/types";

export type TournamentFormatOption = {
  id: string;
  name: string;
};

export type TournamentRoundFormat = {
  id: string;
  name: string;
  lobbySeeding: LobbySeedingStrategy;
  games: number;
};

export type TournamentFormat = {
  id: string;
  name: string;
  isDefault?: boolean;
  rounds: TournamentRoundFormat[];
};
