import { supabaseRestRequest } from "../db/supabase-rest/api";

type SupabaseUser = { id: string; email?: string };
type SessionCookie = { accessToken: string; refreshToken?: string };

function sessionFromRequest(request: Request): SessionCookie | null {
  const rawCookie = request.headers.get("cookie") ?? "";
  const value = rawCookie.match(/(?:^|;\s*)tftourney-session=([^;]+)/)?.[1];
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as Partial<SessionCookie>;
    return typeof parsed.accessToken === "string" ? { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken } : null;
  } catch {
    return null;
  }
}

export async function getHostUserId(request: Request): Promise<string | null> {
  const session = sessionFromRequest(request);
  if (!session) return process.env.TFT_REQUIRE_AUTH === "false" ? "1" : null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return null;

  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const user = (await response.json()) as SupabaseUser;
  const existing = await supabaseRestRequest<Array<{ id: string | number }>>("users", {
    query: { select: "id", auth_user_id: `eq.${user.id}`, limit: "1" },
  });
  if (existing[0]) return String(existing[0].id);

  const byEmail = user.email
    ? await supabaseRestRequest<Array<{ id: string | number }>>("users", {
        query: { select: "id", email: `eq.${encodeURIComponent(user.email)}`, limit: "1" },
      })
    : [];
  if (byEmail[0]) {
    await supabaseRestRequest("users", {
      method: "PATCH",
      query: { id: `eq.${byEmail[0].id}` },
      body: { auth_user_id: user.id },
    });
    return String(byEmail[0].id);
  }

  const created = await supabaseRestRequest<Array<{ id: string | number }>>("users", {
    method: "POST",
    prefer: "return=representation",
    body: { auth_user_id: user.id, email: user.email ?? `${user.id}@invalid.local` },
  });
  return created[0] ? String(created[0].id) : null;
}
