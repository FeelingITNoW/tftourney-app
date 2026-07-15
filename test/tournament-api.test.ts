import assert from "node:assert/strict";
import test from "node:test";
import { deleteTournament } from "../lib/db/tournaments/api";

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
