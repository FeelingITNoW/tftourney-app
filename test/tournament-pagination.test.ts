import assert from "node:assert/strict";
import test from "node:test";
import { listTournaments } from "../lib/db/tournaments/api";
import {
  buildPageHref,
  getPageNavigation,
  parsePageParam,
} from "../lib/pagination";

test("parses only canonical positive page values", () => {
  assert.deepEqual(parsePageParam(undefined), { page: 1, redirectPage: null });
  assert.deepEqual(parsePageParam("2"), { page: 2, redirectPage: null });
  assert.deepEqual(parsePageParam("1"), { page: 1, redirectPage: 1 });
  assert.deepEqual(parsePageParam("0"), { page: 1, redirectPage: 1 });
  assert.deepEqual(parsePageParam("-2"), { page: 1, redirectPage: 1 });
  assert.deepEqual(parsePageParam("1.5"), { page: 1, redirectPage: 1 });
  assert.deepEqual(parsePageParam(["2", "3"]), { page: 1, redirectPage: 1 });
});

test("builds bounded page navigation with ellipses", () => {
  assert.deepEqual(
    getPageNavigation(5, 10),
    [
      { type: "page", page: 1 },
      { type: "ellipsis", key: "ellipsis-3" },
      { type: "page", page: 3 },
      { type: "page", page: 4 },
      { type: "page", page: 5 },
      { type: "page", page: 6 },
      { type: "page", page: 7 },
      { type: "ellipsis", key: "ellipsis-10" },
      { type: "page", page: 10 },
    ],
  );
  assert.equal(buildPageHref("/", 1), "/");
  assert.equal(buildPageHref("/dashboard", 3), "/dashboard?page=3");
});

test("loads a public tournament page through one RPC request", async () => {
  const originalFetch = globalThis.fetch;
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  const requests: { url: URL; options?: RequestInit }[] = [];
  globalThis.fetch = async (input, options) => {
    requests.push({ url: new URL(String(input)), options });
    return new Response(
      JSON.stringify([
        {
          items: [
            {
              id: 9,
              host_user_id: 42,
              name: "Public Open",
              max_players: 32,
              format_id: "default",
              status: "in_progress",
              has_started: true,
              current_round_id: 12,
              current_round_number: 2,
              active_node_ids: [12, 13],
              created_at: "2026-07-28T00:00:00.000Z",
              registered_player_count: 24,
            },
          ],
          total_count: "11",
          page: "2",
          page_size: "10",
          total_pages: "2",
        },
      ]),
      { status: 200 },
    );
  };

  try {
    const page = await listTournaments({ page: 2, pageSize: 10 });
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0]?.url.pathname,
      "/rest/v1/rpc/list_tournament_summaries",
    );
    assert.equal(requests[0]?.options?.method, "POST");
    assert.deepEqual(JSON.parse(String(requests[0]?.options?.body)), {
      p_page: 2,
      p_page_size: 10,
      p_host_user_id: null,
    });
    assert.equal(page.items[0]?.id, "9");
    assert.equal(page.items[0]?.hostUserId, "42");
    assert.deepEqual(page.items[0]?.activeNodeIds, ["12", "13"]);
    assert.equal(page.items[0]?.registeredPlayerCount, 24);
    assert.deepEqual(
      {
        page: page.page,
        pageSize: page.pageSize,
        totalCount: page.totalCount,
        totalPages: page.totalPages,
      },
      { page: 2, pageSize: 10, totalCount: 11, totalPages: 2 },
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
