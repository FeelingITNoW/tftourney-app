// Shared shape for logging a caught error from an auth route without losing
// PostgREST/Supabase error detail (code/details/hint) when present. Auth
// routes catch broadly (any provider fetch or database call can throw) and
// must never let an uncaught error surface as an opaque 500 to the browser,
// so every catch block logs with this helper and then redirects with an
// authError code instead.
export function errorLogFields(error: unknown): {
  message: string;
  name?: string;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
} {
  return {
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : undefined,
    code: error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined,
    details: error && typeof error === "object" && "details" in error ? (error as { details?: unknown }).details : undefined,
    hint: error && typeof error === "object" && "hint" in error ? (error as { hint?: unknown }).hint : undefined,
  };
}
