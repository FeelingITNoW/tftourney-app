"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { TournamentLobby } from "@/lib/db/tournaments/types";

const LOBBIES_PER_PAGE = 8;

type LobbyBrowserProps = {
  initialGameNumber: number | null;
  initialPage: number;
  lobbies: TournamentLobby[];
  tournamentId: string;
};

export function LobbyBrowser({
  initialGameNumber,
  initialPage,
  lobbies,
  tournamentId,
}: LobbyBrowserProps) {
  const games = useMemo(() => {
    const gameMap = new Map<number, TournamentLobby[]>();

    for (const lobby of lobbies) {
      gameMap.set(lobby.gameNumber, [
        ...(gameMap.get(lobby.gameNumber) ?? []),
        lobby,
      ]);
    }

    return [...gameMap.entries()]
      .sort(([firstGame], [secondGame]) => firstGame - secondGame)
      .map(([gameNumber, gameLobbies]) => ({
        gameNumber,
        lobbies: [...gameLobbies].sort(
          (firstLobby, secondLobby) =>
            firstLobby.lobbyNumber - secondLobby.lobbyNumber,
        ),
      }));
  }, [lobbies]);

  const [activeGameNumber, setActiveGameNumber] = useState(
    () =>
      games.some(({ gameNumber }) => gameNumber === initialGameNumber)
        ? initialGameNumber
        : games[0]?.gameNumber ?? null,
  );
  const [page, setPage] = useState(initialPage);
  const activeGame =
    games.find(({ gameNumber }) => gameNumber === activeGameNumber) ?? games[0];
  const pageCount = activeGame
    ? Math.ceil(activeGame.lobbies.length / LOBBIES_PER_PAGE)
    : 0;
  const safePage = pageCount === 0 ? 1 : Math.min(page, pageCount);
  const visibleLobbies = activeGame
    ? activeGame.lobbies.slice(
        (safePage - 1) * LOBBIES_PER_PAGE,
        safePage * LOBBIES_PER_PAGE,
      )
    : [];

  function selectGame(gameNumber: number) {
    setActiveGameNumber(gameNumber);
    setPage(1);
    updateViewUrl(gameNumber, 1);
  }

  function selectPage(nextPage: number) {
    const selectedPage = Math.max(1, Math.min(nextPage, pageCount));
    setPage(selectedPage);
    if (activeGame) {
      updateViewUrl(activeGame.gameNumber, selectedPage);
    }
  }

  function updateViewUrl(gameNumber: number, selectedPage: number) {
    const url = new URL(window.location.href);
    url.searchParams.set("game", String(gameNumber));
    url.searchParams.set("page", String(selectedPage));
    window.history.replaceState(null, "", url);
  }

  if (games.length === 0) {
    return (
      <div className="mt-5 rounded-md border border-zinc-200 bg-white p-5 text-sm text-zinc-500">
        No lobbies were generated for the current round.
      </div>
    );
  }

  return (
    <div className="mt-5">
      <div
        aria-label="Games"
        className="flex flex-wrap gap-1 border-b border-zinc-200"
        role="tablist"
      >
        {games.map(({ gameNumber, lobbies: gameLobbies }) => (
          <button
            aria-controls="lobby-browser-panel"
            aria-selected={activeGame?.gameNumber === gameNumber}
            className={`border-b-2 px-4 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${
              activeGame?.gameNumber === gameNumber
                ? "border-emerald-700 text-emerald-800"
                : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"
            }`}
            id={`game-${gameNumber}-tab`}
            key={gameNumber}
            onClick={() => selectGame(gameNumber)}
            role="tab"
            type="button"
          >
            Game {gameNumber}
            <span className="ml-2 text-xs font-normal text-zinc-500">
              {gameLobbies.length} lobbies
            </span>
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`game-${activeGame?.gameNumber}-tab`}
        className="pt-5"
        id="lobby-browser-panel"
        role="tabpanel"
        tabIndex={0}
      >
        <div className="mb-4 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-zinc-500">
            Showing lobbies {(safePage - 1) * LOBBIES_PER_PAGE + 1}–
            {Math.min(safePage * LOBBIES_PER_PAGE, activeGame?.lobbies.length ?? 0)} of{" "}
            {activeGame?.lobbies.length ?? 0}
          </p>
          {pageCount > 1 ? (
            <nav aria-label={`Game ${activeGame?.gameNumber} lobby pages`}>
              <div className="flex flex-wrap items-center justify-end gap-1">
                <button
                  aria-label="Previous lobby page"
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 font-medium text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={safePage === 1}
                  onClick={() => selectPage(safePage - 1)}
                  type="button"
                >
                  Previous
                </button>
                {Array.from({ length: pageCount }, (_, index) => index + 1).map(
                  (pageNumber) => (
                    <button
                      aria-label={`Lobby page ${pageNumber}`}
                      aria-current={safePage === pageNumber ? "page" : undefined}
                      className={`min-w-10 rounded-md border px-3 py-2 font-medium transition focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 ${
                        safePage === pageNumber
                          ? "border-emerald-700 bg-emerald-700 text-white"
                          : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                      key={pageNumber}
                      onClick={() => selectPage(pageNumber)}
                      type="button"
                    >
                      {pageNumber}
                    </button>
                  ),
                )}
                <button
                  aria-label="Next lobby page"
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 font-medium text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={safePage === pageCount}
                  onClick={() => selectPage(safePage + 1)}
                  type="button"
                >
                  Next
                </button>
              </div>
            </nav>
          ) : null}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {visibleLobbies.map((lobby) => (
            <article
              className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm"
              key={lobby.id}
            >
              <div className="flex items-center justify-between gap-4 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
                <h3 className="font-semibold text-zinc-950">
                  Game {lobby.gameNumber} · Lobby {lobby.lobbyNumber}
                </h3>
                <Link
                  className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
                  href={`/tournaments/${tournamentId}/lobbies/${lobby.id}?game=${activeGame?.gameNumber}&page=${safePage}`}
                >
                  Input scores
                </Link>
              </div>
              <ol className="divide-y divide-zinc-100">
                {lobby.participants.map((participant) => (
                  <li
                    className="flex items-center gap-3 px-4 py-3 text-sm"
                    key={participant.id}
                  >
                    <span className="w-6 text-zinc-400">
                      {participant.slotNumber}
                    </span>
                    <span className="flex-1 font-medium text-zinc-950">
                      {participant.displayName}
                    </span>
                    <span className="w-16 text-right font-semibold text-zinc-950">
                      {participant.points === null
                        ? "Pending"
                        : `${participant.points} pts`}
                    </span>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
