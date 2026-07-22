import type {
  TournamentGameScore,
  TournamentRound,
  TournamentScore,
} from "../../db/tournaments/types";
import { aggregateParticipantScores } from "./api";
import type { ParticipantScoreStanding } from "./types";

export type ScoresheetColumn = {
  id: string;
  label: string;
};

export type ScoresheetRow = ParticipantScoreStanding & {
  breakdown: Record<string, number | null | undefined>;
  rank: number;
  roundScore?: number;
};

export type ScoresheetTab = {
  columns: ScoresheetColumn[];
  id: string;
  isCheckmate?: boolean;
  label: string;
  scores: ScoresheetRow[];
};

export const OVERALL_TAB_ID = "overall";

function gameKey(roundId: string, gameNumber: number): string {
  return `${roundId}:${gameNumber}`;
}

function participantGameKey(
  participantId: string,
  roundId: string,
  gameNumber: number,
): string {
  return `${participantId}:${gameKey(roundId, gameNumber)}`;
}

function orderedRounds(rounds: TournamentRound[]): TournamentRound[] {
  return [...rounds].sort(
    (firstRound, secondRound) =>
      firstRound.roundNumber - secondRound.roundNumber ||
      firstRound.id.localeCompare(secondRound.id),
  );
}

function buildPlayedGameColumns(
  rounds: TournamentRound[],
  gameScores: TournamentGameScore[],
): ScoresheetColumn[] {
  const playedGameKeys = new Set(
    gameScores
      .filter((score) => score.score !== null)
      .map((score) => gameKey(score.roundId, score.gameNumber)),
  );

  return orderedRounds(rounds).flatMap((round) => {
    const gameNumbers = [
      ...new Set(
        gameScores
          .filter(
            (score) =>
              score.roundId === round.id &&
              playedGameKeys.has(gameKey(score.roundId, score.gameNumber)),
          )
          .map((score) => score.gameNumber),
      ),
    ].sort((firstGame, secondGame) => firstGame - secondGame);

    return gameNumbers.map((gameNumber) => ({
      id: gameKey(round.id, gameNumber),
      label: `R${round.roundNumber} G${gameNumber}`,
    }));
  });
}

function buildScoreByParticipantAndGame(
  gameScores: TournamentGameScore[],
): Map<string, number | null> {
  return new Map(
    gameScores.map((score) => [
      participantGameKey(score.participantId, score.roundId, score.gameNumber),
      score.score,
    ]),
  );
}

function addRows(
  standings: ParticipantScoreStanding[],
  columns: ScoresheetColumn[],
  scoreByParticipantAndGame: Map<string, number | null>,
  roundScoreByParticipant?: Map<string, number>,
): ScoresheetRow[] {
  return standings.map((score, index) => ({
    ...score,
    breakdown: Object.fromEntries(
      columns.map((column) => [
        column.id,
        scoreByParticipantAndGame.get(`${score.participantId}:${column.id}`),
      ]),
    ),
    rank: index + 1,
    roundScore: roundScoreByParticipant?.get(score.participantId),
  }));
}

export function buildScoresheetTabs(
  rounds: TournamentRound[],
  scores: TournamentScore[],
  gameScores: TournamentGameScore[],
): ScoresheetTab[] {
  const overallStandings = aggregateParticipantScores(scores);
  const scoreByParticipantAndGame = buildScoreByParticipantAndGame(gameScores);
  const overallColumns = buildPlayedGameColumns(rounds, gameScores);

  const tabs: ScoresheetTab[] = [
    {
      columns: overallColumns,
      id: OVERALL_TAB_ID,
      label: "Overall",
      scores: addRows(
        overallStandings,
        overallColumns,
        scoreByParticipantAndGame,
      ),
    },
  ];

  for (const round of orderedRounds(rounds)) {
    const roundParticipantIds = new Set(
      scores
        .filter((score) => score.roundId === round.id)
        .map((score) => score.participantId),
    );
    const roundColumns = buildPlayedGameColumns([round], gameScores);
    const roundScoreByParticipant = new Map(
      scores
        .filter((score) => score.roundId === round.id)
        .map((score) => [score.participantId, score.score]),
    );
    const roundStandings = overallStandings.filter((score) =>
      roundParticipantIds.has(score.participantId),
    );

    tabs.push({
      columns: roundColumns,
      id: round.id,
      isCheckmate: round.isCheckmate,
      label: `Round ${round.roundNumber}`,
      scores: addRows(
        roundStandings,
        roundColumns,
        scoreByParticipantAndGame,
        roundScoreByParticipant,
      ),
    });
  }

  return tabs;
}
