export type LobbySeedingStrategy = "snake" | "random";

export type LobbySeededPlayer = {
  id: string;
  seedNumber: number;
};

export type LobbyAssignment<TPlayer extends LobbySeededPlayer> = {
  player: TPlayer;
  lobbyNumber: number;
  slotNumber: number;
};
