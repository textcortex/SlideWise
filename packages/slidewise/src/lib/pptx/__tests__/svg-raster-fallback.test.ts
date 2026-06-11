import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { serializeDeck } from "../index";
import { CURRENT_DECK_VERSION } from "@/lib/schema/migrate";
import type { Deck } from "@/lib/types";

/**
 * Bug: pptxgenjs emits a dual-blip for SVG images (`<a:blip>` raster +
 * `<asvg:svgBlip>` vector) but writes the SVG SOURCE into the `.png` raster
 * fallback part rather than a rasterized PNG — so the `.png` is invalid bytes
 * that strict consumers (Google Slides, LibreOffice, OOXML validators) reject.
 *
 * `serializeDeck` must leave every `ppt/media/*.png` holding real PNG bytes.
 */

const SVG_MARKUP =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" fill="#FF0066"/><circle cx="32" cy="32" r="16" fill="#FFFFFF"/></svg>';

function svgDataUrl(markup: string): string {
  const b64 =
    typeof btoa === "function"
      ? btoa(markup)
      : Buffer.from(markup, "utf-8").toString("base64");
  return `data:image/svg+xml;base64,${b64}`;
}

function deckWithSvgImage(): Deck {
  return {
    version: CURRENT_DECK_VERSION,
    title: "SVG fallback",
    slides: [
      {
        id: "s1",
        background: "#FFFFFF",
        elements: [
          {
            id: "logo",
            type: "image",
            x: 100,
            y: 100,
            w: 200,
            h: 200,
            rotation: 0,
            z: 1,
            src: svgDataUrl(SVG_MARKUP),
            fit: "contain",
          },
        ],
      },
    ],
  };
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    PNG_MAGIC.every((b, i) => bytes[i] === b)
  );
}

describe("SVG dual-blip raster fallback", () => {
  it("writes valid PNG bytes into the .png fallback of an SVG image", async () => {
    const blob = await serializeDeck(deckWithSvgImage());
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    const pngPaths: string[] = [];
    const svgPaths: string[] = [];
    zip.forEach((p, e) => {
      if (e.dir) return;
      if (/^ppt\/media\/.+\.png$/i.test(p)) pngPaths.push(p);
      if (/^ppt\/media\/.+\.svg$/i.test(p)) svgPaths.push(p);
    });

    // The dual-blip means at least one .png fallback and one .svg vector part.
    expect(pngPaths.length).toBeGreaterThan(0);
    expect(svgPaths.length).toBeGreaterThan(0);

    // Every png part must be a real PNG, never SVG markup.
    for (const p of pngPaths) {
      const bytes = await zip.file(p)!.async("uint8array");
      expect(isPng(bytes), `${p} should be a valid PNG`).toBe(true);
    }

    // The vector part keeps the SVG markup intact.
    const svg = await zip.file(svgPaths[0])!.async("string");
    expect(svg).toContain("<svg");
  });
});
