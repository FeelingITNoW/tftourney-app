import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as callback } from "../app/api/auth/google/callback/route";
import { decodeSessionCookie, encodeSessionCookie, SESSION_COOKIE_NAME } from "../lib/auth/session";
import { proxy } from "../proxy";

test("session cookies round-trip token expiry metadata", () => {
  const encoded = encodeSessionCookie({ accessToken: "access", refreshToken: "refresh", expiresAt: 123 });
  assert.deepEqual(decodeSessionCookie(encoded), { accessToken: "access", refreshToken: "refresh", expiresAt: 123 });
});

test("identity callback creates the app session without requiring Drive refresh access", async () => {
  const originalFetch = globalThis.fetch;
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.includes("/auth/v1/token")) {
      return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }), { status: 200 });
    }
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "auth-1", email: "host@example.com" }), { status: 200 });
    }
    if (url.includes("/rpc/claim_or_create_organizer")) {
      assert.equal(options?.method, "POST");
      assert.match(String(options?.body), /auth-1/);
      return new Response(JSON.stringify([{ id: 7, email: "host@example.com", auth_user_id: "auth-1" }]), { status: 200 });
    }
    throw new Error(`Unexpected callback request: ${url}`);
  };

  try {
    const response = await callback(new Request("https://app.example/api/auth/google/callback?code=oauth-code", {
      headers: { cookie: "tftourney-google-pkce=verifier; tftourney-google-return-to=%2Fdashboard; tftourney-google-intent=signin" },
    }));
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get("location") as string).pathname, "/dashboard");
    assert.match(response.headers.get("location") ?? "", /authSuccess=google/);
    assert.match(response.headers.get("set-cookie") ?? "", /tftourney-session=/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("expired sessions are refreshed by the request proxy", async () => {
  const originalFetch = globalThis.fetch;
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  let refreshCalls = 0;
  globalThis.fetch = async () => {
    refreshCalls += 1;
    return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }), { status: 200 });
  };
  try {
    const cookie = encodeSessionCookie({ accessToken: "old-access", refreshToken: "old-refresh", expiresAt: 1 });
    const request = new NextRequest("https://app.example/dashboard", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
    });
    const response = await proxy(request);
    assert.equal(refreshCalls, 1);
    assert.match(response.headers.get("set-cookie") ?? "", /tftourney-session=/);
    assert.match(response.headers.get("set-cookie") ?? "", /new-access/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
