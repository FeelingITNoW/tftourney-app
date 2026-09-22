import assert from "node:assert/strict";
import test from "node:test";
import { getAppOrigin, getAppOriginFromHost } from "../lib/app-url";

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