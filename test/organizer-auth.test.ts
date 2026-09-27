import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { NextRequest } from "next/server";
import { GET as callback } from "../app/api/auth/google/callback/route";
import {
  decodeSessionCookie,
  encodeSessionCookie,
  getOrganizerSessionFromRequest,
  SESSION_COOKIE_NAME,
} from "../lib/auth/session";
import { proxy } from "../proxy";

// A structurally valid but unsigned JWT: enough for jose's jwtVerify to parse
// the header and look for a matching JWKS key, but with no real signature. It
// exercises the "no key matches this token's kid" fallback path (the same
// path a project still on Supabase's legacy shared HS256 secret takes, since
// that secret is never published via JWKS) without needing a real signed
// token or key pair.
function unverifiableAccessToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "auth-1", email: "host@example.com" })).toString("base64url");
  return `${header}.${payload}.sig`;
}

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
    // A relative request.url origin (like `next start` resolves to on
    // Railway) must not leak into the redirect: the Location header below
    // must be a same-origin relative path either way.
    const response = await callback(new Request("http://localhost:8080/api/auth/google/callback?code=oauth-code", {
      headers: { cookie: "tftourney-google-pkce=verifier; tftourney-google-return-to=%2Fdashboard; tftourney-google-intent=signin" },
    }));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/dashboard?authSuccess=google");
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

test("callback redirects to a signin error instead of throwing when the token exchange fails unexpectedly", async () => {
  const originalFetch = globalThis.fetch;
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  globalThis.fetch = async () => {
    throw new Error("network unreachable");
  };
  try {
    const response = await callback(new Request("http://localhost:8080/api/auth/google/callback?code=oauth-code", {
      headers: { cookie: "tftourney-google-pkce=verifier; tftourney-google-return-to=%2Fdashboard; tftourney-google-intent=signin" },
    }));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "/signin?authError=google_oauth_failed&returnTo=%2Fdashboard");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("getOrganizerSessionFromRequest treats a failed organizer lookup as signed out instead of throwing", async () => {
  const originalFetch = globalThis.fetch;
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  // A URL unique to this test: the JWKS fetcher is cached at module scope
  // keyed by this URL, and jose's own cache has a cooldown before it will
  // refetch on a kid miss -- sharing a URL with another JWKS-exercising test
  // in this file could make one test's cached "no such key" answer leak into
  // another's, depending on run order.
  process.env.SUPABASE_URL = "https://supabase-jwks-miss.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/.well-known/jwks.json")) {
      return new Response(JSON.stringify({ keys: [] }), { status: 200 });
    }
    if (url.includes("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "auth-1", email: "host@example.com" }), { status: 200 });
    }
    if (url.includes("/rest/v1/users")) {
      return new Response("internal error", { status: 500 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const cookie = encodeSessionCookie({ accessToken: unverifiableAccessToken(), refreshToken: "refresh", expiresAt: 999999999999 });
    const organizer = await getOrganizerSessionFromRequest(
      new Request("https://app.example/dashboard", { headers: { cookie: `${SESSION_COOKIE_NAME}=${cookie}` } }),
    );
    assert.equal(organizer, null);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("getOrganizerSessionFromRequest verifies a genuinely-signed access token locally, with no call to /auth/v1/user", async () => {
  const originalFetch = globalThis.fetch;
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const supabaseUrl = "https://supabase-jwks-match.example";
  process.env.SUPABASE_URL = supabaseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const kid = "local-verify-test-key";
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" };
  const accessToken = await new SignJWT({ email: "host@example.com" })
    .setProtectedHeader({ alg: "ES256", kid })
    .setSubject("auth-1")
    .setIssuer(`${supabaseUrl}/auth/v1`)
    .setExpirationTime("1h")
    .sign(privateKey);

  let calledAuthUserEndpoint = false;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/.well-known/jwks.json")) {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    }
    if (url.includes("/auth/v1/user")) {
      calledAuthUserEndpoint = true;
      return new Response(JSON.stringify({ id: "auth-1", email: "host@example.com" }), { status: 200 });
    }
    if (url.includes("/rest/v1/users")) {
      return new Response(JSON.stringify([{ id: 7, email: "host@example.com", auth_user_id: "auth-1" }]), { status: 200 });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const cookie = encodeSessionCookie({ accessToken, refreshToken: "refresh", expiresAt: 999999999999 });
    const organizer = await getOrganizerSessionFromRequest(
      new Request("https://app.example/dashboard", { headers: { cookie: `${SESSION_COOKIE_NAME}=${cookie}` } }),
    );
    assert.deepEqual(organizer, { authUserId: "auth-1", hostUserId: "7", email: "host@example.com", isLocal: false });
    assert.equal(calledAuthUserEndpoint, false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("getOrganizerSessionFromRequest rejects a malformed access token without making any network call", async () => {
  const originalFetch = globalThis.fetch;
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.SUPABASE_URL = "https://supabase-jwks-malformed.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  globalThis.fetch = async (input) => {
    throw new Error(`Unexpected request: ${String(input)}`);
  };
  try {
    const cookie = encodeSessionCookie({ accessToken: "not-a-jwt", refreshToken: "refresh", expiresAt: 999999999999 });
    const organizer = await getOrganizerSessionFromRequest(
      new Request("https://app.example/dashboard", { headers: { cookie: `${SESSION_COOKIE_NAME}=${cookie}` } }),
    );
    assert.equal(organizer, null);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("the proxy leaves the session cookie untouched when the refresh request throws", async () => {
  const originalFetch = globalThis.fetch;
  const original = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  globalThis.fetch = async () => {
    throw new Error("network unreachable");
  };
  try {
    const cookie = encodeSessionCookie({ accessToken: "old-access", refreshToken: "old-refresh", expiresAt: 1 });
    const request = new NextRequest("https://app.example/dashboard", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
    });
    const response = await proxy(request);
    assert.equal(response.headers.get("set-cookie"), null);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
