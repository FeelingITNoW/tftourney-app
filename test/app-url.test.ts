import assert from "node:assert/strict";
import test from "node:test";
import { appRedirect, getAppOrigin, getAppOriginFromHost } from "../lib/app-url";

type Saved = Record<string, string | undefined>;

function withEnv<T>(value: string | undefined, run: () => T): T {
  const saved: Saved = { TFTOURNEY_APP_URL: process.env.TFTOURNEY_APP_URL };
  if (value === undefined) delete process.env.TFTOURNEY_APP_URL;
  else process.env.TFTOURNEY_APP_URL = value;
  try {
    return run();
  } finally {
    if (saved.TFTOURNEY_APP_URL === undefined) delete process.env.TFTOURNEY_APP_URL;
    else process.env.TFTOURNEY_APP_URL = saved.TFTOURNEY_APP_URL;
  }
}

test("getAppOrigin prefers the configured deployment URL over the request host", () => {
  withEnv("https://tftourney-app-production.up.railway.app", () => {
    const origin = getAppOrigin(new Request("http://localhost:3000/api/auth/google"));
    assert.equal(origin, "https://tftourney-app-production.up.railway.app");
  });
});

test("getAppOrigin strips a trailing slash from the configured URL", () => {
  withEnv("https://app.example/", () => {
    assert.equal(getAppOrigin(), "https://app.example");
  });
});

test("getAppOrigin falls back to the request origin when nothing is configured", () => {
  withEnv(undefined, () => {
    assert.equal(getAppOrigin(new Request("https://app.example/api/auth/google")), "https://app.example");
  });
});

test("getAppOrigin returns an empty string without a configured URL or request", () => {
  withEnv(undefined, () => {
    assert.equal(getAppOrigin(), "");
  });
});

test("getAppOriginFromHost prefers the configured deployment URL over the host header", () => {
  withEnv("https://tftourney-app-production.up.railway.app", () => {
    assert.equal(getAppOriginFromHost("internal.service:8080"), "https://tftourney-app-production.up.railway.app");
  });
});

test("getAppOriginFromHost serves local development hosts over http", () => {
  withEnv(undefined, () => {
    assert.equal(getAppOriginFromHost("localhost:3000"), "http://localhost:3000");
    assert.equal(getAppOriginFromHost("127.0.0.1:3000"), "http://127.0.0.1:3000");
  });
});

test("getAppOriginFromHost serves deployed hosts over https", () => {
  withEnv(undefined, () => {
    assert.equal(
      getAppOriginFromHost("tftourney-app-production.up.railway.app"),
      "https://tftourney-app-production.up.railway.app",
    );
  });
});

test("getAppOriginFromHost returns an empty string when the host is missing", () => {
  withEnv(undefined, () => {
    assert.equal(getAppOriginFromHost(null), "");
    assert.equal(getAppOriginFromHost(undefined), "");
  });
});

test("getAppOrigin adds https:// to a scheme-less configured deployment URL", () => {
  withEnv("tftourney-app-production.up.railway.app", () => {
    assert.equal(getAppOrigin(), "https://tftourney-app-production.up.railway.app");
  });
});

test("getAppOrigin adds http:// to a scheme-less localhost configured URL", () => {
  withEnv("localhost:3000", () => {
    assert.equal(getAppOrigin(), "http://localhost:3000");
  });
});

test("getAppOrigin ignores an invalid configured URL and falls back", () => {
  withEnv("not a url", () => {
    assert.equal(getAppOrigin(new Request("https://app.example/api/auth/google")), "https://app.example");
  });
});

test("getAppOrigin uses forwarded headers before the request origin", () => {
  withEnv(undefined, () => {
    const request = new Request("http://localhost:8080/api/auth/google", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "tftourney-app-production.up.railway.app" },
    });
    assert.equal(getAppOrigin(request), "https://tftourney-app-production.up.railway.app");
  });
});

test("getAppOrigin uses only the first value of a comma-separated forwarded header", () => {
  withEnv(undefined, () => {
    const request = new Request("http://localhost:8080/api/auth/google", {
      headers: { "x-forwarded-proto": "https, http", "x-forwarded-host": "app.example, internal.proxy" },
    });
    assert.equal(getAppOrigin(request), "https://app.example");
  });
});

test("getAppOrigin ignores x-forwarded-port so it never appends the internal listen port", () => {
  withEnv(undefined, () => {
    const request = new Request("http://localhost:8080/api/auth/google", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "app.example", "x-forwarded-port": "8080" },
    });
    assert.equal(getAppOrigin(request), "https://app.example");
  });
});

test("getAppOrigin falls back to RAILWAY_PUBLIC_DOMAIN when configured and forwarded headers are both absent", () => {
  withEnv(undefined, () => {
    const saved = process.env.RAILWAY_PUBLIC_DOMAIN;
    process.env.RAILWAY_PUBLIC_DOMAIN = "tftourney-app-production.up.railway.app";
    try {
      assert.equal(getAppOrigin(new Request("http://localhost:8080/api/auth/google")), "https://tftourney-app-production.up.railway.app");
    } finally {
      if (saved === undefined) delete process.env.RAILWAY_PUBLIC_DOMAIN;
      else process.env.RAILWAY_PUBLIC_DOMAIN = saved;
    }
  });
});

test("appRedirect returns a relative Location header", () => {
  const response = appRedirect("/dashboard");
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "/dashboard");
});

test("appRedirect appends and encodes query params", () => {
  const response = appRedirect("/signin", { authError: "google_oauth_failed", returnTo: "/a b" });
  const location = response.headers.get("location") ?? "";
  assert.match(location, /^\/signin\?/);
  const params = new URLSearchParams(location.split("?")[1]);
  assert.equal(params.get("authError"), "google_oauth_failed");
  assert.equal(params.get("returnTo"), "/a b");
});

test("appRedirect rejects a protocol-relative path and uses the fallback", () => {
  const response = appRedirect("//evil.example/phish");
  assert.equal(response.headers.get("location"), "/");
});
