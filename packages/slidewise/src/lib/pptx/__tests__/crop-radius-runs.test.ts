import { describe, it, expect } from "vitest";
import { parsePptx, serializeDeck } from "../index";
import { CURRENT_DECK_VERSION } from "@/lib/schema/migrate";
import type { Deck, ImageElement, TextElement } from "@/lib/types";

/**
 * P4 confirmations:
 *  - Image `crop` (`<a:srcRect>`) and `radius` (rounded-corner geometry) now
 *    round-trip — previously `crop` was parsed on import but silently dropped
 *    on export, and `radius` was neither parsed nor written.
 *  - Rich text `runs` keep their per-run styling through serialize → parse
 *    (the host fills text without flattening existing runs).
 */

// 1×1 transparent PNG.
const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function deckWith(elements: Deck["slides"][number]["elements"]): Deck {
  return {
    version: CURRENT_DECK_VERSION,
    title: "P4 fixture",
    slides: [{ id: "s1", background: "#FFFFFF", elements }],
  };
}

async function roundtrip(deck: Deck): Promise<Deck> {
  const blob = await serializeDeck(deck);
  return parsePptx(await blob.arrayBuffer());
}

describe("P4: image crop + radius round-trip", () => {
  it("preserves crop fractions and corner radius through serialize → parse", async () => {
    const img: ImageElement = {
      id: "img1",
      type: "image",
      x: 200,
      y: 160,
      w: 400,
      h: 300,
      rotation: 0,
      z: 1,
      src: PNG_1x1,
      fit: "fill",
      crop: { l: 0.1, t: 0.05, r: 0.2, b: 0.15 },
      radius: 24,
    };

    const out = await roundtrip(deckWith([img]));
    const parsed = out.slides[0].elements.find(
      (e): e is ImageElement => e.type === "image"
    );
    expect(parsed).toBeTruthy();

    // Crop survives (was dropped on write before the fix).
    expect(parsed!.crop).toBeTruthy();
    expect(parsed!.crop!.l).toBeCloseTo(0.1, 4);
    expect(parsed!.crop!.t).toBeCloseTo(0.05, 4);
    expect(parsed!.crop!.r).toBeCloseTo(0.2, 4);
    expect(parsed!.crop!.b).toBeCloseTo(0.15, 4);

    // Radius survives (neither parsed nor written before the fix).
    // 24px on a 300px shorter side → adj 0.08 → back to 24px.
    expect(parsed!.radius).toBe(24);

    // Geometry survives (within EMU rounding).
    expect(parsed!.w).toBeGreaterThanOrEqual(399);
    expect(parsed!.w).toBeLessThanOrEqual(401);
  });

  it("leaves a plain (uncropped, square) image on the pptxgenjs path", async () => {
    const img: ImageElement = {
      id: "img2",
      type: "image",
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      rotation: 0,
      z: 1,
      src: PNG_1x1,
      fit: "contain",
    };
    const out = await roundtrip(deckWith([img]));
    const parsed = out.slides[0].elements.find(
      (e): e is ImageElement => e.type === "image"
    );
    expect(parsed).toBeTruthy();
    expect(parsed!.crop).toBeUndefined();
    expect(parsed!.radius).toBeUndefined();
  });
});

describe("P4: rich text runs are not flattened", () => {
  it("keeps per-run styling through serialize → parse", async () => {
    const text: TextElement = {
      id: "t1",
      type: "text",
      x: 100,
      y: 100,
      w: 1200,
      h: 200,
      rotation: 0,
      z: 1,
      text: "Hello world",
      fontFamily: "Inter",
      fontSize: 40,
      fontWeight: 400,
      italic: false,
      underline: false,
      strike: false,
      color: "#000000",
      align: "left",
      vAlign: "top",
      lineHeight: 1.2,
      letterSpacing: 0,
      runs: [
        {
          text: "Hello ",
          fontWeight: 700,
          color: "#FF0000",
          fontFamily: "Inter",
          fontSize: 40,
        },
        {
          text: "world",
          italic: true,
          color: "#0000FF",
          fontFamily: "Inter",
          fontSize: 40,
        },
      ],
    };

    const out = await roundtrip(deckWith([text]));
    const parsed = out.slides[0].elements.find(
      (e): e is TextElement => e.type === "text"
    );
    expect(parsed).toBeTruthy();
    // Mixed formatting → the importer keeps distinct runs (not one flat run).
    expect(parsed!.runs && parsed!.runs.length).toBeGreaterThanOrEqual(2);
    const joined = (parsed!.runs ?? []).map((r) => r.text).join("");
    expect(joined).toBe("Hello world");
    const bold = parsed!.runs!.find((r) => r.text.startsWith("Hello"));
    const ital = parsed!.runs!.find((r) => r.text.includes("world"));
    expect(bold!.color?.toUpperCase()).toBe("#FF0000");
    expect(bold!.fontWeight).toBeGreaterThanOrEqual(600);
    expect(ital!.color?.toUpperCase()).toBe("#0000FF");
    expect(ital!.italic).toBe(true);
  });

  it("preserves per-run letter-case (cap) through serialize → parse", async () => {
    const text: TextElement = {
      id: "t2",
      type: "text",
      x: 100,
      y: 100,
      w: 1200,
      h: 200,
      rotation: 0,
      z: 1,
      text: "Loud quiet",
      fontFamily: "Inter",
      fontSize: 40,
      fontWeight: 400,
      italic: false,
      underline: false,
      strike: false,
      color: "#000000",
      align: "left",
      vAlign: "top",
      lineHeight: 1.2,
      letterSpacing: 0,
      runs: [
        { text: "Loud ", cap: "all", fontFamily: "Inter", fontSize: 40 },
        { text: "quiet", cap: "small", fontFamily: "Inter", fontSize: 40 },
      ],
    };

    const out = await roundtrip(deckWith([text]));
    const parsed = out.slides[0].elements.find(
      (e): e is TextElement => e.type === "text"
    );
    expect(parsed).toBeTruthy();
    const loud = parsed!.runs?.find((r) => r.text.startsWith("Loud"));
    const quiet = parsed!.runs?.find((r) => r.text.includes("quiet"));
    // cap was dropped on write before the fix (pptxgenjs has no cap option).
    expect(loud!.cap).toBe("all");
    expect(quiet!.cap).toBe("small");
  });
});
