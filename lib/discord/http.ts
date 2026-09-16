import { getHostUserId } from "../auth/session";
import { assertTournamentHost, submitLobbyResults } from "../db/tournaments/api";
import { supabaseRestRequest } from "../db/supabase-rest/api";
import { validateLobbyResults } from "../tournament/scoring/api";
import type { LobbyResultInput } from "../db/tournaments/types";

export type DiscordCaller =
  | { kind: "bot" }
  | { kind: "organizer"; hostUserId: string };

export function constantTimeEqual(first: string, second: string): boolean {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

export function isDiscordBotRequest(request: Request): boolean {
  const expected = process.env.DISCORD_BOT_API_SECRET;
  const authorization = request.headers.get("authorization");
  if (!expected || !authorization?.match(/^Bearer\s+/i)) return false;
  return constantTimeEqual(
    authorization.replace(/^Bearer\s+/i, ""),
    expected,
  );
}

export async function getDiscordCaller(
  request: Request,
): Promise<DiscordCaller | null> {
  if (isDiscordBotRequest(request)) return { kind: "bot" };
  const hostUserId = await getHostUserId(request);
  return hostUserId ? { kind: "organizer", hostUserId } : null;
}

export async function assertTournamentOperator(tournamentId: string, hostUserId: string): Promise<void> {
  try {
    await assertTournamentHost(tournamentId, hostUserId);
    return;
  } catch (ownerError) {
    const managers = await supabaseRestRequest<Array<{ user_id: string }>>("tournament_managers", {
      query: { select: "user_id", tournament_id: `eq.${tournamentId}`, user_id: `eq.${hostUserId}`, revoked_at: "is.null", limit: "1" },
    });
    if (!managers[0]) throw ownerError;
  }
}

export function discordErrorResponse(
  error: unknown,
  fallback = "Discord operation failed.",
): Response {
  const message = error instanceof Error ? error.message : fallback;
  const lower = message.toLowerCase();
  let status = 500;
  let code = "DISCORD_OPERATION_FAILED";
  let retryable = false;

  if (lower.includes("already registered")) {
    status = 409;
    code = "ALREADY_REGISTERED";
  } else if (lower.includes("check-in is not") || lower.includes("registration is closed") || lower.includes("already been recorded")) {
    status = 409;
    code = lower.includes("already been recorded") ? "LOBBY_ALREADY_RECORDED" : "STATE_CONFLICT";
  } else if (lower.includes("lock timeout")) {
    status = 409;
    code = "LOBBY_BUSY";
    retryable = true;
  } else if (lower.includes("idempotency")) {
    status = 409;
    code = "IDEMPOTENCY_CONFLICT";
  } else if (lower.includes("valid") || lower.includes("result") || lower.includes("placement") || lower.includes("player")) {
    status = 422;
    code = "INVALID_RESULTS";
  } else if (lower.includes("not found")) {
    status = 404;
    code = "NOT_FOUND";
  } else if (lower.includes("read-only") || lower.includes("completed")) {
    status = 409;
    code = "READ_ONLY";
  }

  return Response.json(
    { error: message || fallback, code, retryable },
    { status, headers: retryable ? { "Retry-After": "2" } : undefined },
  );
}

export async function submitLobbyResultsRequest(
  request: Request,
  tournamentId: string,
  lobbyId: string,
): Promise<Response> {
  const caller = await getDiscordCaller(request);
  if (!caller) {
    return Response.json(
      { error: "Sign in as a tournament operator or use the bot secret.", code: "AUTH_REQUIRED" },
      { status: 401 },
    );
  }
  if (caller.kind === "organizer") {
    await assertTournamentOperator(tournamentId, caller.hostUserId);
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return Response.json(
      { error: "A unique Idempotency-Key header is required.", code: "IDEMPOTENCY_REQUIRED" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON.", code: "INVALID_JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Request body must be an object.", code: "INVALID_JSON" }, { status: 400 });
  }
  const raw = body as { results?: unknown; mode?: unknown; submissionId?: unknown };
  if (!Array.isArray(raw.results)) {
    return Response.json({ error: "results must be an array.", code: "INVALID_RESULTS" }, { status: 422 });
  }
  const results: LobbyResultInput[] = raw.results.map((entry) => {
    const value = entry as { participantId?: unknown; placement?: unknown };
    return {
      participantId: typeof value?.participantId === "string" ? value.participantId : "",
      placement: Number.isInteger(value?.placement) ? Number(value.placement) : Number.NaN,
    };
  });
  if (results.some((result) => !Number.isInteger(result.placement))) {
    return Response.json({ error: "Every placement must be an integer.", code: "INVALID_RESULTS" }, { status: 422 });
  }
  const validation = validateLobbyResults(results.map((result) => ({
    participantId: result.participantId,
    placement: String(result.placement),
  })));
  if (!validation.success) {
    return Response.json({ error: validation.error, code: "INVALID_RESULTS" }, { status: 422 });
  }

  if (raw.mode !== undefined && raw.mode !== "record" && raw.mode !== "correct") {
    return Response.json({ error: "mode must be record or correct.", code: "INVALID_MODE" }, { status: 422 });
  }
  const mode = raw.mode === "correct" ? "correct" : "record";
  try {
    const result = await submitLobbyResults({
      tournamentId,
      lobbyId,
      results: validation.data,
      idempotencyKey,
      source: caller.kind === "bot" ? "discord" : "web",
      submissionId: typeof raw.submissionId === "string" ? raw.submissionId : undefined,
      mode,
    });
    return Response.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return discordErrorResponse(error, "Lobby results could not be submitted.");
  }
}

export type DiscordScoreSubmissionResult = {
  submissionId: string;
  status: string;
  queuePosition: number | null;
  roundId: string | null;
  lobbyNumber: number | null;
  acceptedImageCount: number;
  retryAfterSeconds: number | null;
};

export function parseSubmissionResult(
  value: Record<string, unknown>,
): DiscordScoreSubmissionResult {
  return {
    submissionId: String(value.submission_id ?? ""),
    status: String(value.submission_status ?? "queued"),
    queuePosition: value.queue_position == null ? null : Number(value.queue_position),
    roundId: value.round_id == null ? null : String(value.round_id),
    lobbyNumber: value.lobby_number == null ? null : Number(value.lobby_number),
    acceptedImageCount: Number(value.accepted_image_count ?? 0),
    retryAfterSeconds: value.retry_after_seconds == null ? null : Number(value.retry_after_seconds),
  };
}
