import { supabaseRestRequest } from "../supabase-rest/api";

export type OrganizerUser = {
  id: string;
  email: string;
  authUserId: string;
};

export async function claimOrCreateOrganizer(input: {
  authUserId: string;
  email: string;
}): Promise<OrganizerUser> {
  const rows = await supabaseRestRequest<Array<{ id: string | number; email: string; auth_user_id: string }>>(
    "rpc/claim_or_create_organizer",
    {
      method: "POST",
      body: {
        p_auth_user_id: input.authUserId,
        p_email: input.email,
      },
    },
  );
  const row = rows[0];
  if (!row) throw new Error("Organizer profile could not be created.");
  return { id: String(row.id), email: row.email, authUserId: row.auth_user_id };
}

export async function getOrganizerGoogleConnection(userId: string): Promise<"connected" | "needs_reauth" | "disconnected"> {
  const rows = await supabaseRestRequest<Array<{ status: "connected" | "needs_reauth" | "disconnected" }>>(
    "organizer_google_connections",
    { query: { select: "status", user_id: `eq.${userId}`, limit: "1" } },
  );
  return rows[0]?.status ?? "disconnected";
}
