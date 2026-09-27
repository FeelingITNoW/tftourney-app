import type {
  SupabaseConfig,
  SupabaseRequestOptions,
} from "./types";

export class DatabaseConfigError extends Error {
  constructor() {
    super(
      "Database is not configured. Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, plus SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "DatabaseConfigError";
  }
}

export class DatabaseRequestError extends Error {
  readonly status: number;
  /** PostgREST's `code`: a Postgres SQLSTATE (e.g. "23505" for a unique
   * violation) or its own PGRST-prefixed code. Stable across message
   * wording changes, unlike matching on `.message` text. */
  readonly code: string | null;
  readonly details: string | null;
  readonly hint: string | null;
  /** The raw, unparsed response body, kept for logging when the parsed
   * fields above aren't enough (e.g. a non-PostgREST proxy error). */
  readonly rawBody: string;

  constructor(
    message: string,
    info: { status: number; code?: string | null; details?: string | null; hint?: string | null; rawBody?: string },
  ) {
    super(message);
    this.name = "DatabaseRequestError";
    this.status = info.status;
    this.code = info.code ?? null;
    this.details = info.details ?? null;
    this.hint = info.hint ?? null;
    this.rawBody = info.rawBody ?? message;
  }
}

type ParsedPostgrestError = { message: string; code: string | null; details: string | null; hint: string | null };

/**
 * PostgREST reports a database error as {code, message, details, hint} --
 * the SQLSTATE (e.g. "23505" for a unique violation, "P0001" for a plain
 * `raise exception`), the primary message, and optional detail/hint text.
 * Returns null when the body isn't in that shape (a non-PostgREST proxy
 * error, for example), so the caller can fall back to a generic message
 * instead of surfacing raw, possibly non-JSON response text.
 */
function parsePostgrestError(rawBody: string): ParsedPostgrestError | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.message !== "string") return null;
  return {
    message: record.message,
    code: typeof record.code === "string" ? record.code : null,
    details: typeof record.details === "string" ? record.details : null,
    hint: typeof record.hint === "string" ? record.hint : null,
  };
}

// Shared by every caller that talks to Supabase directly with a service-role
// or anon key (PostgREST here, plus the Supabase Auth endpoints in
// lib/auth/session.ts and proxy.ts). Storage access is deliberately NOT
// covered by this helper -- it requires the service-role key specifically
// (see storageConfig in lib/discord/submissions.ts), and falling back to an
// anon key there would silently produce 403s instead of a clear config error.
export function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  return {
    url: url.replace(/\/$/, ""),
    key,
  };
}

export function isDatabaseConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

export async function supabaseRestRequest<T>(
  table: string,
  options: SupabaseRequestOptions = {},
): Promise<T> {
  const config = getSupabaseConfig();

  if (!config) {
    throw new DatabaseConfigError();
  }

  const url = new URL(`${config.url}/rest/v1/${table}`);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    cache: "no-store",
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const rawBody = await response.text();
    const parsed = parsePostgrestError(rawBody);
    throw new DatabaseRequestError(
      parsed?.message ?? `Database request failed with ${response.status}: ${rawBody}`,
      { status: response.status, code: parsed?.code, details: parsed?.details, hint: parsed?.hint, rawBody },
    );
  }

  if (response.status === 204) {
    return null as T;
  }

  const responseBody = await response.text();
  if (!responseBody.trim()) {
    return null as T;
  }

  try {
    return JSON.parse(responseBody) as T;
  } catch {
    throw new DatabaseRequestError(
      `Database response from ${table} was not valid JSON.`,
      { status: response.status, rawBody: responseBody },
    );
  }
}
