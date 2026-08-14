import { markDiscordSubmissionReview } from "../../../../../../../lib/discord/submissions";
import { isDiscordBotRequest, discordErrorResponse } from "../../../../../../../lib/discord/http";

export const runtime = "nodejs";

type Context = { params: Promise<{ submissionId: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  if (!isDiscordBotRequest(request)) return Response.json({ error: "Unauthorized.", code: "AUTH_REQUIRED" }, { status: 401 });
  const { submissionId } = await context.params;
  try {
    const body = await request.json() as { leaseToken?: unknown; ocrResult?: unknown; errorCode?: unknown; errorMessage?: unknown };
    if (typeof body.leaseToken !== "string") return Response.json({ error: "A lease token is required.", code: "LEASE_REQUIRED" }, { status: 400 });
    await markDiscordSubmissionReview({
      submissionId,
      leaseToken: body.leaseToken,
      ocrResult: body.ocrResult ?? null,
      errorCode: typeof body.errorCode === "string" ? body.errorCode : "OCR_REVIEW_REQUIRED",
      errorMessage: typeof body.errorMessage === "string" ? body.errorMessage : "OCR requires facilitator review.",
    });
    return Response.json({ submissionId, status: "needs_review" });
  } catch (error) {
    return discordErrorResponse(error, "Submission could not be moved to review.");
  }
}
