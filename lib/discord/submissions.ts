import { randomUUID } from "node:crypto";
import { DatabaseRequestError, supabaseRestRequest } from "../db/supabase-rest/api";
import { getTournamentLobbyViewModel, submitLobbyResults } from "../db/tournaments/api";
import { createGoogleVisionTextDetector } from "../ocr/placements/google-vision";
import { parsePlacementImage } from "../ocr/placements/parser";
import type { PlacementParseResult } from "../ocr/placements/types";
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

export type ClaimedDiscordSubmission =
  | {
      claimStatus: "claimed";
      submissionId: string;
      tournamentId: string;
      roundId: string;
      threadId: string;
      discordMessageId: string;
      lobbyId: string;
      gameNumber: number;
      leaseToken: string;
    }
  | {
      claimStatus: "rejected_cooldown";
      submissionId: string;
      tournamentId: string;
      roundId: string;
      threadId: string;
      discordMessageId: string;
      retryAfterSeconds: number;
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
  const discordMessageId = String(row.discord_message_id ?? "");
  if (row.claim_status === "rejected_cooldown") {
    return {
      claimStatus: "rejected_cooldown",
      submissionId: String(row.submission_id),
      tournamentId,
      roundId: String(row.round_id),
      threadId: String(row.thread_id),
      discordMessageId,
      retryAfterSeconds: Number(row.retry_after_seconds ?? 0),
    };
  }
  return {
    claimStatus: "claimed",
    submissionId: String(row.submission_id),
    tournamentId,
    roundId: String(row.round_id),
    threadId: String(row.thread_id),
    discordMessageId,
    lobbyId: String(row.lobby_id ?? ""),
    gameNumber: Number(row.game_number),
    leaseToken: String(row.lease_token),
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

export type ProcessDiscordSubmissionResult =
  | { outcome: "accepted"; gameNumber: number; roundId: string; lobbyNumber: number }
  | { outcome: "review_required"; message: string }
  | { outcome: "score_write_failed"; message: string }
  | { outcome: "retries_exhausted"; message: string };

export type ProcessDiscordSubmissionDependencies = {
  parseImage: (image: Uint8Array, roster: Array<{ id: string; displayName: string }>) => Promise<PlacementParseResult>;
};

// Mirrors defaultPlacementOcrDependencies() in lib/ocr/placements/http.ts:
// the Vision client is expensive to construct but memoized at module scope,
// so building this fresh per call is cheap once warm.
function defaultProcessDependencies(): ProcessDiscordSubmissionDependencies {
  const detector = createGoogleVisionTextDetector();
  return { parseImage: (image, roster) => parsePlacementImage(image, detector, roster) };
}

// Collapses what used to be a bot-driven chain of app round trips -- download
// the stored screenshot, re-upload it to /api/ocr/placements, then POST the
// parsed results -- into one call the bot makes right after claiming a
// submission. Storage access, OCR, and the score write all happen in this
// process instead, so the image bytes never leave the app. Re-derives the
// lobby and storage path from the submission row (rather than trusting
// claim-time values the caller might have held onto) and relies on the same
// status/lease_token guard claim_discord_score_submission and
// mark_discord_submission_review already use.
export async function processDiscordSubmission(
  submissionId: string,
  leaseToken: string,
  dependencies: ProcessDiscordSubmissionDependencies = defaultProcessDependencies(),
): Promise<ProcessDiscordSubmissionResult> {
  const rows = await supabaseRestRequest<Array<{
    tournament_id: string;
    target_lobby_id: string | null;
    storage_path: string;
    status: string;
    lease_token: string | null;
    attempt_count: number;
  }>>("discord_score_submissions", {
    query: { select: "tournament_id,target_lobby_id,storage_path,status,lease_token,attempt_count", id: `eq.${submissionId}`, limit: "1" },
  });
  const submission = rows[0];
  if (!submission || submission.status !== "processing" || submission.lease_token !== leaseToken || !submission.target_lobby_id) {
    throw new Error("Submission is not held by this lease.");
  }
  const tournamentId = submission.tournament_id;
  const lobbyId = submission.target_lobby_id;

  try {
    const model = await getTournamentLobbyViewModel(tournamentId, lobbyId);
    if (!model) throw new Error("Claimed Discord submission points to a missing lobby.");
    const roster = model.lobby.participants.map((participant) => ({ id: participant.id, displayName: participant.displayName }));

    const image = await downloadDiscordImage(submission.storage_path);
    if (!image.ok || !image.body) throw new Error("Stored screenshot could not be downloaded.");
    const imageBytes = new Uint8Array(await image.arrayBuffer());

    const ocr = await dependencies.parseImage(imageBytes, roster);
    const complete = ocr.status === "complete" &&
      ocr.placements.length === roster.length &&
      ocr.placements.every((row) => row.matchStatus === "matched" && row.matchedRosterEntry?.id);
    console.log(`[discord-score-worker] submission ${submissionId} (tournament ${tournamentId}, lobby ${lobbyId}): OCR status=${ocr.status} strategy=${ocr.strategy} matched=${ocr.placements.filter((row) => row.matchStatus === "matched").length}/${roster.length}`);

    if (!complete) {
      await markDiscordSubmissionReview({
        submissionId,
        leaseToken,
        ocrResult: ocr,
        errorCode: "OCR_REVIEW_REQUIRED",
        errorMessage: "OCR could not produce an unambiguous complete roster.",
      });
      return { outcome: "review_required", message: "OCR could not validate this screenshot. A facilitator must review it before the next image is processed." };
    }

    const results = ocr.placements.map((row) => ({ participantId: row.matchedRosterEntry!.id, placement: row.placement }));
    try {
      const result = await submitLobbyResults({
        tournamentId,
        lobbyId,
        results,
        idempotencyKey: submissionId,
        source: "discord",
        submissionId,
        mode: "record",
      });
      return { outcome: "accepted", gameNumber: result.game_number, roundId: result.round_id, lobbyNumber: result.lobby_number };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The score could not be recorded.";
      await markDiscordSubmissionReview({ submissionId, leaseToken, ocrResult: ocr, errorCode: "SCORE_WRITE_FAILED", errorMessage: message });
      return { outcome: "score_write_failed", message };
    }
  } catch (error) {
    // Mirrors the bot's old catch-all: only proactively flag for review once
    // this was the last of the three attempts claim_discord_score_submission
    // allows. Anything earlier is left alone -- the lease expires and the next
    // claim resets the row to 'queued' for a fresh attempt.
    if (submission.attempt_count >= 3) {
      await markDiscordSubmissionReview({
        submissionId,
        leaseToken,
        ocrResult: null,
        errorCode: "PROCESSING_RETRIES_EXHAUSTED",
        errorMessage: "The screenshot worker could not process this image after three attempts.",
      }).catch(() => undefined);
      return { outcome: "retries_exhausted", message: "The screenshot worker could not process this image after three attempts. A facilitator must review it." };
    }
    throw error;
  }
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
