import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/internal/discord/signup/route";

type Call = { method: string; pathname: string; body: unknown };

function withEnv<T>(run: (calls: Call[]) => Promise<T>): Promise<T> {
  const original = {
    DISCORD_BOT_API_SECRET: process.env.DISCORD_BOT_API_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    RIOT_API_KEY: process.env.RIOT_API_KEY,
  };
  process.env.DISCORD_BOT_API_SECRET = "bot-secret";
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

function signupRequest(body: unknown): Request {
  return new Request("https://app.example/api/internal/discord/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer bot-secret" },
    body: JSON.stringify(body),
  });
}

test("bot signup claims a player account and stores player_account_id on the registration", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/tournament_discord_configs") {
        return [{ tournament_id: "t1", guild_id: "g1", state: "active" }];
      }
      if (call.pathname === "/rest/v1/tournaments") {
        return [{ id: "t1", host_user_id: "1", name: "Cup", max_players: 8, format_id: "default", status: "accepting_players", current_round_id: null, format_config: {}, created_at: "2026-09-21T00:00:00Z" }];
      }
      if (call.pathname.includes("/riot/account/v1/accounts/by-riot-id/")) {
        return { puuid: "puuid-1", gameName: "FuuTime", tagLine: "xdd" };
      }
      if (call.pathname === "/rest/v1/rpc/claim_or_create_player_by_discord") {
        return [{ id: 42, discord_user_id: "discord-1", riot_puuid: null, riot_game_tag: null, auth_user_id: null, discord_username: null, discord_avatar: null, email: null, created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" }];
      }
      if (call.pathname === "/rest/v1/rpc/link_riot_account_to_player") {
        return [{ id: 42, discord_user_id: "discord-1", riot_puuid: "puuid-1", riot_game_tag: "FuuTime#xdd", auth_user_id: null, discord_username: null, discord_avatar: null, email: null, created_at: "2026-09-21T00:00:00Z", updated_at: "2026-09-21T00:00:00Z" }];
      }
      if (call.pathname === "/rest/v1/tournament_registrations") {
        return [{ id: 7, tournament_id: "t1", display_name: "FuuTime#xdd", riot_puuid: "puuid-1", player_account_id: 42, created_at: "2026-09-21T00:00:00Z" }];
      }
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const response = await POST(signupRequest({ tournamentId: "t1", discordUserId: "discord-1", gameTag: "FuuTime#xdd" }));
    assert.equal(response.status, 201);
    const claim = calls.find((call) => call.pathname === "/rest/v1/rpc/claim_or_create_player_by_discord");
    assert.ok(claim);
    assert.equal((claim!.body as Record<string, unknown>).p_discord_user_id, "discord-1");
    const link = calls.find((call) => call.pathname === "/rest/v1/rpc/link_riot_account_to_player");
    assert.ok(link);
    assert.equal((link!.body as Record<string, unknown>).p_player_account_id, "42");
    assert.equal((link!.body as Record<string, unknown>).p_riot_puuid, "puuid-1");
    const insert = calls.find((call) => call.pathname === "/rest/v1/tournament_registrations");
    assert.ok(insert);
    assert.equal((insert!.body as Record<string, unknown>).player_account_id, "42");
    assert.equal((insert!.body as Record<string, unknown>).discord_user_id, "discord-1");
  });
});

test("bot signup still rejects a disconnected tournament before claiming an account", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/tournament_discord_configs") {
        return [{ tournament_id: "t1", guild_id: "g1", state: "disabled" }];
      }
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const response = await POST(signupRequest({ tournamentId: "t1", discordUserId: "discord-1", gameTag: "FuuTime#xdd" }));
    assert.equal(response.status, 409);
    assert.equal(calls.some((call) => call.pathname.includes("claim_or_create_player_by_discord")), false);
  });
});