import { randomUUID } from "node:crypto";
import { DatabaseRequestError, supabaseRestRequest } from "../db/supabase-rest/api";
import { getTournamentLobbyViewModel } from "../db/tournaments/api";
import { parseSubmissionResult, type DiscordScoreSubmissionResult } from "./http";

export const DISCORD_IMAGE_MAX_BYTES = 7 * 1024 * 1024;
export const DISCORD_IMAGE_BUCKET = "discord-score-images";
export const DISCORD_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type EnqueueDiscordSubmissionInput = {
  tournamentId: string;
  threadId: string;
  messageId: string;
  userId: string;
  receivedAt: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type ClaimedDiscordSubmission = {
  submissionId: string;
  tournamentId: string;
  roundId: string;
  threadId: string;
  lobbyId: string;
  gameNumber: number;
  leaseToken: string;
  storagePath: string;
  attemptCount: number;
  roster: Array<{ id: string; displayName: string }>;
};

function storageConfig(): { url: string; key: string } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL)?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase Storage is not configured.");
  return { url, key };
}

function extensionForMime(mimeType: string): string {
  return mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
}

async function uploadImage(path: string, bytes: Uint8Array, mimeType: string): Promise<void> {
  const config = storageConfig();
  const response = await fetch(`${config.url}/storage/v1/object/${DISCORD_IMAGE_BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": mimeType,
      "x-upsert": "false",
    },
    body: new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }),
  });
  if (!response.ok) throw new Error(`Discord screenshot storage failed with ${response.status}.`);
}

async function deleteImage(path: string): Promise<void> {
  const config = storageConfig();
  const response = await fetch(`${config.url}/storage/v1/object/${DISCORD_IMAGE_BUCKET}/${path}`, {
    method: "DELETE",
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
  });
  if (!response.ok && response.status !== 404) throw new Error(`Discord screenshot deletion failed with ${response.status}.`);
}

export async function downloadDiscordImage(path: string): Promise<Response> {
  const config = storageConfig();
  return fetch(`${config.url}/storage/v1/object/${DISCORD_IMAGE_BUCKET}/${path}`, {
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}` },
  });
}

export async function enqueueDiscordSubmission(
  input: EnqueueDiscordSubmissionInput,
): Promise<DiscordScoreSubmissionResult> {
  if (!DISCORD_IMAGE_TYPES.has(input.mimeType)) throw new Error("Only PNG, JPEG, and WebP images are supported.");
  if (input.bytes.byteLength === 0 || input.bytes.byteLength > DISCORD_IMAGE_MAX_BYTES) throw new Error("Images must be 7 MB or smaller.");

  const storagePath = `${input.tournamentId}/${randomUUID()}.${extensionForMime(input.mimeType)}`;
  await uploadImage(storagePath, input.bytes, input.mimeType);
  try {
    const rows = await supabaseRestRequest<Record<string, unknown>[]>("rpc/enqueue_discord_score_submission", {
      method: "POST",
      body: {
        p_tournament_id: input.tournamentId,
        p_thread_id: input.threadId,
        p_discord_message_id: input.messageId,
        p_discord_user_id: input.userId,
        p_received_at: input.receivedAt,
        p_storage_path: storagePath,
        p_mime_type: input.mimeType,
        p_byte_size: input.bytes.byteLength,
      },
    });
    const result = parseSubmissionResult(rows[0] ?? {});
    if (!result.submissionId) throw new Error("Database did not return the Discord submission.");
    return result;
  } catch (error) {
    // The storage object is deliberately left for the retention worker if the
    // database write failed; deleting here would make retries non-auditable.
    throw error instanceof DatabaseRequestError ? error : new Error(String(error));
  }
}

export async function claimDiscordSubmission(): Promise<ClaimedDiscordSubmission | null> {
  const rows = await supabaseRestRequest<Record<string, unknown>[]>("rpc/claim_discord_score_submission", {
    method: "POST",
    body: { p_lease_seconds: 120 },
  });
  const row = rows[0];
  if (!row) return null;
  const tournamentId = String(row.tournament_id ?? "");
  const lobbyId = String(row.lobby_id ?? "");
  const model = await getTournamentLobbyViewModel(tournamentId, lobbyId);
  if (!model) throw new Error("Claimed Discord submission points to a missing lobby.");
  return {
    submissionId: String(row.submission_id),
    tournamentId,
    roundId: String(row.round_id),
    threadId: String(row.thread_id),
    lobbyId,
    gameNumber: Number(row.game_number),
    leaseToken: String(row.lease_token),
    storagePath: String(row.storage_path),
    attemptCount: Number(row.attempt_count),
    roster: model.lobby.participants.map((participant) => ({ id: participant.id, displayName: participant.displayName })),
  };
}

export async function markDiscordSubmissionReview(input: {
  submissionId: string;
  leaseToken: string;
  ocrResult: unknown;
  errorCode: string;
  errorMessage: string;
}): Promise<void> {
  await supabaseRestRequest("rpc/mark_discord_submission_review", {
    method: "POST",
    body: {
      p_submission_id: input.submissionId,
      p_lease_token: input.leaseToken,
      p_ocr_result: input.ocrResult,
      p_error_code: input.errorCode,
      p_error_message: input.errorMessage,
    },
  });
}

export async function purgeExpiredDiscordImages(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const tournaments = await supabaseRestRequest<Array<{ id: string }>>("tournaments", {
    query: { select: "id", ended_at: `lt.${cutoff}`, limit: "1000" },
  });
  if (!tournaments.length) return 0;
  const ids = tournaments.map((row) => row.id).join(",");
  const submissions = await supabaseRestRequest<Array<{ id: string; storage_path: string }>>("discord_score_submissions", {
    query: { select: "id,storage_path", tournament_id: `in.(${ids})`, limit: "1000" },
  });
  let deleted = 0;
  for (const submission of submissions) {
    await deleteImage(submission.storage_path);
    await supabaseRestRequest("discord_score_submissions", {
      method: "DELETE",
      query: { id: `eq.${submission.id}` },
      prefer: "return=minimal",
    });
    deleted += 1;
  }
  return deleted;
}
