import { defaultPlacementOcrDependencies, handlePlacementOcrRequest } from "@/lib/ocr/placements/http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    return await handlePlacementOcrRequest(request, defaultPlacementOcrDependencies());
  } catch {
    return Response.json({ error: "OCR processing is not configured.", code: "OCR_NOT_CONFIGURED" }, { status: 503 });
  }
}

