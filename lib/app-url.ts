import { NextResponse } from "next/server";

// Single source of truth for the app's public origin. OAuth providers require an
// absolute redirect URI that matches what is registered in their portals, so the
// value must not depend on the incoming request (Next/Node resolves `request.url`
// to an internal host like http://localhost:3000 behind Railway's proxy).
//
// Prefer the explicitly configured deployment URL (TFTOURNEY_APP_URL), and fall
// back to the request's forwarded headers, then the request origin, only when
// running without that configuration (e.g. local `next dev`).

let warnedInvalidConfiguredUrl = false;

function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

// TFTOURNEY_APP_URL is documented as a full origin (e.g.
// "https://tftourney-app-production.up.railway.app"), but a platform's
// generated domain variable (Railway's included) is often just the bare host.
// Accept both: add a scheme when one is missing before validating, so a
// scheme-less value doesn't reach `new URL(path, origin)` downstream and throw
// "Invalid URL" (which previously surfaced as an HTTP 500 on every auth route).
function normalizeConfiguredOrigin(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `${isLocalHost(trimmed) ? "http" : "https"}://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    if (!warnedInvalidConfiguredUrl) {
      warnedInvalidConfiguredUrl = true;
      console.error("[app-url] TFTOURNEY_APP_URL is not a valid URL; ignoring it", { value: raw });
    }
    return null;
  }
}

function configuredOrigin(): string | null {
  const configured = process.env.TFTOURNEY_APP_URL;
  return configured ? normalizeConfiguredOrigin(configured) : null;
}

function firstHeaderValue(value: string | null): string {
  return (value ?? "").split(",")[0]?.trim() ?? "";
}

// Only consulted when TFTOURNEY_APP_URL is unset. Forwarded headers are set by
// Railway's edge (and any similar reverse proxy) and reflect the host the
// browser actually connected to. Deliberately ignore x-forwarded-port: Next
// fills it in with its own internal listen port when a proxy omits it, which
// would produce an origin like "https://example.com:8080".
function forwardedOrigin(headers: Headers): string | null {
  const host = firstHeaderValue(headers.get("x-forwarded-host")) || firstHeaderValue(headers.get("host"));
  if (!host) return null;
  const proto = firstHeaderValue(headers.get("x-forwarded-proto"));
  const scheme = proto === "http" || proto === "https" ? proto : isLocalHost(host) ? "http" : "https";
  return `${scheme}://${host}`;
}

function railwayOrigin(): string | null {
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return domain ? `https://${domain}` : null;
}

export function getAppOrigin(request?: Request): string {
  const configured = configuredOrigin();
  if (configured) return configured;
  if (request) {
    const forwarded = forwardedOrigin(request.headers);
    if (forwarded) return forwarded;
  }
  const railway = railwayOrigin();
  if (railway) return railway;
  if (request) return new URL(request.url).origin;
  return "";
}

// Server actions have no `Request` to read an origin from, so they derive it
// from the forwarded Host header instead. Local development hosts are served
// over http; deployed hosts (e.g. Railway) are served over https.
export function getAppOriginFromHost(host: string | null | undefined): string {
  const configured = configuredOrigin();
  if (configured) return configured;
  if (!host) return railwayOrigin() ?? "";
  const normalized = host.replace(/\/+$/, "");
  return `${isLocalHost(normalized) ? "http" : "https"}://${normalized}`;
}

function safePath(value: string, fallback: string): string {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : fallback;
}

// Builds a same-origin redirect response using a relative Location header.
// Relative Location headers are resolved by the browser against the URL it
// actually requested, so an in-app redirect never needs to know its own public
// origin at all -- unlike NextResponse.redirect(new URL(path, request.url)),
// which depends on request.url resolving to the public host (it does not,
// under `next start` behind a reverse proxy: see getAppOrigin above).
export function appRedirect(
  path: string,
  params?: Record<string, string>,
  init?: { status?: number; fallback?: string },
): NextResponse {
  const fallback = init?.fallback ?? "/";
  const safe = safePath(path, fallback);
  const query = new URLSearchParams(params).toString();
  const location = query ? `${safe}${safe.includes("?") ? "&" : "?"}${query}` : safe;
  return new NextResponse(null, {
    status: init?.status ?? 307,
    headers: { Location: location },
  });
}
