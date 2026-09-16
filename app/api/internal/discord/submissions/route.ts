import { enqueueDiscordSubmission, DISCORD_IMAGE_MAX_BYTES, DISCORD_IMAGE_TYPES } from "../../../../../lib/discord/submissions";
import { isDiscordBotRequest, discordErrorResponse } from "../../../../../lib/discord/http";

export const runtime = "nodejs";

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request): Promise<Response> {
  if (!isDiscordBotRequest(request)) return Response.json({ error: "Unauthorized.", code: "AUTH_REQUIRED" }, { status: 401 });
  try {
    const form = await request.formData();
    const tournamentId = textField(form, "tournamentId");
    const threadId = textField(form, "threadId");
    const messageId = textField(form, "messageId");
    const userId = textField(form, "userId");
    const receivedAt = textField(form, "receivedAt") || new Date().toISOString();
    const image = form.get("image");
    if (!tournamentId || !threadId || !messageId || !userId) return Response.json({ error: "Submission metadata is required.", code: "METADATA_REQUIRED" }, { status: 400 });
    if (!(image instanceof File)) return Response.json({ error: "An image file is required.", code: "IMAGE_REQUIRED" }, { status: 400 });
    if (!DISCORD_IMAGE_TYPES.has(image.type)) return Response.json({ error: "Only PNG, JPEG, and WebP images are supported.", code: "UNSUPPORTED_IMAGE_TYPE" }, { status: 415 });
    if (image.size <= 0 || image.size > DISCORD_IMAGE_MAX_BYTES) return Response.json({ error: "Images must be 7 MB or smaller.", code: "IMAGE_TOO_LARGE" }, { status: 413 });
    const result = await enqueueDiscordSubmission({
      tournamentId,
      threadId,
      messageId,
      userId,
      receivedAt,
      mimeType: image.type,
      bytes: new Uint8Array(await image.arrayBuffer()),
    });
    const isCooldown = result.status === "rejected_cooldown";
    const status = isCooldown || result.status === "rejected_overflow" || result.status === "rejected_spam"
      ? 429
      : result.status === "accepted" ? 200 : 202;
    const retryAfter = isCooldown ? String(Math.max(1, result.retryAfterSeconds ?? 1)) : "10";
    return Response.json(result, { status, headers: status === 429 ? { "Retry-After": retryAfter } : undefined });
  } catch (error) {
    return discordErrorResponse(error, "Screenshot could not be queued.");
  }
}
