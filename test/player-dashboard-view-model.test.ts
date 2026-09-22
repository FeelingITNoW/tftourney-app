import assert from "node:assert/strict";
import test from "node:test";
import {
  getPlayerDashboard,
  mapPlayerDashboardViewModel,
} from "../lib/db/players/dashboard";

type Call = { method: string; pathname: string; body: unknown };

function withEnv<T>(run: (calls: Call[]) => Promise<T>): Promise<T> {
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalFetch = globalThis.fetch;
  const calls: Call[] = [];
  return run(calls).finally(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function stubFetch(calls: Call[], respond: (call: Call) => unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      pathname: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    return new Response(JSON.stringify(respond(call)), { status: 200 });
  }) as typeof fetch;
}

test("mapPlayerDashboardViewModel marks tournaments the player is registered for", () => {
  const viewModel = mapPlayerDashboardViewModel({
    player_account_id: "42",
    riot_game_tag: "FuuTime#xdd",
    tournaments: [
      { id: "t1", name: "Friday Open", status: "accepting_players", registered_player_count: 4, max_players: 8, registered: true, registration_status: "registered", created_at: "2026-09-21T00:00:00Z" },
      { id: "t2", name: "Saturday Cup", status: "in_progress", registered_player_count: 8, max_players: 8, registered: false, created_at: "2026-09-20T00:00:00Z" },
    ],
  });
  assert.equal(viewModel.playerAccountId, "42");
  assert.equal(viewModel.riotGameTag, "FuuTime#xdd");
  assert.equal(viewModel.tournaments.length, 2);
  assert.equal(viewModel.tournaments[0]?.isRegistered, true);
  assert.equal(viewModel.tournaments[0]?.registrationStatus, "registered");
  assert.equal(viewModel.tournaments[1]?.isRegistered, false);
  assert.equal(viewModel.tournaments[1]?.registrationStatus, null);
  assert.equal(viewModel.signedUpCount, 1);
});

test("mapPlayerDashboardViewModel tolerates missing optional fields", () => {
  const viewModel = mapPlayerDashboardViewModel({ tournaments: [] });
  assert.equal(viewModel.playerAccountId, null);
  assert.equal(viewModel.username, null);
  assert.equal(viewModel.discordUserId, null);
  assert.equal(viewModel.riotGameTag, null);
  assert.deepEqual(viewModel.tournaments, []);
  assert.equal(viewModel.signedUpCount, 0);
});

test("mapPlayerDashboardViewModel maps the account's profile fields and per-tournament check-in state", () => {
  const viewModel = mapPlayerDashboardViewModel({
    player_account_id: "42",
    username: "fuutime",
    email: "player@example.com",
    discord_user_id: "discord-1",
    discord_username: "FuuTime",
    discord_avatar: "abcd",
    riot_game_tag: "FuuTime#xdd",
    tournaments: [
      {
        id: "t1",
        name: "Friday Open",
        status: "accepting_players",
        check_in_status: "open",
        registered_player_count: 4,
        max_players: 8,
        registered: true,
        registration_status: "registered",
        checked_in: false,
        participated: false,
        created_at: "2026-09-21T00:00:00Z",
      },
    ],
  });
  assert.equal(viewModel.username, "fuutime");
  assert.equal(viewModel.discordUserId, "discord-1");
  assert.equal(viewModel.tournaments[0]?.checkInStatus, "open");
  assert.equal(viewModel.tournaments[0]?.checkedIn, false);
  assert.equal(viewModel.tournaments[0]?.participated, false);
});

test("mapPlayerDashboardViewModel defaults checkInStatus and tolerates a tournament row missing the new fields", () => {
  const viewModel = mapPlayerDashboardViewModel({
    tournaments: [
      { id: "t1", name: "Friday Open", status: "accepting_players", registered_player_count: 4, max_players: 8, registered: true, registration_status: "registered", created_at: "2026-09-21T00:00:00Z" },
    ],
  });
  assert.equal(viewModel.tournaments[0]?.checkInStatus, "not_started");
  assert.equal(viewModel.tournaments[0]?.checkedIn, false);
  assert.equal(viewModel.tournaments[0]?.participated, false);
});

test("getPlayerDashboard calls the read model with the player account id", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [{ view_model: { player_account_id: "42", tournaments: [] } }]);
    const dashboard = await getPlayerDashboard("42");
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/get_player_dashboard_view_model");
    assert.equal(calls[0]?.method, "POST");
    assert.deepEqual(calls[0]?.body, { p_player_account_id: "42" });
    assert.equal(dashboard?.playerAccountId, "42");
  });
});

test("getPlayerDashboard returns null when the read model returns nothing", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [{ view_model: null }]);
    const dashboard = await getPlayerDashboard("42");
    assert.equal(dashboard, null);
  });
});