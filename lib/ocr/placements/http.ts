import { getHostUserId } from "../../auth/session";
import { getTournamentLobbyViewModel } from "../../db/tournaments/api";
import { createGoogleVisionTextDetector } from "./google-vision";
import { parsePlacementImage } from "./parser";
import {
  PlacementParseError,
  type OcrRosterEntry,
  type PlacementParseResult,
} from "./types";

const MAX_IMAGE_BYTES = 7 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type LobbyRosterLoader = (
  tournamentId: string,
  lobbyId: string,
  hostUserId: string,
) => Promise<{ status: string; roster: OcrRosterEntry[] } | null>;

export type PlacementOcrHttpDependencies = {
  expectedSecret?: string;
  getHostUserId: (request: Request) => Promise<string | null>;
  loadLobbyRoster: LobbyRosterLoader;
  parseImage: (
    image: Uint8Array,
    roster?: OcrRosterEntry[],
  ) => Promise<PlacementParseResult>;
};

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized.", code: "AUTH_REQUIRED" }, { status: 401 });
}

function safeSecretEqual(first: string, second: string): boolean {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

function isBotRequest(request: Request, expectedSecret: string | undefined): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization?.match(/^Bearer\s+/i)) return false;
  const provided = authorization.replace(/^Bearer\s+/i, "");
  return Boolean(expectedSecret && provided && safeSecretEqual(provided, expectedSecret));
}

function validImageSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/png") {
    return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

function parseRoster(value: FormDataEntryValue | null): OcrRosterEntry[] | undefined {
  if (value === null || value === "") return undefined;
  if (typeof value !== "string") throw new PlacementParseError("Roster must be JSON text.", 400, "INVALID_ROSTER");

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new PlacementParseError("Roster must be valid JSON.", 400, "INVALID_ROSTER");
  }
  if (!Array.isArray(parsed) || parsed.length > 8) {
    throw new PlacementParseError("Roster must contain at most eight players.", 400, "INVALID_ROSTER");
  }
  const roster = parsed.map((entry) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as { id?: unknown }).id !== "string" ||
      typeof (entry as { displayName?: unknown }).displayName !== "string" ||
      !(entry as { id: string }).id.trim() ||
      !(entry as { displayName: string }).displayName.trim()
    ) {
      throw new PlacementParseError("Every roster entry needs an id and displayName.", 400, "INVALID_ROSTER");
    }
    return {
      id: (entry as { id: string }).id.trim(),
      displayName: (entry as { displayName: string }).displayName.trim(),
    };
  });
  return roster;
}

export async function handlePlacementOcrRequest(
  request: Request,
  dependencies: PlacementOcrHttpDependencies,
): Promise<Response> {
  const botRequest = isBotRequest(request, dependencies.expectedSecret);
  if (request.headers.has("authorization") && !botRequest) return unauthorized();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Request must be multipart form data.", code: "INVALID_FORM" }, { status: 400 });
  }

  let roster: OcrRosterEntry[] | undefined;
  if (botRequest) {
    try {
      roster = parseRoster(formData.get("roster"));
    } catch (error) {
      return errorResponse(error);
    }
  } else {
    const hostUserId = await dependencies.getHostUserId(request);
    if (!hostUserId) return unauthorized();
    const tournamentId = formData.get("tournamentId");
    const lobbyId = formData.get("lobbyId");
    if (typeof tournamentId !== "string" || typeof lobbyId !== "string" || !tournamentId || !lobbyId) {
      return Response.json({ error: "Tournament and lobby are required.", code: "LOBBY_REQUIRED" }, { status: 400 });
    }
    const lobby = await dependencies.loadLobbyRoster(tournamentId, lobbyId, hostUserId);
    if (!lobby) return Response.json({ error: "Lobby was not found.", code: "LOBBY_NOT_FOUND" }, { status: 404 });
    if (lobby.status === "completed") return Response.json({ error: "Completed lobbies are read-only.", code: "LOBBY_READ_ONLY" }, { status: 403 });
    roster = lobby.roster;
  }

  const file = formData.get("image");
  if (!(file instanceof File)) {
    return Response.json({ error: "An image file is required.", code: "IMAGE_REQUIRED" }, { status: 400 });
  }
  if (!SUPPORTED_MIME_TYPES.has(file.type)) {
    return Response.json({ error: "Only PNG, JPEG, and WebP images are supported.", code: "UNSUPPORTED_IMAGE_TYPE" }, { status: 415 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return Response.json({ error: "Images must be 7 MB or smaller.", code: "IMAGE_TOO_LARGE" }, { status: 413 });
  }

  const image = new Uint8Array(await file.arrayBuffer());
  if (!validImageSignature(image, file.type)) {
    return Response.json({ error: "The uploaded image signature does not match its type.", code: "INVALID_IMAGE" }, { status: 415 });
  }

  try {
    const result = await dependencies.parseImage(image, roster);
    logOcrResult(botRequest ? "bot" : "web", result);
    if (result.strategy === "unresolved" && result.placements.length === 0) {
      return Response.json(
        {
          ...result,
          error: `Vision detected ${result.debug.orderedNameCandidates.length} ordered player-name candidates, but exactly 8 are required. Open the OCR debug trace to review the detected text.`,
          code: "UNSUPPORTED_LAYOUT",
        },
        { status: 422 },
      );
    }
    return Response.json(result, { status: 200 });
  } catch (error) {
    return errorResponse(error);
  }
}

// One compact summary line per OCR call plus, when it isn't a clean match,
// one line per row that didn't match and per issue Vision/the parser flagged
// -- enough to diagnose a "needs review" result from the terminal without
// having to query discord_score_submissions.ocr_result by hand.
function logOcrResult(caller: "bot" | "web", result: PlacementParseResult): void {
  const matched = result.placements.filter((row) => row.matchStatus === "matched").length;
  console.log(
    `[ocr] caller=${caller} status=${result.status} strategy=${result.strategy} ` +
      `profile=${result.debug.selectedProfile} confidence=${result.debug.layoutConfidence.toFixed(2)} ` +
      `matched=${matched}/${result.placements.length || result.debug.rosterSize}`,
  );
  if (result.status === "complete") return;
  for (const row of result.placements) {
    if (row.matchStatus !== "matched") console.log(`[ocr]   #${row.placement} "${row.extractedName}" -> ${row.matchStatus}`);
  }
  for (const issue of result.issues) console.log(`[ocr]   issue: ${issue.code} - ${issue.message}`);
}

function errorResponse(error: unknown): Response {
  if (error instanceof PlacementParseError) {
    console.error(`[ocr] ${error.code}: ${error.message}`);
    return Response.json({ error: error.message, code: error.code, retryable: error.retryable }, { status: error.status });
  }
  console.error("[ocr] unexpected OCR failure", error);
  return Response.json({ error: "OCR processing failed.", code: "OCR_FAILED", retryable: true }, { status: 503 });
}

export function defaultPlacementOcrDependencies(): PlacementOcrHttpDependencies {
  const detector = createGoogleVisionTextDetector();
  return {
    expectedSecret: process.env.OCR_API_SECRET,
    getHostUserId,
    loadLobbyRoster: async (tournamentId, lobbyId, hostUserId) => {
      const model = await getTournamentLobbyViewModel(tournamentId, lobbyId);
      if (!model || model.tournament.hostUserId !== hostUserId) return null;
      return {
        status: model.tournament.status,
        roster: model.lobby.participants.map((participant) => ({ id: participant.id, displayName: participant.displayName })),
      };
    },
    parseImage: (image, roster) => parsePlacementImage(image, detector, roster),
  };
}
