export type OcrBoundingBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type OcrWord = {
  text: string;
  box: OcrBoundingBox;
  confidence?: number;
  blockIndex?: number;
  paragraphIndex?: number;
  wordIndex?: number;
  breakType?: OcrBreakType;
};

export type OcrBreakType =
  | "UNKNOWN"
  | "SPACE"
  | "SURE_SPACE"
  | "EOL_SURE_SPACE"
  | "HYPHEN"
  | "LINE_BREAK";

export type OcrRosterEntry = {
  id: string;
  displayName: string;
};

export type PlacementMatchStatus =
  | "matched"
  | "unmatched"
  | "ambiguous"
  | "not_requested";

export type PlacementMatch = {
  id: string;
  displayName: string;
  similarity: number;
};

export type PlacementRow = {
  placement: number;
  extractedName: string;
  matchStatus: PlacementMatchStatus;
  matchedRosterEntry: PlacementMatch | null;
  similarity: number | null;
};

export type PlacementParserStrategy =
  | "rank_anchors"
  | "roster_guided"
  | "name_column"
  | "unresolved";

export type PlacementIssueCode =
  | "INCOMPLETE_ROWS"
  | "EMPTY_PLAYER_NAME"
  | "UNMATCHED_PLAYER"
  | "AMBIGUOUS_PLAYER"
  | "DUPLICATE_ROSTER_NAME"
  | "UNSUPPORTED_LAYOUT"
  | "ROSTER_VALIDATION_REQUIRED"
  | "LOW_LAYOUT_CONFIDENCE";

export type PlacementIssue = {
  code: PlacementIssueCode;
  message: string;
  placement?: number;
};

export type PlacementParseDebug = {
  detectedWords: OcrWord[];
  orderedNameCandidates: string[];
  rankAnchors: OcrWord[];
  selectedProfile: string;
  layoutConfidence: number;
  runnerUpMargin: number;
  rowCenters: number[];
  candidateDiagnostics: Array<{
    placement: number;
    selected: string;
    alternatives: string[];
  }>;
  finalizedOrder: Array<{
    placement: number;
    extractedName: string;
  }>;
  rosterProvided: boolean;
  rosterSize: number;
};

export type PlacementParseResult = {
  schemaVersion: 2;
  status: "complete" | "review_required";
  strategy: PlacementParserStrategy;
  placements: PlacementRow[];
  issues: PlacementIssue[];
  debug: PlacementParseDebug;
};

export type VisionTextDetectionResult = {
  words: OcrWord[];
};

export type VisionTextDetector = (
  image: Uint8Array,
) => Promise<VisionTextDetectionResult>;

export class PlacementParseError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    status: number,
    code: string,
    retryable = false,
  ) {
    super(message);
    this.name = "PlacementParseError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}
