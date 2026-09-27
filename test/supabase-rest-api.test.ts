import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseRequestError, supabaseRestRequest } from "../lib/db/supabase-rest/api";

test("accepts a successful Supabase REST response with an empty body", async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  global.fetch = async () => new Response(null, { status: 200 });

  try {
    const result = await supabaseRestRequest<null>("organizer_google_connections", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { user_id: 1 },
    });

    assert.equal(result, null);
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test("a PostgREST error response is parsed into typed fields with a clean message", async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        code: "23505",
        message: 'duplicate key value violates unique constraint "tournament_registrations_discord_user_idx"',
        details: "Key (tournament_id, discord_user_id)=(1, 123) already exists.",
        hint: null,
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );

  try {
    await assert.rejects(
      () => supabaseRestRequest("tournament_registrations", { method: "POST", body: {} }),
      (error: unknown) => {
        assert.ok(error instanceof DatabaseRequestError);
        assert.equal(error.status, 409);
        assert.equal(error.code, "23505");
        assert.equal(error.message, 'duplicate key value violates unique constraint "tournament_registrations_discord_user_idx"');
        assert.equal(error.details, "Key (tournament_id, discord_user_id)=(1, 123) already exists.");
        assert.equal(error.hint, null);
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});

test("a non-PostgREST error response falls back to a generic wrapped message with no parsed fields", async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  global.fetch = async () => new Response("upstream gateway error", { status: 502 });

  try {
    await assert.rejects(
      () => supabaseRestRequest("tournaments", {}),
      (error: unknown) => {
        assert.ok(error instanceof DatabaseRequestError);
        assert.equal(error.status, 502);
        assert.equal(error.code, null);
        assert.match(error.message, /Database request failed with 502: upstream gateway error/);
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
