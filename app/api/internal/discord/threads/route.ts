import { isDiscordBotRequest, discordErrorResponse } from "../../../../../lib/discord/http";
import { supabaseRestRequest } from "../../../../../lib/db/supabase-rest/api";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isDiscordBotRequest(request)) return Response.json({ error: "Unauthorized.", code: "AUTH_REQUIRED" }, { status: 401 });
  try {
    const body = await request.json() as { roundId?: unknown; lobbyNumber?: unknown; threadId?: unknown; state?: unknown };
    if (typeof body.roundId !== "string" || !Number.isInteger(body.lobbyNumber) || typeof body.threadId !== "string") return Response.json({ error: "Round, lobby number, and thread ID are required.", code: "INPUT_REQUIRED" }, { status: 400 });
    const state = body.state === undefined ? "active" : body.state;
    if (state !== "active" && state !== "archived" && state !== "error") return Response.json({ error: "Invalid thread state.", code: "INVALID_STATE" }, { status: 400 });
    await supabaseRestRequest("discord_lobby_threads", {
      method: "POST",
      query: { on_conflict: "round_id,lobby_number" },
      prefer: "resolution=merge-duplicates,return=minimal",
      body: { round_id: body.roundId, lobby_number: body.lobbyNumber, thread_id: body.threadId, state, updated_at: new Date().toISOString() },
    });
    return Response.json({ roundId: body.roundId, lobbyNumber: body.lobbyNumber, threadId: body.threadId, state });
  } catch (error) {
    return discordErrorResponse(error, "Discord lobby thread could not be saved.");
  }
}
