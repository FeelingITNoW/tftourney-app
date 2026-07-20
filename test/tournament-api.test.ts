import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteTournament,
  getTournamentDetail,
} from "../lib/db/tournaments/api";

test("deletes a tournament through the database aggregate boundary", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  let requestUrl = "";
  let requestOptions: RequestInit | undefined;

  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  globalThis.fetch = async (input, options) => {
    requestUrl = String(input);
    requestOptions = options;

    return new Response(JSON.stringify([{ id: "42" }]), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  };

  try {
    await deleteTournament({ tournamentId: "42" });

    const url = new URL(requestUrl);
    const headers = new Headers(requestOptions?.headers);

    assert.equal(url.pathname, "/rest/v1/tournaments");
    assert.equal(url.searchParams.get("id"), "eq.42");
    assert.equal(url.searchParams.get("select"), "id");
    assert.equal(requestOptions?.method, "DELETE");
    assert.equal(headers.get("Prefer"), "return=representation");
  } finally {
    globalThis.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("loads every lobby participant when the relationship exceeds the REST row cap", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  const lobbyParticipantRequests: string[] = [];
  const tournamentId = "tournament-1";
  const lobbies = Array.from({ length: 128 }, (_, index) => {
    const isOpeningRound = index < 96;
    const roundIndex = isOpeningRound ? index : index - 96;
    const lobbiesPerGame = isOpeningRound ? 16 : 8;

    return {
      id: index + 1,
      round_id: isOpeningRound ? 1 : 2,
      game_number: Math.floor(roundIndex / lobbiesPerGame) + 1,
      lobby_number: (roundIndex % lobbiesPerGame) + 1,
    };
  });
  const participants = Array.from({ length: 128 }, (_, index) => ({
    id: `participant-${index + 1}`,
    tournament_id: tournamentId,
    registration_id: index + 1,
    seed_number: index + 1,
    display_name_at_start: `Player ${index + 1}`,
    created_at: "2026-07-18T00:00:00.000Z",
  }));
  const scores = [1, 2].flatMap((roundId) =>
    participants.map((participant, index) => ({
      id: `score-${roundId}-${index + 1}`,
      participant_id: participant.id,
      round_id: roundId,
      round_seed_number: index + 1,
      score: 0,
      created_at: "2026-07-18T00:00:00.000Z",
    })),
  );
  const lobbyParticipants = lobbies.flatMap((lobby) =>
    Array.from({ length: 8 }, (_, index) => {
      const isAffectedWinner = lobby.id === 105 && index === 7;

      return {
        id: `lobby-participant-${lobby.id}-${index + 1}`,
        lobby_id: lobby.id,
        participant_id: `participant-${index + 1}`,
        slot_number: index + 1,
        placement: isAffectedWinner ? 1 : null,
        points: isAffectedWinner ? 8 : null,
        result_status: isAffectedWinner ? "confirmed" : "pending",
      } as const;
    }),
  );
  const formatConfig = {
    schemaVersion: 3,
    id: "large",
    name: "Large",
    placementPoints: { "1": 8 },
    startRequirement: { minimumEntrants: 1 },
    nodeDefaults: {
      mergeSeeding: "random",
      lobbySeeding: "snake",
      games: 6,
      reseed: 2,
      standings: { rankingMetric: "points", sortDirection: "desc", tieBreakers: [] },
      reseedStandings: { rankingMetric: "tournament_points", sortDirection: "desc", tieBreakers: [] },
    },
    nodes: [
      { id: "opening-round", name: "Opening", initialEntrantSlots: "all" },
      { id: "second-round", name: "Second" },
    ],
    edges: [
      { id: "opening-to-second", sourceNodeId: "opening-round", destinationNodeId: "second-round", priority: 1, condition: { type: "top_n", count: 8 } },
    ],
  };

  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const resource = url.pathname.split("/").pop();
    let response: unknown;

    switch (resource) {
      case "tournaments":
        response = [
          {
            id: tournamentId,
            name: "Large tournament",
            max_players: 128,
            format_id: "large",
            status: "in_progress",
            current_round_id: 2,
            format_config: formatConfig,
            created_at: "2026-07-18T00:00:00.000Z",
          },
        ];
        break;
      case "tournament_registrations":
        response = [];
        break;
      case "tournament_participants":
        response = participants;
        break;
      case "participant_round_scores":
        response = scores;
        break;
      case "rounds":
        response = [
          { id: 1, round_number: 1, format_round_id: "opening-round", status: "completed" },
          { id: 2, round_number: 2, format_round_id: "second-round", status: "active" },
        ];
        break;
      case "tournament_edges":
        response = [];
        break;
      case "lobbies":
        response = lobbies;
        break;
      case "lobby_participants": {
        lobbyParticipantRequests.push(url.search);
        const filter = url.searchParams.get("lobby_id") ?? "";
        const ids = filter.replace(/^in\.\(|\)$/g, "").split(",");
        response = lobbyParticipants.filter((participant) =>
          ids.includes(String(participant.lobby_id)),
        );
        break;
      }
      default:
        throw new Error(`Unexpected test request: ${url.pathname}`);
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const detail = await getTournamentDetail(tournamentId);

    assert.ok(detail);
    assert.equal(lobbyParticipantRequests.length, 2);
    const affectedLobby = detail.lobbies.find(
      (lobby) => lobby.roundId === "2" && lobby.gameNumber === 2 && lobby.lobbyNumber === 1,
    );
    assert.equal(affectedLobby?.participants.length, 8);
    assert.equal(
      affectedLobby?.participants.find((participant) => participant.slotNumber === 8)?.points,
      8,
    );
    assert.equal(
      detail.gameScores.find(
        (score) =>
          score.roundId === "2" &&
          score.gameNumber === 2 &&
          score.participantId === "participant-8",
      )?.score,
      8,
    );
  } finally {
    globalThis.fetch = originalFetch;

    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
