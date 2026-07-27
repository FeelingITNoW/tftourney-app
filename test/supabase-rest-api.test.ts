import assert from "node:assert/strict";
import test from "node:test";
import { supabaseRestRequest } from "../lib/db/supabase-rest/api";

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
