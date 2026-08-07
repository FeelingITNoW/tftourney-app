import { ImageAnnotatorClient } from "@google-cloud/vision";
import type { OcrBoundingBox, OcrBreakType, OcrWord, VisionTextDetectionResult } from "./types";
import { PlacementParseError } from "./types";

type VisionVertex = { x?: number | null; y?: number | null };
type VisionAnnotation = {
  description?: string | null;
  boundingPoly?: { vertices?: VisionVertex[] | null } | null;
};

type VisionDetectedBreak = { type?: string | null };
type VisionSymbol = {
  text?: string | null;
  confidence?: number | null;
  boundingPoly?: { vertices?: VisionVertex[] | null } | null;
  property?: { detectedBreak?: VisionDetectedBreak | null } | null;
};
type VisionWord = {
  symbols?: VisionSymbol[] | null;
  confidence?: number | null;
  boundingPoly?: { vertices?: VisionVertex[] | null } | null;
  property?: { detectedBreak?: VisionDetectedBreak | null } | null;
};
type VisionParagraph = { words?: VisionWord[] | null };
type VisionBlock = { paragraphs?: VisionParagraph[] | null };
type VisionPage = {
  width?: number | null;
  height?: number | null;
  blocks?: VisionBlock[] | null;
};
type VisionFullTextAnnotation = { pages?: VisionPage[] | null };
type VisionResult = {
  textAnnotations?: VisionAnnotation[] | null;
  fullTextAnnotation?: VisionFullTextAnnotation | null;
};

const BREAK_TYPES = new Set<OcrBreakType>([
  "UNKNOWN",
  "SPACE",
  "SURE_SPACE",
  "EOL_SURE_SPACE",
  "HYPHEN",
  "LINE_BREAK",
]);

function breakType(value: string | null | undefined): OcrBreakType | undefined {
  return value && BREAK_TYPES.has(value as OcrBreakType) ? value as OcrBreakType : undefined;
}

function credentialsFromEnvironment(): { projectId?: string; credentials: { client_email: string; private_key: string } } | undefined {
  const encoded = process.env.GOOGLE_CLOUD_VISION_CREDENTIALS_BASE64;
  if (!encoded) return undefined;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
      project_id?: unknown;
      client_email?: unknown;
      private_key?: unknown;
    };
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
      throw new Error("credentials are incomplete");
    }
    return {
      projectId: typeof parsed.project_id === "string" ? parsed.project_id : undefined,
      credentials: { client_email: parsed.client_email, private_key: parsed.private_key },
    };
  } catch {
    throw new PlacementParseError(
      "Google Vision credentials are misconfigured.",
      503,
      "OCR_NOT_CONFIGURED",
    );
  }
}

function boxFromAnnotation(annotation: VisionAnnotation, width: number, height: number): OcrBoundingBox | null {
  const vertices = annotation.boundingPoly?.vertices ?? [];
  if (vertices.length === 0 || width <= 0 || height <= 0) return null;
  const xs = vertices.map((vertex) => vertex.x ?? 0);
  const ys = vertices.map((vertex) => vertex.y ?? 0);
  return {
    left: Math.max(0, Math.min(...xs) / width),
    top: Math.max(0, Math.min(...ys) / height),
    right: Math.min(1, Math.max(...xs) / width),
    bottom: Math.min(1, Math.max(...ys) / height),
  };
}

function annotationExtent(annotations: VisionAnnotation[], axis: "x" | "y"): number {
  const extent = Math.max(
    1,
    ...annotations.flatMap((annotation) =>
      (annotation.boundingPoly?.vertices ?? []).map((vertex) => Number(vertex[axis] ?? 0)),
    ),
  );
  return Number.isFinite(extent) && extent > 0 ? extent : 1;
}

function clientFromEnvironment(): ImageAnnotatorClient {
  const credentials = credentialsFromEnvironment();
  if (!credentials) return new ImageAnnotatorClient();
  return new ImageAnnotatorClient(credentials);
}

export function extractVisionWords(result: unknown): OcrWord[] {
  const typed = result as VisionResult;
  const annotations = typed.textAnnotations ?? [];
  const page = typed.fullTextAnnotation?.pages?.[0];
  // Structured responses expose image dimensions on the page. Flat
  // textAnnotations do not always include fullTextAnnotation, so derive a
  // stable normalization scale from the observed annotation extent instead of
  // clipping every pixel coordinate to 1.
  const pageWidth = Number(page?.width ?? 0);
  const pageHeight = Number(page?.height ?? 0);
  const width = pageWidth > 0 ? pageWidth : annotationExtent(annotations, "x");
  const height = pageHeight > 0 ? pageHeight : annotationExtent(annotations, "y");
  const words: OcrWord[] = [];

  page?.blocks?.forEach((block, blockIndex) => {
    block.paragraphs?.forEach((paragraph, paragraphIndex) => {
      paragraph.words?.forEach((word, wordIndex) => {
        const symbols = word.symbols ?? [];
        const text = symbols.map((symbol) => symbol.text ?? "").join("").trim();
        const box = boxFromAnnotation({ boundingPoly: word.boundingPoly }, width, height);
        const detectedBreak = word.property?.detectedBreak ?? symbols.at(-1)?.property?.detectedBreak;
        if (text && box) {
          words.push({
            text,
            box,
            confidence: typeof word.confidence === "number" ? word.confidence : undefined,
            blockIndex,
            paragraphIndex,
            wordIndex,
            breakType: breakType(detectedBreak?.type),
          });
        }
      });
    });
  });

  if (words.length === 0) {
    annotations.slice(1).forEach((annotation) => {
      const text = annotation.description?.trim() ?? "";
      const box = boxFromAnnotation(annotation, width, height);
      if (text && box) words.push({ text, box });
    });
  }
  return words;
}

export function createGoogleVisionTextDetector(): (image: Uint8Array) => Promise<VisionTextDetectionResult> {
  const client = clientFromEnvironment();

  return async (image) => {
    try {
      const [result] = await client.documentTextDetection({ image: { content: Buffer.from(image) } });
      return { words: extractVisionWords(result) };
    } catch (error) {
      const status = typeof (error as { code?: unknown })?.code === "number" ? Number((error as { code: number }).code) : 503;
      const retryable = status === 429 || status >= 500;
      throw new PlacementParseError(
        retryable ? "Google Vision is temporarily unavailable." : "Google Vision could not process the image.",
        retryable ? (status === 429 ? 429 : 503) : 502,
        retryable ? "OCR_PROVIDER_UNAVAILABLE" : "OCR_PROVIDER_ERROR",
        retryable,
      );
    }
  };
}
