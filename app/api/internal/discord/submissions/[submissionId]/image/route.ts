import { downloadDiscordImage } from "../../../../../../../lib/discord/submissions";
import { isDiscordBotRequest } from "../../../../../../../lib/discord/http";
import { supabaseRestRequest } from "../../../../../../../lib/db/supabase-rest/api";

export const runtime = "nodejs";

type Context = { params: Promise<{ submissionId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  if (!isDiscordBotRequest(request)) return Response.json({ error: "Unauthorized.", code: "AUTH_REQUIRED" }, { status: 401 });
  const { submissionId } = await context.params;
  try {
    const rows = await supabaseRestRequest<Array<{ storage_path: string; mime_type: string }>>("discord_score_submissions", {
      query: { select: "storage_path,mime_type", id: `eq.${submissionId}`, limit: "1" },
    });
    const row = rows[0];
    if (!row) return Response.json({ error: "Submission was not found.", code: "NOT_FOUND" }, { status: 404 });
    const image = await downloadDiscordImage(row.storage_path);
    if (!image.ok || !image.body) return Response.json({ error: "Stored screenshot could not be downloaded.", code: "IMAGE_UNAVAILABLE", retryable: true }, { status: 503 });
    return new Response(image.body, { status: 200, headers: { "Content-Type": row.mime_type, "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Stored screenshot could not be loaded.", code: "IMAGE_UNAVAILABLE", retryable: true }, { status: 503 });
  }
}
