import type {
  LobbyAssignment,
  LobbySeededPlayer,
  LobbySeedingStrategy,
} from "./types";

export const TFT_PLAYERS_PER_LOBBY = 8;

export function isLobbySeedingStrategy(
  value: unknown,
): value is LobbySeedingStrategy {
  return value === "snake" || value === "random";
}

function shufflePlayers<TPlayer>(
  players: TPlayer[],
  random: () => number,
): TPlayer[] {
  const shuffledPlayers = [...players];

  for (let index = shuffledPlayers.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffledPlayers[index], shuffledPlayers[swapIndex]] = [
      shuffledPlayers[swapIndex],
      shuffledPlayers[index],
    ];
  }

  return shuffledPlayers;
}

export function generateLobbyAssignments<TPlayer extends LobbySeededPlayer>(
  players: TPlayer[],
  strategy: LobbySeedingStrategy,
  playersPerLobby = TFT_PLAYERS_PER_LOBBY,
  random: () => number = Math.random,
): LobbyAssignment<TPlayer>[] {
  if (!Number.isInteger(playersPerLobby) || playersPerLobby <= 0) {
    throw new Error("Players per lobby must be a positive whole number.");
  }

  if (players.length === 0) {
    return [];
  }

  const seededPlayers = [...players].sort(
    (firstPlayer, secondPlayer) =>
      firstPlayer.seedNumber - secondPlayer.seedNumber,
  );
  const orderedPlayers =
    strategy === "random"
      ? shufflePlayers(seededPlayers, random)
      : seededPlayers;
  const lobbyCount = Math.ceil(orderedPlayers.length / playersPerLobby);

  return orderedPlayers.map((player, index) => {
    const rowNumber = Math.floor(index / lobbyCount);
    const lobbyOffset = index % lobbyCount;
    const lobbyNumber =
      strategy === "snake" && rowNumber % 2 === 1
        ? lobbyCount - lobbyOffset
        : lobbyOffset + 1;

    return {
      player,
      lobbyNumber,
      slotNumber: rowNumber + 1,
    };
  });
}
