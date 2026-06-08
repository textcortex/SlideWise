import { describe, it, expect } from "vitest";
import { parsePptx, serializeDeck } from "../index";
import { CURRENT_DECK_VERSION } from "@/lib/schema/migrate";
import type { Deck } from "@/lib/types";

/**
 * A hand-built deck has no embedded source PPTX, so serialization takes the
 * synth path (the same path an *edited* gradient-text run hits). pptxgenjs only
 * writes a solid text colour, so a gradient `color` must degrade to a
 * representative solid hex rather than emit the gradient string as a bogus
 * colour. Guards the `solidTextColor` fallback. (Unedited runs imported from a
 * real PPTX keep their true gradient via verbatim source round-trip — covered
 * by the import-side gradient-text test.)
 */
function deckWithGradientText(color: string): Deck {
  return {
    version: CURRENT_DECK_VERSION,
    title: "Gradient export fixture",
    slides: [
      {
        id: "slide-1",
        background: "#000000",
        elements: [
          {
            id: "t1",
            type: "text",
            rotation: 0,
            z: 1,
            x: 100,
            y: 100,
            w: 800,
            h: 200,
            text: "Gradient",
            fontFamily: "Inter",
            fontSize: 64,
            fontWeight: 700,
            italic: false,
            underline: false,
            strike: false,
            color,
            align: "left",
            vAlign: "top",
            lineHeight: 1.2,
            letterSpacing: 0,
          },
        ],
      },
    ],
  };
}

describe("gradient text export (synth path)", () => {
  it("degrades a gradient text colour to a representative solid hex", async () => {
    const grad =
      "radial-gradient(circle at 50.00% 50.00%, #FF0000 0.00%, #00FF00 50.00%, #0000FF 100.00%)";
    const blob = await serializeDeck(deckWithGradientText(grad));
    const reparsed = await parsePptx(await blob.arrayBuffer());
    const text = reparsed.slides[0].elements.find((e) => e.type === "text");
    expect(text).toBeTruthy();
    if (text && text.type === "text") {
      // A valid solid hex, NOT the gradient string echoed back as a colour.
      expect(text.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(text.color.toLowerCase()).not.toContain("gradient");
      // Should be one of the gradient's actual stop colours (the middle one).
      expect(text.color.toUpperCase()).toBe("#00FF00");
    }
  });
});
