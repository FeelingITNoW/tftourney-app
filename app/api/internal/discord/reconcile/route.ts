import { isDiscordBotRequest, discordErrorResponse } from "../../../../../lib/discord/http";
import { getDiscordReconcileViewModel } from "../../../../../lib/discord/api";

export const runtime = "nodejs";

// Polled by the bot every 10s. The payload is built by the
// get_discord_reconcile_view_model read model in a single query rather than by
// fanning out per-tournament reads here, which used to cost 1 + 8N round trips
// per tick and never dropped finished tournaments.
export async function GET(request: Request): Promise<Response> {
  if (!isDiscordBotRequest(request)) return Response.json({ error: "Unauthorized.", code: "AUTH_REQUIRED" }, { status: 401 });
  try {
    return Response.json(await getDiscordReconcileViewModel());
  } catch (error) {
    return discordErrorResponse(error, "Discord reconciliation failed.");
  }
}
