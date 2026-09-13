import { isDiscordBotRequest, discordErrorResponse } from "../../../../../lib/discord/http";
import { purgeExpiredDiscordImages } from "../../../../../lib/discord/submissions";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  if (!isDiscordBotRequest(request)) return Response.json({ error: "Unauthorized.", code: "AUTH_REQUIRED" }, { status: 401 });
  try {
    const deleted = await purgeExpiredDiscordImages();
    return Response.json({ deleted });
  } catch (error) {
    return discordErrorResponse(error, "Discord screenshot retention cleanup failed.");
  }
}
