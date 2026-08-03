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
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith("/rpc/list_tournament_summaries")) {
      assert.equal(options?.method, "POST");
      assert.deepEqual(JSON.parse(String(options?.body)), {
        p_page: 1,
        p_page_size: 10,
        p_host_user_id: "42",
      });
      return new Response(JSON.stringify([{
        items: [{
          id: "tournament-1",
          host_user_id: 42,
          name: "Organizer Open",
          max_players: 32,
          format_id: "default",
          status: "accepting_players",
          has_started: false,
          current_round_id: null,
          current_round_number: null,
          active_node_ids: [],
          created_at: "2026-07-28T00:00:00.000Z",
          registered_player_count: 0,
        }],
        total_count: 1,
        page: 1,
        page_size: 10,
        total_pages: 1,
      }]), { status: 200 });
    }
    throw new Error(`Unexpected ownership request: ${url}`);
  };

  try {
    const tournaments = await listHostedTournaments("42");
    assert.equal(tournaments.items[0]?.hostUserId, "42");
    assert.equal(requests.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
