import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/auth/google/route";

test("Google Drive connection requests Drive access with PKCE", async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalEncryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  process.env.SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "test-encryption-key";
  try {
    const response = await GET(new Request("https://app.example/api/auth/google?intent=sheets&returnTo=%2Ftournaments%2F1"));
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location") as string);
    assert.equal(location.searchParams.get("provider"), "google");
    assert.equal(location.searchParams.get("scopes"), "https://www.googleapis.com/auth/drive.file");
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    assert.equal(location.searchParams.get("access_type"), "offline");
    assert.equal(location.searchParams.get("prompt"), "consent");
    assert.equal(location.searchParams.get("query_params"), null);
    assert.equal(location.searchParams.get("state"), null);
    assert.match(response.headers.get("set-cookie") ?? "", /tftourney-google-pkce=/);
    assert.match(response.headers.get("set-cookie") ?? "", /tftourney-google-return-to=%2Ftournaments%2F1/);
    assert.match(response.headers.get("set-cookie") ?? "", /tftourney-google-intent=sheets/);
  } finally {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    if (originalEncryptionKey === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = originalEncryptionKey;
  }
});

test("ordinary Google sign-in requests identity access without Drive consent", async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  try {
    const response = await GET(new Request("https://app.example/api/auth/google?returnTo=%2Fdashboard"));
    const location = new URL(response.headers.get("location") as string);
    assert.equal(location.searchParams.get("provider"), "google");
    assert.equal(location.searchParams.get("scopes"), null);
    assert.equal(location.searchParams.get("access_type"), null);
    assert.match(response.headers.get("set-cookie") ?? "", /tftourney-google-intent=signin/);
  } finally {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
