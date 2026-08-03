import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteTournament,
  getTournamentExportViewModel,
  getTournamentLobbyViewModel,
  getTournamentPageViewModel,
  getTournamentLobbyDetail,
  getTournamentRoundDetail,
} from "../lib/db/tournaments/api";

test("route view-model readers each use one scoped RPC", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  const requests: Array<{ path: string; body: unknown }> = [];
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    requests.push({ path: url.pathname, body: options?.body ? JSON.parse(String(options.body)) : null });
    const path = url.pathname;
    const viewModel = path.endsWith("get_tournament_page_view_model")
      ? { view: "details", tournament: { id: "1", host_user_id: "7", name: "Test", max_players: 8, format_id: "default", status: "accepting_players", has_started: false, current_round_id: null, created_at: "2026-01-01T00:00:00Z" }, rounds: [], registrations: [], participants: [] }
      : path.endsWith("get_tournament_lobby_view_model")
        ? { tournament: { id: "1", host_user_id: "7", name: "Test", status: "in_progress", has_started: true }, format_config: {}, round: { id: "2", round_number: 1, format_round_id: null, status: "active" }, lobby: { id: "3", round_id: "2", game_number: 1, lobby_number: 1, participants: [] }, participants: [], scores: [] }
        : { tournament: { id: "1", host_user_id: "7", name: "Test", status: "completed", format_config: {} }, registrations: [], participants: [], rounds: [], scores: [], game_scores: [] };
    return new Response(JSON.stringify([{ view_model: viewModel }]), { status: 200 });
  };
  try {
    await getTournamentPageViewModel("1", { view: "details", hostUserId: "7" });
    await getTournamentLobbyViewModel("1", "3");
    await getTournamentExportViewModel("1");
    assert.deepEqual(requests.map((request) => request.path), [
      "/rest/v1/rpc/get_tournament_page_view_model",
      "/rest/v1/rpc/get_tournament_lobby_view_model",
      "/rest/v1/rpc/get_tournament_export_view_model",
    ]);
    assert.deepEqual(requests[0]?.body, {
      p_tournament_id: "1",
      p_view: "details",
      p_selected_node_id: null,
      p_game_number: null,
      p_lobby_page: 1,
      p_lobby_page_size: 8,
      p_host_user_id: "7",
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

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

test("loads only the requested round and batches its lobby participants", async () => {
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
        ].filter((tournament) => {
          const idFilter = url.searchParams.get("id");
          return !idFilter || String(tournament.id) === idFilter.replace("eq.", "");
        });
        break;
      case "tournament_registrations":
        response = [];
        break;
      case "tournament_participants":
        response = participants;
        break;
      case "participant_round_scores":
        response = scores.filter((score) => {
          const roundFilter = url.searchParams.get("round_id");
          const participantFilter = url.searchParams.get("participant_id");
          const participantIds = participantFilter
            ?.replace(/^in\.\(|\)$/g, "")
            .split(",");
          return (
            (!roundFilter || String(score.round_id) === roundFilter.replace("eq.", "")) &&
            (!participantIds || participantIds.includes(score.participant_id))
          );
        });
        break;
      case "rounds":
        response = [
          { id: 1, round_number: 1, format_round_id: "opening-round", status: "active" },
          { id: 2, round_number: 2, format_round_id: "second-round", status: "active" },
        ].filter((round) => {
          const roundFilter = url.searchParams.get("id");
          return !roundFilter || String(round.id) === roundFilter.replace("eq.", "");
        });
        break;
      case "tournament_edges":
        response = [];
        break;
      case "lobbies":
        response = lobbies.filter((lobby) => {
          const roundFilter = url.searchParams.get("round_id");
          const idFilter = url.searchParams.get("id");
          return (
            (!roundFilter || String(lobby.round_id) === roundFilter.replace("eq.", "")) &&
            (!idFilter || String(lobby.id) === idFilter.replace("eq.", ""))
          );
        });
        break;
      case "lobby_participants": {
        const filter = url.searchParams.get("lobby_id") ?? "";
        lobbyParticipantRequests.push(filter);
        const ids = filter.startsWith("eq.")
          ? [filter.replace("eq.", "")]
          : filter.replace(/^in\.\(|\)$/g, "").split(",");
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
    const openingRound = await getTournamentRoundDetail(tournamentId, "1");
    const detail = await getTournamentRoundDetail(tournamentId, "2");

    assert.ok(detail);
    assert.ok(openingRound);
    assert.equal(openingRound.lobbies.length, 96);
    assert.equal(detail.lobbies.length, 32);
    assert.equal(lobbyParticipantRequests.length, 3);
    assert.equal(
      lobbyParticipantRequests.filter((request) => !request.startsWith("in.(97")).length,
      2,
    );
    assert.equal(
      lobbyParticipantRequests.filter((request) => request.startsWith("in.(97")).length,
      1,
    );
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

    const lobbyParticipantRequestCount = lobbyParticipantRequests.length;
    const lobbyDetail = await getTournamentLobbyDetail(tournamentId, "105");
    assert.ok(lobbyDetail);
    assert.equal(lobbyDetail.lobby.id, "105");
    assert.equal(lobbyDetail.lobby.roundId, "2");
    assert.equal(lobbyDetail.lobby.participants.length, 8);
    assert.equal(
      lobbyDetail.lobby.participants.find(
        (participant) => participant.slotNumber === 8,
      )?.points,
      8,
    );
    assert.equal(lobbyDetail.scores.length, 8);
    assert.equal(
      lobbyParticipantRequests.length,
      lobbyParticipantRequestCount + 2,
    );
    assert.ok(
      lobbyParticipantRequests
        .slice(-2)
        .every((request) => request === "eq.105"),
    );
    assert.equal(
      await getTournamentLobbyDetail("missing-tournament", "105"),
      null,
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
