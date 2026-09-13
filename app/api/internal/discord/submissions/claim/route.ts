import { claimDiscordSubmission } from "../../../../../../lib/discord/submissions";
import { isDiscordBotRequest, discordErrorResponse } from "../../../../../../lib/discord/http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  // The worker cannot safely carry a user session; this endpoint is bot-only.
  if (!isDiscordBotRequest(request)) return Response.json({ error: "Unauthorized.", code: "AUTH_REQUIRED" }, { status: 401 });
  try {
    const result = await claimDiscordSubmission();
    if (!result) return new Response(null, { status: 204 });
    return Response.json({ ...result, imageUrl: `/api/internal/discord/submissions/${result.submissionId}/image` }, { status: 200 });
  } catch (error) {
    return discordErrorResponse(error, "Screenshot queue could not be claimed.");
  }
}
