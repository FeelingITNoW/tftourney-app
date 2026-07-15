import type {
  RegisteredTournamentPlayer,
  TournamentEntrantSelection,
} from "./types";

export const INITIAL_TOURNAMENT_ROUND_NUMBER = 1;

export function selectTournamentEntrants(
  players: RegisteredTournamentPlayer[],
  maxPlayers: number,
): TournamentEntrantSelection[] {
  if (!Number.isInteger(maxPlayers) || maxPlayers <= 0) {
    return [];
  }

  return [...players]
    .sort((firstPlayer, secondPlayer) => {
      const registrationOrder = firstPlayer.createdAt.localeCompare(
        secondPlayer.createdAt,
      );

      if (registrationOrder !== 0) {
        return registrationOrder;
      }

      return firstPlayer.id.localeCompare(secondPlayer.id);
    })
    .slice(0, maxPlayers)
    .map((player, index) => ({
      ...player,
      seedNumber: index + 1,
    }));
}
