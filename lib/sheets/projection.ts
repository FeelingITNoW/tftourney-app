import type { TournamentDetail, TournamentRound } from "../db/tournaments/types";
import { resolveCheckmateOutcome } from "../tournament/checkmate/api";
import type { CheckmateGameResult, CheckmateWinCondition } from "../tournament/checkmate/types";
import { sortScoresHighestFirst } from "../tournament/scoring/api";
import type { SheetCell, SheetTabModel, TournamentWorkbookModel } from "./types";

type StandardScore = {
  participantId: string;
  displayName: string;
  seedNumber: number;
  score: number;
};

function cell(value: SheetCell["value"], kind?: SheetCell["kind"]): SheetCell {
  return { value, ...(kind ? { kind } : {}) };
}

function titleRows(title: string, generatedAt: string): SheetCell[][] {
  return [
    [cell(title, "title")],
    [cell(`Updated ${generatedAt}`, "subtitle")],
  ];
}

function orderedRounds(detail: TournamentDetail): TournamentRound[] {
  return [...detail.rounds].sort(
    (first, second) => first.roundNumber - second.roundNumber || first.id.localeCompare(second.id),
  );
}

function roundName(detail: TournamentDetail, round: TournamentRound): string {
  return round.name?.trim() || `Round ${round.roundNumber}`;
}

function hasCheckmate(round: TournamentRound): boolean {
  return round.isCheckmate === true;
}

function standardRows(detail: TournamentDetail): StandardScore[] {
  const standardRoundIds = new Set(
    detail.rounds.filter((round) => !hasCheckmate(round)).map((round) => round.id),
  );
  const totals = new Map<string, StandardScore>();

  for (const participant of detail.participants) {
    totals.set(participant.id, {
      participantId: participant.id,
      displayName: participant.displayName,
      seedNumber: participant.seedNumber,
      score: 0,
    });
  }

  for (const score of detail.scores) {
    if (!standardRoundIds.has(score.roundId)) continue;
    const current = totals.get(score.participantId);
    if (current) current.score += score.score;
  }

  return sortScoresHighestFirst(
    [...totals.values()].map((score) => ({ ...score, roundSeedNumber: score.seedNumber })),
  ).map((score) => ({
    participantId: score.participantId,
    displayName: score.displayName,
    seedNumber: score.seedNumber,
    score: score.score,
  }));
}

function gameValue(
  detail: TournamentDetail,
  participantId: string,
  roundId: string,
  gameNumber: number,
): number | null {
  const game = detail.gameScores.find(
    (score) =>
      score.participantId === participantId &&
      score.roundId === roundId &&
      score.gameNumber === gameNumber,
  );
  return game?.score ?? null;
}

function configuredGameCount(round: TournamentRound, detail: TournamentDetail): number {
  if (round.configuredGames && round.configuredGames > 0) return round.configuredGames;
  return Math.max(
    ...detail.gameScores
      .filter((score) => score.roundId === round.id)
      .map((score) => score.gameNumber),
    0,
  );
}

function advancementStatus(detail: TournamentDetail, participantId: string): string {
  const participantScores = detail.scores.filter((score) => score.participantId === participantId);
  const rounds = orderedRounds(detail);

  const destination = participantScores
    .map((score) => rounds.find((round) => round.id === score.roundId))
    .filter((round): round is TournamentRound => Boolean(round))
    .sort((first, second) => second.roundNumber - first.roundNumber)[0];

  if (!destination) {
    const registration = detail.registrations.find(
      (entry) => entry.id === detail.participants.find((p) => p.id === participantId)?.registrationId,
    );
    return registration?.registrationStatus === "withdrawn" ? "Withdrawn" : "Registered";
  }

  const playedInDestination = detail.gameScores.some(
    (score) => score.participantId === participantId && score.roundId === destination.id && score.score !== null,
  );
  if (!playedInDestination) return `Advanced to ${roundName(detail, destination)}`;
  if (destination.status === "active") return `Playing ${roundName(detail, destination)}`;
  if (detail.status === "completed") return "Finished";
  return `Completed ${roundName(detail, destination)}`;
}

function playersTab(detail: TournamentDetail, generatedAt: string): SheetTabModel {
  const participantByRegistration = new Map(
    detail.participants.map((participant) => [participant.registrationId, participant]),
  );
  const rows = [
    ...titleRows(`${detail.name} — Players`, generatedAt),
    [],
    [cell("Seed", "header"), cell("Player", "header"), cell("Registration Status", "header")],
  ];

  for (const registration of detail.registrations) {
    const participant = participantByRegistration.get(registration.id);
    rows.push([
      cell(participant?.seedNumber ?? null, "number"),
      cell(registration.displayName),
      cell(registration.registrationStatus, "status"),
    ]);
  }

  return { title: "Players", rows, frozenRows: 4, filterRow: 3 };
}

function scoresTab(detail: TournamentDetail, generatedAt: string): SheetTabModel {
  const rounds = orderedRounds(detail).filter((round) => !hasCheckmate(round));
  const columns = rounds.flatMap((round) =>
    Array.from({ length: configuredGameCount(round, detail) }, (_, index) => ({
      round,
      gameNumber: index + 1,
      label: `${roundName(detail, round)} G${index + 1}`,
    })),
  );
  const rows = [
    ...titleRows(`${detail.name} — Scores`, generatedAt),
    [],
    [
      cell("Rank", "header"),
      cell("Player", "header"),
      cell("Total", "header"),
      ...columns.map((column) => cell(column.label, "header")),
      cell("Status", "header"),
    ],
  ];

  standardRows(detail).forEach((score, index) => {
    rows.push([
      cell(index + 1, "number"),
      cell(score.displayName),
      cell(score.score, "number"),
      ...columns.map((column) =>
        cell(gameValue(detail, score.participantId, column.round.id, column.gameNumber), "number"),
      ),
      cell(advancementStatus(detail, score.participantId), "status"),
    ]);
  });

  return { title: "Scores", rows, frozenRows: 4, filterRow: 3 };
}

function checkmateCondition(detail: TournamentDetail, round: TournamentRound): CheckmateWinCondition {
  const formatConfig = detail.formatConfig as
    | { nodes?: Array<{ id: string; winCondition?: CheckmateWinCondition }> }
    | undefined;
  const condition = formatConfig?.nodes?.find((node) => node.id === round.formatNodeId)?.winCondition;
  return condition?.type === "checkmate"
    ? condition
    : { type: "checkmate", threshold: 18, rankingMetric: "points" };
}

function checkmateTab(detail: TournamentDetail, generatedAt: string): SheetTabModel {
  const rounds = orderedRounds(detail).filter((round) => hasCheckmate(round));
  const rows = [...titleRows(`${detail.name} — Checkmate`, generatedAt)];

  if (rounds.length === 0) {
    rows.push([], [cell("No checkmate stage configured.", "note")]);
    return { title: "Checkmate", rows, frozenRows: 2 };
  }

  for (const round of rounds) {
    const condition = checkmateCondition(detail, round);
    const players = detail.scores
      .filter((score) => score.roundId === round.id)
      .map((score) => ({ id: score.participantId, displayName: score.displayName, roundEntrySeed: score.roundSeedNumber }));
    const playerById = new Map(players.map((player) => [player.id, player]));
    const results: CheckmateGameResult[] = detail.gameScores
      .filter((score) => score.roundId === round.id && score.placement !== null && score.score !== null)
      .map((score) => ({
        participantId: score.participantId,
        gameNumber: score.gameNumber,
        placement: score.placement as number,
        points: score.score as number,
      }));
    const outcome = resolveCheckmateOutcome([...playerById.values()], results, condition);
    const maxGame = Math.max(...results.map((result) => result.gameNumber), condition.maxGames ?? 0, 0);

    rows.push(
      [],
      [cell(roundName(detail, round), "title")],
      [cell(`Check = more than ${condition.threshold} points before a game`, "subtitle")],
      [
        cell("Rank", "header"),
        cell("Player", "header"),
        cell("Total", "header"),
        ...Array.from({ length: maxGame }, (_, index) => cell(`Game ${index + 1}`, "header")),
        cell("Status", "header"),
      ],
    );

    outcome.standings.forEach((standing, index) => {
      const gameTotals = new Map<number, number>();
      for (const result of results) {
        if (result.participantId === standing.id) {
          gameTotals.set(result.gameNumber, result.points);
        }
      }
      const status = standing.id === outcome.winnerId
        ? "WINNER"
        : standing.points > condition.threshold
          ? "CHECK"
          : "Playing";
      rows.push([
        cell(index + 1, "number"),
        cell(standing.displayName),
        cell(standing.points, "number"),
        ...Array.from({ length: maxGame }, (_, gameIndex) => cell(gameTotals.get(gameIndex + 1) ?? null, "number")),
        cell(status, "status"),
      ]);
    });
  }

  return { title: "Checkmate", rows, frozenRows: 4 };
}

export function buildTournamentWorkbook(
  detail: TournamentDetail,
  generatedAt = new Date().toISOString(),
): TournamentWorkbookModel {
  return {
    title: `${detail.name} — TFTourney Organizer`,
    generatedAt,
    tabs: [playersTab(detail, generatedAt), scoresTab(detail, generatedAt), checkmateTab(detail, generatedAt)],
  };
}
