const appUrl = Deno.env.get("TFTOURNEY_APP_URL");
const workerSecret = Deno.env.get("GOOGLE_SHEET_WORKER_SECRET");

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!appUrl || !workerSecret) {
    return new Response(JSON.stringify({ error: "Sheet worker is not configured." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const response = await fetch(`${appUrl.replace(/\/$/, "")}/api/internal/google-sheets/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${workerSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ limit: 10 }),
  });
  return new Response(await response.text(), {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});
