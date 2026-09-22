// Single source of truth for the app's public origin. OAuth providers require an
// absolute redirect URI that matches what is registered in their portals, so the
// value must not depend on the incoming request (Next/Node resolves `request.url`
// to an internal host like http://localhost:3000 behind Railway's proxy).
//
// Prefer the explicitly configured deployment URL (TFTOURNEY_APP_URL), and fall
// back to the request origin only when running without that configuration (e.g.
// local `next dev`).
export function getAppOrigin(request?: Request): string {
  const configured = process.env.TFTOURNEY_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (request) return new URL(request.url).origin;
  return "";
}

// Server actions have no `Request` to read an origin from, so they derive it
// from the forwarded Host header instead. Local development hosts are served
// over http; deployed hosts (e.g. Railway) are served over https.
export function getAppOriginFromHost(host: string | null | undefined): string {
  const configured = process.env.TFTOURNEY_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (!host) return "";
  const normalized = host.replace(/\/+$/, "");
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(normalized);
  return `${isLocal ? "http" : "https"}://${normalized}`;
}
