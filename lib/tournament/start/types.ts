export type RegisteredTournamentPlayer = {
  id: string;
  displayName: string;
  createdAt: string;
};

export type TournamentEntrantSelection = RegisteredTournamentPlayer & {
  seedNumber: number;
};
