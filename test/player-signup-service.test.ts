import assert from "node:assert/strict";
import test from "node:test";
import { registerPlayerAccountForTournament } from "../lib/players/registration";

type Call = { method: string; pathname: string; body: unknown };

function withEnv<T>(run: (calls: Call[]) => Promise<T>): Promise<T> {
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    RIOT_API_KEY: process.env.RIOT_API_KEY,
  };
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.RIOT_API_KEY = "riot-key";
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

const tournamentRow = {
  id: "t1",
  host_user_id: "1",
  name: "Cup",
  max_players: 8,
  format_id: "default",
  status: "accepting_players",
  current_round_id: null,
  format_config: {},
  created_at: "2026-09-21T00:00:00Z",
};

test("registers a player using their stored Riot identity and links the registration", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/player_accounts") {
        return [{ id: 42, auth_user_id: null, discord_user_id: "discord-1", discord_username: null, discord_avatar: null, riot_puuid: "puuid-1", riot_game_tag: "FuuTime#xdd", email: null, created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" }];
      }
      if (call.pathname === "/rest/v1/tournaments") return [tournamentRow];
      if (call.pathname === "/rest/v1/tournament_registrations") {
        return [{ id: 7, tournament_id: "t1", display_name: "FuuTime#xdd", riot_puuid: "puuid-1", player_account_id: 42, created_at: "2026-09-21T00:00:00Z" }];
      }
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const registration = await registerPlayerAccountForTournament({
      playerAccountId: "42",
      tournamentId: "t1",
    });
    assert.equal(registration.displayName, "FuuTime#xdd");
    assert.equal(calls.some((call) => call.pathname.includes("riot/account/v1")), false);
    const insert = calls.find((call) => call.pathname === "/rest/v1/tournament_registrations");
    assert.equal((insert!.body as Record<string, unknown>).player_account_id, "42");
  });
});

test("verifies and links a newly entered game tag before registering", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/player_accounts") {
        return [{ id: 42, auth_user_id: null, discord_user_id: null, discord_username: null, discord_avatar: null, riot_puuid: null, riot_game_tag: null, email: null, created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" }];
      }
      if (call.pathname.includes("/riot/account/v1/accounts/by-riot-id/")) {
        return { puuid: "puuid-2", gameName: "Braven", tagLine: "ph2" };
      }
      if (call.pathname === "/rest/v1/rpc/link_riot_account_to_player") {
        return [{ id: 42, riot_puuid: "puuid-2", riot_game_tag: "Braven#ph2", auth_user_id: null, discord_user_id: null, discord_username: null, discord_avatar: null, email: null, created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" }];
      }
      if (call.pathname === "/rest/v1/tournaments") return [tournamentRow];
      if (call.pathname === "/rest/v1/tournament_registrations") {
        return [{ id: 8, tournament_id: "t1", display_name: "Braven#ph2", riot_puuid: "puuid-2", player_account_id: 42, created_at: "2026-09-21T00:00:00Z" }];
      }
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const registration = await registerPlayerAccountForTournament({
      playerAccountId: "42",
      tournamentId: "t1",
      gameTag: "Braven#ph2",
    });
    assert.equal(registration.displayName, "Braven#ph2");
    assert.equal(calls.some((call) => call.pathname === "/rest/v1/rpc/link_riot_account_to_player"), true);
  });
});

test("requires a Riot identity before registering an unlinked account", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/player_accounts") {
        return [{ id: 42, auth_user_id: null, discord_user_id: null, discord_username: null, discord_avatar: null, riot_puuid: null, riot_game_tag: null, email: null, created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" }];
      }
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    await assert.rejects(
      () => registerPlayerAccountForTournament({ playerAccountId: "42", tournamentId: "t1" }),
      /Riot/i,
    );
    assert.equal(calls.some((call) => call.pathname === "/rest/v1/tournament_registrations"), false);
  });
});

test("throws when the player account does not exist", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => []);
    await assert.rejects(
      () => registerPlayerAccountForTournament({ playerAccountId: "missing", tournamentId: "t1" }),
      /Player account was not found/,
    );
  });
});