export class DatabaseConfigError extends Error {
  constructor() {
    super(
      "Database is not configured. Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, plus SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
    this.name = "DatabaseConfigError";
  }
}

export class DatabaseRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseRequestError";
  }
}

type SupabaseRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string>;
  body?: unknown;
  prefer?: string;
};

type SupabaseConfig = {
  url: string;
  key: string;
};

function getSupabaseConfig(): SupabaseConfig | null {
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
    const errorBody = await response.text();
    throw new DatabaseRequestError(
      `Database request failed with ${response.status}: ${errorBody}`,
    );
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}
