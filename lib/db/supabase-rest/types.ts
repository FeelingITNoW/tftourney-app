export type SupabaseRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string>;
  body?: unknown;
  prefer?: string;
};

export type SupabaseConfig = {
  url: string;
  key: string;
};
