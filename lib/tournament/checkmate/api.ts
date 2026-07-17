import type {
  CheckmateGameResult,
  CheckmateOutcome,
  CheckmatePlayer,
  CheckmateWinCondition,
} from "./types";

function comparePlayers(
  first: CheckmatePlayer & { points: number; firsts: number },
  second: CheckmatePlayer & { points: number; firsts: number },
): number {
  return (
    second.points - first.points ||
    second.firsts - first.firsts ||
    first.roundEntrySeed - second.roundEntrySeed ||
    first.displayName.localeCompare(second.displayName) ||
    first.id.localeCompare(second.id)
  );
}

export function resolveCheckmateOutcome(
  players: CheckmatePlayer[],
  results: CheckmateGameResult[],
  condition: CheckmateWinCondition,
): CheckmateOutcome {
  const resultsByGame = new Map<number, CheckmateGameResult[]>();
  for (const result of results) {
    const gameResults = resultsByGame.get(result.gameNumber) ?? [];
    gameResults.push(result);
    resultsByGame.set(result.gameNumber, gameResults);
  }

  const completeGames = [...resultsByGame.entries()]
    .filter(([, gameResults]) => gameResults.length === players.length)
    .sort(([first], [second]) => first - second);
  const totals = new Map(players.map((player) => [player.id, 0]));
  const firsts = new Map(players.map((player) => [player.id, 0]));
  let decisiveGame: number | null = null;
  let winnerId: string | null = null;

  for (const [gameNumber, gameResults] of completeGames) {
    const beforeGameTotals = new Map(totals);
    for (const result of gameResults) {
      totals.set(result.participantId, (totals.get(result.participantId) ?? 0) + result.points);
    }
    for (const result of gameResults) {
      if (result.placement === 1) {
        firsts.set(result.participantId, (firsts.get(result.participantId) ?? 0) + 1);
      }
    }
    const candidates = gameResults
      .filter((result) => result.placement === 1)
      .filter((result) => (beforeGameTotals.get(result.participantId) ?? 0) > condition.threshold);
    if (candidates.length > 0) {
      const candidate = candidates
        .map((result) => ({
          result,
          points: totals.get(result.participantId) ?? 0,
          firsts: firsts.get(result.participantId) ?? 0,
        }))
        .sort(
          (first, second) =>
            second.points - first.points ||
            second.firsts - first.firsts ||
            (players.find((player) => player.id === first.result.participantId)?.roundEntrySeed ?? 0) -
              (players.find((player) => player.id === second.result.participantId)?.roundEntrySeed ?? 0),
        )[0];
      decisiveGame = gameNumber;
      winnerId = candidate?.result.participantId ?? null;
      break;
    }

    if (condition.maxGames !== undefined && gameNumber >= condition.maxGames) {
      break;
    }
  }

  const completedGames = completeGames.filter(([gameNumber]) =>
    (decisiveGame !== null && gameNumber <= decisiveGame) ||
    (decisiveGame === null &&
      (condition.maxGames === undefined || gameNumber <= condition.maxGames)),
  ).length;
  const isComplete = winnerId !== null ||
    (condition.maxGames !== undefined && completedGames >= condition.maxGames);
  const playersById = new Map(players.map((player) => [player.id, player]));
  const standings = players
    .map((player) => ({
      ...player,
      points: totals.get(player.id) ?? 0,
      firsts: firsts.get(player.id) ?? 0,
    }))
    .sort(comparePlayers);

  if (winnerId !== null) {
    const winner = standings.find((player) => player.id === winnerId);
    if (winner) {
      return {
        decisiveGame,
        winnerId,
        completedGames,
        isComplete,
        standings: [winner, ...standings.filter((player) => player.id !== winnerId)],
      };
    }
  }

  return {
    decisiveGame,
    winnerId,
    completedGames,
    isComplete,
    standings: standings.filter((player) => playersById.has(player.id)),
  };
}
