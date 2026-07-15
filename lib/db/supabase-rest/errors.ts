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
