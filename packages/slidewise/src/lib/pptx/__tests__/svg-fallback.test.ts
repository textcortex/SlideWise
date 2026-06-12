/**
 * Regression guards for the 1.19.1 SVG-fallback follow-ups.
 *
 * pptxgenjs emits an SVG image as a dual blip: a `<a:blip>` raster fallback
 * (`*.png`) plus an `<asvg:svgBlip>` vector (`*.svg`). It writes the SVG SOURCE
 * into the `.png`, so `serializeDeck` rewrites that part to a real raster.
 *
 *   F1 — the last-resort transparent PNG must have CRC-correct chunks. The old
 *        constant had a bad IDAT CRC: it decodes in lenient readers but the
 *        strict PNG/OOXML validators this fallback exists to satisfy reject it.
 *
 *   F2 — on headless Node/SSR there is no canvas, so the fallback degrades to
 *        the transparent PNG and SVG images go blank outside PowerPoint. The
 *        `rasterizeSvg` option lets a host inject a rasterizer (e.g. resvg) so
 *        the headless path emits a faithful raster — without the library taking
 *        a native dependency.
 *
 * These run on Node (no canvas), which is exactly the path that was broken.
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { serializeDeck } from "../index";
import type { SvgRasterizer } from "../index";
import type { Deck } from "@/lib/types";

const SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
  `<rect width="64" height="64" fill="#3366cc"/></svg>`;
const SVG_DATA_URL = "data:image/svg+xml;base64," + btoa(SVG);

/** A deck with one model SVG image — pptxgenjs gives it a dual blip whose
 *  `.png` fallback `serializeDeck` must repair. No `source` needed. */
function deckWithSvgImage(): Deck {
  return {
    version: 0,
    title: "svg-fallback",
    slides: [
      {
        id: "s1",
        elements: [
          {
            id: "img1",
            type: "image",
            x: 10,
            y: 10,
            w: 100,
            h: 100,
            fit: "contain",
            src: SVG_DATA_URL,
          },
        ],
      },
    ],
  } as unknown as Deck;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** True only if the bytes are a PNG AND every chunk's stored CRC-32 matches —
 *  the exact check a strict validator (and F1) cares about. */
function pngChunkCrcsValid(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  let sawIend = false;
  while (off + 12 <= bytes.length) {
    const len = dv.getUint32(off);
    const typeStart = off + 4;
    const dataEnd = typeStart + 4 + len;
    if (dataEnd + 4 > bytes.length) return false;
    const stored = dv.getUint32(dataEnd);
    if (stored !== crc32(bytes.subarray(typeStart, dataEnd))) return false;
    const type = String.fromCharCode(
      bytes[typeStart],
      bytes[typeStart + 1],
      bytes[typeStart + 2],
      bytes[typeStart + 3]
    );
    off = dataEnd + 4;
    if (type === "IEND") {
      sawIend = true;
      break;
    }
  }
  return sawIend;
}

async function mediaPngBytes(blob: Blob): Promise<Uint8Array[]> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const out: Uint8Array[] = [];
  for (const p of Object.keys(zip.files)) {
    if (!/^ppt\/media\/.+\.png$/i.test(p) || zip.files[p].dir) continue;
    out.push(await zip.files[p].async("uint8array"));
  }
  return out;
}

// 1×1 opaque-red PNG (CRC-correct) — a sentinel distinct from the transparent
// fallback, so we can prove the host rasterizer's output is what got written.
const SENTINEL = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQD3A0FDAAAAAElFTkSuQmCC"
  ),
  (c) => c.charCodeAt(0)
);

describe("F1: transparent-PNG fallback", () => {
  it("emits a CRC-correct PNG (no SVG bytes, no bad CRC) on the headless path", async () => {
    const blob = await serializeDeck(deckWithSvgImage());
    const pngs = await mediaPngBytes(blob);

    // There must be a `.png` fallback, and every one must be a real,
    // CRC-correct PNG — never SVG markup, never a bad-CRC raster.
    expect(pngs.length).toBeGreaterThan(0);
    for (const bytes of pngs) {
      expect(pngChunkCrcsValid(bytes)).toBe(true);
    }
  });
});

describe("F2: host SVG rasterizer hook", () => {
  it("uses the provided rasterizer for the .png fallback", async () => {
    const seen: number[] = [];
    const rasterizeSvg: SvgRasterizer = (svg) => {
      seen.push(svg.byteLength); // confirms it received the SVG bytes
      return SENTINEL;
    };
    const blob = await serializeDeck(deckWithSvgImage(), { rasterizeSvg });
    const pngs = await mediaPngBytes(blob);

    expect(seen.length).toBeGreaterThan(0);
    // The fallback is exactly the rasterizer's output.
    expect(pngs.some((b) => b.length === SENTINEL.length && b.every((v, i) => v === SENTINEL[i]))).toBe(true);
  });

  it("ignores a rasterizer that throws or returns non-PNG, falling back to a valid PNG", async () => {
    const bogus: SvgRasterizer = () =>
      new TextEncoder().encode("<svg>not a png</svg>");
    const blob = await serializeDeck(deckWithSvgImage(), {
      rasterizeSvg: bogus,
    });
    const pngs = await mediaPngBytes(blob);
    expect(pngs.length).toBeGreaterThan(0);
    for (const bytes of pngs) {
      // Bogus output rejected; the part still ends up a valid PNG (never the
      // bogus bytes).
      expect(pngChunkCrcsValid(bytes)).toBe(true);
    }
  });
});
