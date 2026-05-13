import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import JSZip from "jszip";
import { parsePptx, serializeDeck } from "../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const attachmentsDir = path.resolve(
  __dirname,
  "../../../../../../.context/attachments"
);

async function loadFixture(name: string): Promise<ArrayBuffer> {
  const buf = await readFile(path.join(attachmentsDir, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function listZipPaths(buf: ArrayBuffer | Blob): Promise<Set<string>> {
  const ab = buf instanceof Blob ? await buf.arrayBuffer() : buf;
  const zip = await JSZip.loadAsync(ab);
  const paths = new Set<string>();
  zip.forEach((p) => paths.add(p));
  return paths;
}

async function countSlidesWithSpTreeChildren(
  buf: Blob
): Promise<number> {
  const zip = await JSZip.loadAsync(await buf.arrayBuffer());
  let count = 0;
  const slidePaths: string[] = [];
  zip.forEach((p) => {
    if (
      p.startsWith("ppt/slides/slide") &&
      p.endsWith(".xml") &&
      !p.includes("/_rels/")
    ) {
      slidePaths.push(p);
    }
  });
  for (const p of slidePaths) {
    const xml = await zip.file(p)!.async("string");
    // Anything inside spTree beyond the bookkeeping group counts.
    if (
      /<p:sp\b/.test(xml) ||
      /<p:pic\b/.test(xml) ||
      /<p:graphicFrame\b/.test(xml) ||
      /<p:cxnSp\b/.test(xml)
    ) {
      count++;
    }
  }
  return count;
}

describe("deck chrome preservation", () => {
  it("preserves slide masters / layouts / theme / fonts on a 16:9 source (eon-deck)", async () => {
    const source = await loadFixture("eon-deck.pptx");

    const deck = await parsePptx(source);
    const blob = await serializeDeck(deck, { source });

    const outPaths = await listZipPaths(blob);
    const srcPaths = await listZipPaths(source);

    // Every master, layout, and font from the source should survive.
    const srcLayouts = [...srcPaths].filter(
      (p) =>
        p.startsWith("ppt/slideLayouts/") &&
        p.endsWith(".xml") &&
        !p.includes("/_rels/")
    );
    const outLayouts = [...outPaths].filter(
      (p) =>
        p.startsWith("ppt/slideLayouts/") &&
        p.endsWith(".xml") &&
        !p.includes("/_rels/")
    );
    expect(outLayouts.length).toBe(srcLayouts.length);

    const srcFonts = [...srcPaths].filter(
      (p) => p.startsWith("ppt/fonts/") && !p.endsWith("/")
    );
    const outFonts = [...outPaths].filter(
      (p) => p.startsWith("ppt/fonts/") && !p.endsWith("/")
    );
    expect(outFonts.length).toBe(srcFonts.length);
    for (const f of srcFonts) expect(outFonts).toContain(f);

    // Theme should round-trip.
    expect(outPaths.has("ppt/theme/theme1.xml")).toBe(true);
  });

  it("keeps slide content intact when the source has EMF pictures (Dickinson)", async () => {
    const source = await loadFixture("Dickinson_Sample_Slides.pptx");

    const deck = await parsePptx(source);
    expect(deck.slides.length).toBe(9);

    // Slides 2, 3, 9 in the source carry EMF logos. After the EMF-decode fix
    // they should still ship element content (either re-rendered images or
    // UnknownElement placeholders that round-trip verbatim) rather than
    // dropping their entire spTree.
    for (const slideIndex of [1, 2, 8]) {
      expect(deck.slides[slideIndex].elements.length).toBeGreaterThan(0);
    }

    const blob = await serializeDeck(deck, { source });
    const nonEmptySlides = await countSlidesWithSpTreeChildren(blob);
    // All 9 slides should have visible content after save.
    expect(nonEmptySlides).toBe(9);

    // Slide 2's background is `<a:schemeClr val="tx1"/>` in the source. After
    // save it should still reference the theme color, not collapse to the
    // flat `<a:srgbClr val="151515"/>` pptxgenjs would have written.
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slide2 = await zip.file("ppt/slides/slide2.xml")!.async("string");
    expect(slide2).toContain('<a:schemeClr val="tx1"/>');
    expect(slide2).not.toContain('<a:srgbClr val="151515"/>');
  });
});
