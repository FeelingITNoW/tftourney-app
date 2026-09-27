import assert from "node:assert/strict";
import test from "node:test";
import {
  closeTournamentCheckIn,
  disconnectTournamentDiscord,
  getTournamentCheckInState,
  openTournamentCheckIn,
  setRegistrationCheckIn,
} from "../lib/discord/api";

type Call = { method: string; pathname: string; search: string; body: unknown };

function withEnv<T>(run: (calls: Call[]) => Promise<T>): Promise<T> {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalFetch = globalThis.fetch;
  const calls: Call[] = [];
  return run(calls).finally(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [
      ["SUPABASE_URL", originalUrl],
      ["SUPABASE_SERVICE_ROLE_KEY", originalKey],
      ["NEXT_PUBLIC_SUPABASE_URL", originalPublicUrl],
    ] as const) {
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
      search: decodeURIComponent(url.search),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(call);
    return new Response(JSON.stringify(respond(call)), { status: 200 });
  }) as typeof fetch;
}

// open/close/set-check-in and disconnect are now each a single RPC call --
// see 20260926000002_atomic_checkin_and_discord_mutations.sql for the
// business logic and atomicity this used to need several sequential
// PostgREST writes (and, for start_tournament, a separate compensating
// restore step) to approximate. These tests cover the thin wrapper: the
// right RPC, the right params, and the right result/error propagation.
// The SQL functions' own validation and rollback behavior were verified
// directly against a local Postgres built from this migration history.

test("openTournamentCheckIn posts to the RPC and returns whether it reopened", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => [{ reopened: true }]);
    const result = await openTournamentCheckIn("t1");
    assert.deepEqual(result, { reopened: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/open_tournament_check_in");
    assert.deepEqual(calls[0]?.body, { p_tournament_id: "t1" });
  });
});

test("openTournamentCheckIn throws when the RPC returns no row", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => []);
    await assert.rejects(() => openTournamentCheckIn("t1"));
  });
});

test("closeTournamentCheckIn posts to the RPC with the tournament id", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => null);
    await closeTournamentCheckIn("t1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/close_tournament_check_in");
    assert.deepEqual(calls[0]?.body, { p_tournament_id: "t1" });
  });
});

test("closeTournamentCheckIn propagates a rejection from the RPC (e.g. check-in not open)", async () => {
  await withEnv(async (calls) => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ code: "P0001", message: "Check-in is not open." }), { status: 400 })) as typeof fetch;
    void calls;
    await assert.rejects(() => closeTournamentCheckIn("t1"), /Check-in is not open\./);
  });
});

test("getTournamentCheckInState distinguishes checkedInCount from checkedInRegisteredCount", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/tournaments") return [{ check_in_status: "open", check_in_opened_at: null, check_in_closed_at: null }];
      if (call.pathname === "/rest/v1/tournament_registrations") {
        return [
          { id: "r1", display_name: "Alice", registration_status: "registered", checked_in_at: "2026-01-01T00:00:00Z", discord_user_id: "d1" },
          { id: "r2", display_name: "Bob", registration_status: "waitlisted", checked_in_at: "2026-01-01T00:00:00Z", discord_user_id: null },
          { id: "r3", display_name: "Cara", registration_status: "registered", checked_in_at: null, discord_user_id: null },
        ];
      }
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const state = await getTournamentCheckInState("t1");
    assert.ok(state);
    assert.equal(state!.checkedInCount, 2);
    assert.equal(state!.checkedInRegisteredCount, 1);
    assert.equal(state!.registrations.length, 3);
    assert.equal(state!.registrations[0]?.hasDiscord, true);
    assert.equal(state!.registrations[1]?.hasDiscord, false);
  });
});

test("setRegistrationCheckIn posts registration id, tournament id, and the desired state to the RPC", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => null);
    await setRegistrationCheckIn({ tournamentId: "t1", registrationId: "r1", checkedIn: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/set_registration_check_in");
    assert.deepEqual(calls[0]?.body, { p_tournament_id: "t1", p_registration_id: "r1", p_checked_in: true });
  });
});

test("setRegistrationCheckIn propagates a rejection from the RPC (e.g. registration not found)", async () => {
  await withEnv(async (calls) => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ code: "P0001", message: "Registration was not found." }), { status: 400 })) as typeof fetch;
    void calls;
    await assert.rejects(
      () => setRegistrationCheckIn({ tournamentId: "t1", registrationId: "missing", checkedIn: true }),
      /Registration was not found\./,
    );
  });
});

test("disconnectTournamentDiscord posts the tournament id and cleanup action to the RPC", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => null);
    await disconnectTournamentDiscord({ tournamentId: "t1", cleanupAction: "archive" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.pathname, "/rest/v1/rpc/disconnect_tournament_discord");
    assert.deepEqual(calls[0]?.body, { p_tournament_id: "t1", p_cleanup_action: "archive" });
  });
});
