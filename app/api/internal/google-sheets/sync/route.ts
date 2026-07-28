import { runSheetSyncBatch } from "../../../../../lib/sheets/sync";

export async function POST(request: Request) {
  const expectedSecret = process.env.GOOGLE_SHEET_WORKER_SECRET;
  const providedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.headers.get("x-sheet-worker-secret");
  if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const body = (await request.json().catch(() => ({}))) as { limit?: number };
    const results = await runSheetSyncBatch(Math.min(Math.max(Number(body.limit ?? 10), 1), 50));
    return Response.json({ results });
  } catch {
    return Response.json({ error: "Sheet worker failed." }, { status: 503 });
  }
}
