import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST } from "../app/api/tournaments/[tournamentId]/google-sheets/route";

function configureDatabase(fetchImpl: typeof fetch) {
  process.env.SUPABASE_URL = "https://database.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  globalThis.fetch = fetchImpl;
}

function restoreDatabase(originalFetch: typeof fetch, original: Record<string, string | undefined>) {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("GET sheet export status returns not_created for an owned tournament", async () => {
  const originalFetch = globalThis.fetch;
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    TFT_REQUIRE_AUTH: process.env.TFT_REQUIRE_AUTH,
  };
  process.env.TFT_REQUIRE_AUTH = "false";
  configureDatabase(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/tournaments")) {
      return new Response(JSON.stringify([{ id: "tournament-1", host_user_id: 1 }]), { status: 200 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  });
  try {
    const response = await GET(new Request("https://app.example"), { params: Promise.resolve({ tournamentId: "tournament-1" }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      tournamentId: "tournament-1",
      connectionState: "disconnected",
      state: "not_created",
      spreadsheetId: null,
      spreadsheetUrl: null,
      desiredRevision: 0,
      syncedRevision: 0,
      dirtyAt: null,
      lastSyncedAt: null,
      nextAttemptAt: null,
      lastError: null,
    });
  } finally {
    restoreDatabase(originalFetch, original);
  }
});

test("POST sheet export endpoint queues an idempotent export", async () => {
  const originalFetch = globalThis.fetch;
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    TFT_REQUIRE_AUTH: process.env.TFT_REQUIRE_AUTH,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN,
  };
  process.env.TFT_REQUIRE_AUTH = "false";
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_REFRESH_TOKEN = "test-refresh-token";
  const methods: string[] = [];
  configureDatabase(async (input, options) => {
    const url = new URL(String(input));
    methods.push(options?.method ?? "GET");
    if (url.pathname.endsWith("/tournaments")) {
      return new Response(JSON.stringify([{ id: "tournament-1", host_user_id: 1 }]), { status: 200 });
    }
    if (url.pathname.endsWith("/tournament_sheet_exports") && (options?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response(JSON.stringify([{
      id: "export-1",
      tournament_id: "tournament-1",
      spreadsheet_id: null,
      spreadsheet_url: null,
      state: "queued",
      desired_revision: 1,
      synced_revision: 0,
      dirty_at: "2026-07-22T00:00:00.000Z",
      last_synced_at: null,
      next_attempt_at: null,
      last_error_code: null,
      last_error_message: null,
    }]), { status: 201 });
  });
  try {
    const response = await POST(new Request("https://app.example"), { params: Promise.resolve({ tournamentId: "tournament-1" }) });
    assert.equal(response.status, 202);
    const body = await response.json() as { state: string; desiredRevision: number };
    assert.equal(body.state, "queued");
    assert.equal(body.desiredRevision, 1);
    assert.deepEqual(methods, ["GET", "GET", "GET", "POST"]);
  } finally {
    restoreDatabase(originalFetch, original);
  }
});

test("export endpoint refuses anonymous access when authentication is required", async () => {
  const previous = process.env.TFT_REQUIRE_AUTH;
  process.env.TFT_REQUIRE_AUTH = "true";
  try {
    const response = await POST(new Request("https://app.example"), { params: Promise.resolve({ tournamentId: "tournament-1" }) });
    assert.equal(response.status, 401);
  } finally {
    if (previous === undefined) delete process.env.TFT_REQUIRE_AUTH;
    else process.env.TFT_REQUIRE_AUTH = previous;
  }
});

test("export endpoint reports missing Google worker configuration before queueing", async () => {
  const previous = {
    TFT_REQUIRE_AUTH: process.env.TFT_REQUIRE_AUTH,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  };
  process.env.TFT_REQUIRE_AUTH = "false";
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    const response = await POST(new Request("https://app.example"), { params: Promise.resolve({ tournamentId: "tournament-1" }) });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Google Sheets publishing is not fully configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
      code: "GOOGLE_SHEETS_NOT_CONFIGURED",
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
