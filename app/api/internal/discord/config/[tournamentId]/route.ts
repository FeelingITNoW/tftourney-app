import { isDiscordBotRequest, discordErrorResponse } from "../../../../../../lib/discord/http";
import { supabaseRestRequest } from "../../../../../../lib/db/supabase-rest/api";
import { parseCooldownSeconds } from "../../../../../../lib/discord/cooldown";

export const runtime = "nodejs";
type Context = { params: Promise<{ tournamentId: string }> };

export async function PATCH(request: Request, context: Context): Promise<Response> {
  if (!isDiscordBotRequest(request)) return Response.json({ error: "Unauthorized.", code: "AUTH_REQUIRED" }, { status: 401 });
  const { tournamentId } = await context.params;
  try {
    const body = await request.json() as Record<string, unknown>;
    const allowed = ["guild_name", "category_id", "signup_channel_id", "checkin_channel_id", "score_channel_id", "manager_role_id", "signup_message_id", "checkin_message_id", "state", "last_error", "last_heartbeat_at", "score_cooldown_seconds", "cleanup_completed_at"];
    const update = Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
    if ("score_cooldown_seconds" in update && parseCooldownSeconds(update.score_cooldown_seconds) === null) {
      return Response.json({ error: "score_cooldown_seconds must be an integer between 0 and 3600.", code: "INVALID_COOLDOWN" }, { status: 400 });
    }
    await supabaseRestRequest("tournament_discord_configs", { method: "PATCH", query: { tournament_id: `eq.${tournamentId}` }, prefer: "return=minimal", body: { ...update, updated_at: new Date().toISOString() } });
    return Response.json({ tournamentId, ...update });
  } catch (error) {
    return discordErrorResponse(error, "Discord configuration could not be updated.");
  }
}
