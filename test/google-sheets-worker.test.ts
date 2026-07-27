import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/internal/google-sheets/sync/route";

test("internal sheet worker requires its shared secret", async () => {
  const previous = process.env.GOOGLE_SHEET_WORKER_SECRET;
  process.env.GOOGLE_SHEET_WORKER_SECRET = "worker-secret";
  try {
    const response = await POST(new Request("https://app.example", { method: "POST" }));
    assert.equal(response.status, 401);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_SHEET_WORKER_SECRET;
    else process.env.GOOGLE_SHEET_WORKER_SECRET = previous;
  }
});
