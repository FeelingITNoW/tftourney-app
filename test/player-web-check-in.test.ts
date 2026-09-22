import assert from "node:assert/strict";
import test from "node:test";
import { checkInPlayerForTournament } from "../lib/players/registration";

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

function stubFetch(calls: Call[], respond: (call: Call) => unknown, status = 200): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      pathname: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    return new Response(JSON.stringify(respond(call)), { status });
  }) as typeof fetch;
}

// Web check-in is keyed on the player's durable account id, not a Discord id
// -- the counterpart to the Discord bot's check_in_discord_player, for a
// player who registered without linking Discord (see
// supabase/migrations/20260922000001_link_discord_to_player.sql).
test("checkInPlayerForTournament calls check_in_player_account with the tournament and player account ids", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [
      { registration_id: "9", display_name: "FuuTime#xdd", checked_in_at: "2026-09-22T00:00:00Z" },
    ]);
    const result = await checkInPlayerForTournament({ playerAccountId: "42", tournamentId: "1" });
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/check_in_player_account");
    assert.deepEqual(calls[0]?.body, { p_tournament_id: "1", p_player_account_id: "42" });
    assert.equal(result.registrationId, "9");
    assert.equal(result.checkedInAt, "2026-09-22T00:00:00Z");
  });
});

test("checkInPlayerForTournament surfaces the database's error when check-in is not open", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => ({ code: "P0001", message: "Check-in is not currently open." }), 400);
    await assert.rejects(
      () => checkInPlayerForTournament({ playerAccountId: "42", tournamentId: "1" }),
      /Check-in is not currently open\./,
    );
  });
});
