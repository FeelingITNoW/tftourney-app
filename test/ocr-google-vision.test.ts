import assert from "node:assert/strict";
import test from "node:test";
import { extractVisionWords } from "../lib/ocr/placements/google-vision";

function polygon(left: number, top: number, right: number, bottom: number) {
  return { vertices: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }] };
}

test("extracts structured Vision words with hierarchy, confidence, and breaks", () => {
  const result = extractVisionWords({
    fullTextAnnotation: {
      pages: [{
        width: 100,
        height: 200,
        blocks: [{ paragraphs: [{ words: [{
          confidence: 0.97,
          boundingPoly: polygon(10, 20, 40, 40),
          symbols: [{ text: "A" }, { text: "l" }, { text: "p" }, { text: "h" }, { text: "a", property: { detectedBreak: { type: "SPACE" } } }],
        }] }] }],
      }],
    },
    textAnnotations: [],
  });

  assert.deepEqual(result, [{
    text: "Alpha",
    box: { left: 0.1, top: 0.1, right: 0.4, bottom: 0.2 },
    confidence: 0.97,
    blockIndex: 0,
    paragraphIndex: 0,
    wordIndex: 0,
    breakType: "SPACE",
  }]);
});

test("falls back to flat text annotations when structured Vision text is absent", () => {
  const result = extractVisionWords({
    textAnnotations: [
      { description: "Alpha Bravo", boundingPoly: polygon(0, 0, 100, 100) },
      { description: "Alpha", boundingPoly: polygon(10, 20, 40, 40) },
    ],
  });

  assert.deepEqual(result, [{
    text: "Alpha",
    box: { left: 0.1, top: 0.2, right: 0.4, bottom: 0.4 },
  }]);
});
