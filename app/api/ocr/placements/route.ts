import { defaultPlacementOcrDependencies, handlePlacementOcrRequest } from "@/lib/ocr/placements/http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    return await handlePlacementOcrRequest(request, defaultPlacementOcrDependencies());
  } catch (error) {
    console.error("[ocr] request could not be handled -- is Vision configured? (GOOGLE_APPLICATION_CREDENTIALS / GOOGLE_CLOUD_VISION_CREDENTIALS_BASE64)", error);
    return Response.json({ error: "OCR processing is not configured.", code: "OCR_NOT_CONFIGURED" }, { status: 503 });
  }
}

