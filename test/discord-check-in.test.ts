import assert from "node:assert/strict";
import test from "node:test";
import {
  getTournamentCheckInState,
  prepareTournamentStartRoster,
  restoreTournamentStartRoster,
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


test("prepareTournamentStartRoster is a no-op when there is no Discord config", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/tournament_discord_configs") return [];
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const result = await prepareTournamentStartRoster("t1");
    assert.deepEqual(result, []);
    assert.equal(calls.length, 1);
  });
});

test("prepareTournamentStartRoster is a no-op when the config is disabled", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/tournament_discord_configs") {
        return [{ tournament_id: "t1", guild_id: "g1", state: "disabled" }];
      }
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const result = await prepareTournamentStartRoster("t1");
    assert.deepEqual(result, []);
    assert.equal(calls.length, 1);
  });
});

test("prepareTournamentStartRoster is a no-op when check-in has never opened", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/tournament_discord_configs") return [{ tournament_id: "t1", guild_id: "g1", state: "active" }];
      if (call.pathname === "/rest/v1/tournaments") return [{ check_in_status: "not_started" }];
      if (call.pathname === "/rest/v1/tournament_registrations") return [];
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const result = await prepareTournamentStartRoster("t1");
    assert.deepEqual(result, []);
    assert.equal(calls.some((call) => call.method === "PATCH"), false);
  });
});

test("prepareTournamentStartRoster closes an open check-in before demoting non-checked-in registered players", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/tournament_discord_configs") return [{ tournament_id: "t1", guild_id: "g1", state: "active" }];
      if (call.pathname === "/rest/v1/tournaments") return [{ check_in_status: "open" }];
      if (call.pathname === "/rest/v1/tournament_registrations") {
        if (call.method === "PATCH") return [{ id: "reg-1" }, { id: "reg-2" }];
        return [];
      }
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const result = await prepareTournamentStartRoster("t1");
    assert.deepEqual(result, ["reg-1", "reg-2"]);

    const closeCall = calls.find((call) => call.pathname === "/rest/v1/tournaments" && call.method === "PATCH");
    assert.ok(closeCall);
    assert.equal((closeCall!.body as Record<string, unknown>).check_in_status, "closed");

    const demoteCall = calls.find((call) => call.pathname === "/rest/v1/tournament_registrations" && call.method === "PATCH");
    assert.ok(demoteCall);
    assert.match(demoteCall!.search, /registration_status=eq\.registered/);
    assert.match(demoteCall!.search, /checked_in_at=is\.null/);
    assert.match(demoteCall!.search, /select=id/);
    assert.equal((demoteCall!.body as Record<string, unknown>).registration_status, "waitlisted");

    // The tournaments PATCH (close) must happen before the registrations PATCH (demote).
    const closeIndex = calls.indexOf(closeCall!);
    const demoteIndex = calls.indexOf(demoteCall!);
    assert.ok(closeIndex < demoteIndex);
  });
});

test("prepareTournamentStartRoster demotes without closing when check-in is already closed", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/tournament_discord_configs") return [{ tournament_id: "t1", guild_id: "g1", state: "active" }];
      if (call.pathname === "/rest/v1/tournaments") return [{ check_in_status: "closed" }];
      if (call.pathname === "/rest/v1/tournament_registrations") {
        if (call.method === "PATCH") return [{ id: "reg-1" }];
        return [];
      }
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    const result = await prepareTournamentStartRoster("t1");
    assert.deepEqual(result, ["reg-1"]);
    assert.equal(calls.some((call) => call.pathname === "/rest/v1/tournaments" && call.method === "PATCH"), false);
  });
});

test("restoreTournamentStartRoster is a no-op for an empty list", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => {
      throw new Error("fetch should not be called");
    });
    await restoreTournamentStartRoster([]);
    assert.equal(calls.length, 0);
  });
});

test("restoreTournamentStartRoster restores the given registrations to registered", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, () => null);
    await restoreTournamentStartRoster(["a", "b"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.pathname, "/rest/v1/tournament_registrations");
    assert.match(calls[0]?.search ?? "", /id=in\.\(a,b\)/);
    assert.deepEqual(calls[0]?.body, { registration_status: "registered" });
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

test("setRegistrationCheckIn rejects when check-in has never opened", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/tournament_discord_configs") return [{ tournament_id: "t1", guild_id: "g1", state: "active" }];
      if (call.pathname === "/rest/v1/tournaments") return [{ check_in_status: "not_started" }];
      if (call.pathname === "/rest/v1/tournament_registrations") return [];
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    await assert.rejects(() => setRegistrationCheckIn({ tournamentId: "t1", registrationId: "r1", checkedIn: true }));
  });
});

test("setRegistrationCheckIn scopes the write by tournament and sets/clears checked_in_at", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/tournament_discord_configs") return [{ tournament_id: "t1", guild_id: "g1", state: "active" }];
      if (call.pathname === "/rest/v1/tournaments") return [{ check_in_status: "closed" }];
      if (call.pathname === "/rest/v1/tournament_registrations") {
        if (call.method === "PATCH") return [{ id: "r1" }];
        return [];
      }
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    await setRegistrationCheckIn({ tournamentId: "t1", registrationId: "r1", checkedIn: true });
    const patchCall = calls.find((call) => call.pathname === "/rest/v1/tournament_registrations" && call.method === "PATCH");
    assert.ok(patchCall);
    assert.match(patchCall!.search, /id=eq\.r1/);
    assert.match(patchCall!.search, /tournament_id=eq\.t1/);
    assert.match(patchCall!.search, /registration_status=in\.\(registered,waitlisted\)/);
    assert.ok((patchCall!.body as Record<string, unknown>).checked_in_at);
  });
});

test("setRegistrationCheckIn clears checked_in_at when un-checking a player", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/tournament_discord_configs") return [{ tournament_id: "t1", guild_id: "g1", state: "active" }];
      if (call.pathname === "/rest/v1/tournaments") return [{ check_in_status: "closed" }];
      if (call.pathname === "/rest/v1/tournament_registrations") {
        if (call.method === "PATCH") return [{ id: "r1" }];
        return [];
      }
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    await setRegistrationCheckIn({ tournamentId: "t1", registrationId: "r1", checkedIn: false });
    const patchCall = calls.find((call) => call.pathname === "/rest/v1/tournament_registrations" && call.method === "PATCH");
    assert.equal((patchCall!.body as Record<string, unknown>).checked_in_at, null);
  });
});

test("setRegistrationCheckIn throws when the registration is not found", async () => {
  await withEnv(async (calls) => {
    stubFetch(calls, (call) => {
      if (call.pathname === "/rest/v1/tournament_discord_configs") return [{ tournament_id: "t1", guild_id: "g1", state: "active" }];
      if (call.pathname === "/rest/v1/tournaments") return [{ check_in_status: "closed" }];
      if (call.pathname === "/rest/v1/tournament_registrations") {
        if (call.method === "PATCH") return [];
        return [];
      }
      throw new Error(`Unexpected call to ${call.pathname}`);
    });
    await assert.rejects(() => setRegistrationCheckIn({ tournamentId: "t1", registrationId: "missing", checkedIn: true }));
  });
});
