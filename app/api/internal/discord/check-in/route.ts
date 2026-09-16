import { isDiscordBotRequest, discordErrorResponse } from "../../../../../lib/discord/http";
import { supabaseRestRequest } from "../../../../../lib/db/supabase-rest/api";
import { getTournamentDiscordConfig } from "../../../../../lib/discord/api";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isDiscordBotRequest(request)) return Response.json({ error: "Unauthorized.", code: "AUTH_REQUIRED" }, { status: 401 });
  try {
    const body = await request.json() as { tournamentId?: unknown; discordUserId?: unknown };
    if (typeof body.tournamentId !== "string" || typeof body.discordUserId !== "string") return Response.json({ error: "Tournament and Discord user are required.", code: "INPUT_REQUIRED" }, { status: 400 });
    // A disconnected (state: "disabled") tournament can still have a live,
    // orphaned check-in panel in Discord -- refuse it explicitly instead of
    // letting the RPC silently keep accepting check-ins.
    const config = await getTournamentDiscordConfig(body.tournamentId);
    if (!config || config.state === "disabled") return Response.json({ error: "This tournament is not connected to Discord.", code: "NOT_CONNECTED" }, { status: 409 });
    const rows = await supabaseRestRequest<Array<{ registration_id: string; display_name: string; checked_in_at: string }>>("rpc/check_in_discord_player", {
      method: "POST",
      body: { p_tournament_id: body.tournamentId, p_discord_user_id: body.discordUserId },
    });
    const result = rows[0];
    if (!result) throw new Error("Database did not return the check-in.");
    return Response.json({ registrationId: result.registration_id, displayName: result.display_name, checkedInAt: result.checked_in_at });
  } catch (error) {
    return discordErrorResponse(error, "Check-in could not be recorded.");
  }
}
