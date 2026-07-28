import assert from "node:assert/strict";
import test from "node:test";
import { listHostedTournaments } from "../lib/db/tournaments/api";

test("hosted tournament queries filter by the authenticated organizer", async () => {
  const originalFetch = globalThis.fetch;
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  const requests: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith("/tournaments")) {
      return new Response(JSON.stringify([{
        id: "tournament-1",
        host_user_id: 42,
        name: "Organizer Open",
        max_players: 32,
        format_id: "default",
        status: "accepting_players",
        current_round_id: null,
        format_config: {},
        created_at: "2026-07-28T00:00:00.000Z",
      }]), { status: 200 });
    }
    if (url.pathname.endsWith("/tournament_registrations") || url.pathname.endsWith("/rounds")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    throw new Error(`Unexpected ownership request: ${url}`);
  };

  try {
    const tournaments = await listHostedTournaments("42");
    assert.equal(tournaments[0]?.hostUserId, "42");
    assert.equal(requests[0]?.searchParams.get("host_user_id"), "eq.42");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
