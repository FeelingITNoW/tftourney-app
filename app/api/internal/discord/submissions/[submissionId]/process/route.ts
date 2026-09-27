import { processDiscordSubmission } from "../../../../../../../lib/discord/submissions";
import { isDiscordBotRequest, discordErrorResponse } from "../../../../../../../lib/discord/http";

export const runtime = "nodejs";

type Context = { params: Promise<{ submissionId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  if (!isDiscordBotRequest(request)) return Response.json({ error: "Unauthorized.", code: "AUTH_REQUIRED" }, { status: 401 });
  const { submissionId } = await context.params;
  try {
    const body = await request.json() as { leaseToken?: unknown };
    if (typeof body.leaseToken !== "string") return Response.json({ error: "A lease token is required.", code: "LEASE_REQUIRED" }, { status: 400 });
    const result = await processDiscordSubmission(submissionId, body.leaseToken);
    return Response.json(result, { status: 200 });
  } catch (error) {
    return discordErrorResponse(error, "Screenshot could not be processed.");
  }
}
