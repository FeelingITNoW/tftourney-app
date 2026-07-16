import type { StandingPlayer } from "./types";

function compareNames(firstPlayer: StandingPlayer, secondPlayer: StandingPlayer): number {
  return (
    firstPlayer.displayName.localeCompare(secondPlayer.displayName) ||
    firstPlayer.id.localeCompare(secondPlayer.id)
  );
}

export function rankRoundStandings(players: StandingPlayer[]): StandingPlayer[] {
  return [...players].sort(
    (firstPlayer, secondPlayer) =>
      secondPlayer.currentRoundPoints - firstPlayer.currentRoundPoints ||
      secondPlayer.currentRoundFirsts - firstPlayer.currentRoundFirsts ||
      firstPlayer.roundEntrySeed - secondPlayer.roundEntrySeed ||
      compareNames(firstPlayer, secondPlayer),
  );
}

export function rankReseedStandings(players: StandingPlayer[]): StandingPlayer[] {
  return [...players].sort(
    (firstPlayer, secondPlayer) =>
      secondPlayer.tournamentPoints - firstPlayer.tournamentPoints ||
      secondPlayer.currentRoundFirsts - firstPlayer.currentRoundFirsts ||
      firstPlayer.roundEntrySeed - secondPlayer.roundEntrySeed ||
      compareNames(firstPlayer, secondPlayer),
  );
}
