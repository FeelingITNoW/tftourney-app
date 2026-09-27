import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteTournament,
  getTournamentExportViewModel,
  getTournamentLobbyViewModel,
  getTournamentPageViewModel,
} from "../lib/db/tournaments/api";
import defaultTournamentFormat from "../lib/tournament/formats/default.json";

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

test("getTournamentLobbyViewModel maps a full lobby and returns null for a missing tournament", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  const participants = Array.from({ length: 8 }, (_, index) => ({
    id: `participant-${index + 1}`,
    registration_id: String(index + 1),
    seed_number: index + 1,
    display_name_at_start: `Player ${index + 1}`,
    created_at: "2026-07-18T00:00:00.000Z",
  }));
  const lobbyParticipants = participants.map((participant, index) => ({
    participant_id: participant.id,
    display_name: participant.display_name_at_start,
    seed_number: participant.seed_number,
    round_seed_number: participant.seed_number,
    slot_number: index + 1,
    // The winning (8th) slot already has a confirmed result; the rest of
    // the lobby is still pending.
    placement: index === 7 ? 1 : null,
    points: index === 7 ? 8 : null,
    result_status: index === 7 ? "confirmed" : "pending",
  }));
  const scores = participants.map((participant, index) => ({
    id: `score-${index + 1}`,
    participant_id: participant.id,
    round_id: "2",
    round_seed_number: participant.seed_number,
    score: index === 7 ? 8 : 0,
    created_at: "2026-07-18T00:00:00.000Z",
  }));

  let requestedBody: { p_tournament_id?: string; p_lobby_id?: string } = {};
  globalThis.fetch = async (_input, options) => {
    requestedBody = options?.body ? JSON.parse(String(options.body)) : {};
    if (requestedBody.p_tournament_id === "missing-tournament") {
      return new Response(JSON.stringify([{ view_model: null }]), { status: 200 });
    }
    const viewModel = {
      tournament: { id: "tournament-1", host_user_id: "7", name: "Large tournament", status: "in_progress", has_started: true },
      format_config: {},
      round: { id: "2", round_number: 2, format_round_id: "second-round", status: "active" },
      lobby: { id: "105", round_id: "2", game_number: 2, lobby_number: 1, participants: lobbyParticipants },
      participants,
      scores,
    };
    return new Response(JSON.stringify([{ view_model: viewModel }]), { status: 200 });
  };

  try {
    const lobbyDetail = await getTournamentLobbyViewModel("tournament-1", "105");
    assert.equal(requestedBody.p_lobby_id, "105");
    assert.ok(lobbyDetail);
    assert.equal(lobbyDetail.lobby.id, "105");
    assert.equal(lobbyDetail.lobby.roundId, "2");
    assert.equal(lobbyDetail.lobby.participants.length, 8);
    assert.equal(
      lobbyDetail.lobby.participants.find((participant) => participant.slotNumber === 8)?.points,
      8,
    );
    assert.equal(lobbyDetail.scores.length, 8);

    assert.equal(await getTournamentLobbyViewModel("missing-tournament", "105"), null);
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

test("lobbies view derives fixed-games round progress from game_summaries when progress_lobbies is withheld", async () => {
  // Regression for the get_tournament_page_view_model change that only sends
  // progress_lobbies for rounds with at most 8 entrants: a large fixed-games
  // round (like this one) must still resolve roundProgress correctly using
  // only game_summaries, which the RPC always sends.
  const originalFetch = globalThis.fetch;
  const originalEnvironment = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  globalThis.fetch = async () => {
    const viewModel = {
      view: "lobbies",
      tournament: {
        id: "1", host_user_id: "7", name: "Big Tournament", max_players: 128, format_id: "default",
        status: "in_progress", has_started: true, current_round_id: "10", created_at: "2026-01-01T00:00:00Z",
        format_config: defaultTournamentFormat,
      },
      rounds: [{ id: "10", tournament_id: "1", round_number: 1, format_round_id: "opening-round", stage_name: null, status: "active" }],
      active_node_ids: ["10"],
      selected_node_id: "10",
      panel: {
        view: "lobbies",
        round_id: "10",
        selected_game_number: 3,
        page: 1, page_size: 8, total_count: 16, total_pages: 2,
        // opening-round inherits games: 6, reseed: 2 from nodeDefaults.
        game_summaries: [
          { game_number: 1, lobby_count: 16, completed_lobby_count: 16 },
          { game_number: 2, lobby_count: 16, completed_lobby_count: 16 },
          { game_number: 3, lobby_count: 16, completed_lobby_count: 3 },
        ],
        lobbies: [],
        // Withheld because this round has well over 8 entrants.
        progress_lobbies: [],
        round_progress: null,
        progression_action: null,
      },
      scores: [],
      participants: [],
    };
    return new Response(JSON.stringify([{ view_model: viewModel }]), { status: 200 });
  };
  try {
    const pageModel = await getTournamentPageViewModel("1", { view: "lobbies" });
    assert.ok(pageModel);
    assert.equal(pageModel.panel.view, "lobbies");
    assert.deepEqual(pageModel.panel.view === "lobbies" ? pageModel.panel.roundProgress : null, {
      roundFormat: "fixed_games",
      completedGames: 2,
      configuredGames: 6,
      checkmateThreshold: null,
      maxGames: null,
      decisiveGame: null,
      winnerParticipantId: null,
      currentBlockStartGame: 3,
      currentBlockEndGame: 4,
      nextReseedGame: 5,
      isComplete: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("maps discord_config and check_in_state for a host and withholds both for a non-host", async () => {
  // Regression for folding getTournamentDiscordConfig/getTournamentCheckInState
  // into get_tournament_page_view_model (host-gated, same as sheet_status).
  const originalFetch = globalThis.fetch;
  const originalEnvironment = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

  function viewModelFor(hostUserId: string | undefined) {
    const isHost = hostUserId === "7";
    return {
      view: "details",
      tournament: { id: "1", host_user_id: "7", name: "Test", max_players: 8, format_id: "default", status: "accepting_players", has_started: false, current_round_id: null, created_at: "2026-01-01T00:00:00Z" },
      rounds: [],
      registrations: [],
      participants: [],
      discord_config: isHost
        ? { tournament_id: "1", guild_id: "guild-1", guild_name: "My Guild", category_id: "cat-1", signup_channel_id: null, checkin_channel_id: null, score_channel_id: null, manager_role_id: null, signup_message_id: null, checkin_message_id: null, state: "active", last_error: null, last_heartbeat_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", cleanup_action: null, cleanup_requested_at: null, cleanup_completed_at: null }
        : null,
      check_in_state: isHost
        ? { status: "open", opened_at: "2026-01-02T00:00:00Z", closed_at: null, registered_count: 2, checked_in_count: 1, checked_in_registered_count: 1, registrations: [{ registration_id: "r1", display_name: "Player One", registration_status: "registered", checked_in_at: "2026-01-02T00:01:00Z", has_discord: true }, { registration_id: "r2", display_name: "Player Two", registration_status: "registered", checked_in_at: null, has_discord: false }] }
        : null,
    };
  }

  try {
    globalThis.fetch = async (_input, options) => {
      const body = options?.body ? JSON.parse(String(options.body)) as { p_host_user_id?: string } : {};
      return new Response(JSON.stringify([{ view_model: viewModelFor(body.p_host_user_id) }]), { status: 200 });
    };

    const asHost = await getTournamentPageViewModel("1", { view: "details", hostUserId: "7" });
    assert.ok(asHost);
    assert.deepEqual(asHost.discordConfig, {
      tournamentId: "1", guildId: "guild-1", guildName: "My Guild", categoryId: "cat-1",
      signupChannelId: null, checkinChannelId: null, scoreChannelId: null, managerRoleId: null,
      signupMessageId: null, checkinMessageId: null, state: "active", lastError: null, lastHeartbeatAt: null,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      cleanupAction: null, cleanupRequestedAt: null, cleanupCompletedAt: null,
    });
    assert.deepEqual(asHost.checkInState, {
      status: "open", openedAt: "2026-01-02T00:00:00Z", closedAt: null,
      registeredCount: 2, checkedInCount: 1, checkedInRegisteredCount: 1,
      registrations: [
        { registrationId: "r1", displayName: "Player One", registrationStatus: "registered", checkedInAt: "2026-01-02T00:01:00Z", hasDiscord: true },
        { registrationId: "r2", displayName: "Player Two", registrationStatus: "registered", checkedInAt: null, hasDiscord: false },
      ],
    });

    const asNonHost = await getTournamentPageViewModel("1", { view: "details", hostUserId: "999" });
    assert.ok(asNonHost);
    assert.equal(asNonHost.discordConfig, null);
    assert.equal(asNonHost.checkInState, null);

    const asPublic = await getTournamentPageViewModel("1", { view: "details" });
    assert.ok(asPublic);
    assert.equal(asPublic.discordConfig, null);
    assert.equal(asPublic.checkInState, null);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
