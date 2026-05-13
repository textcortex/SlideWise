import { describe, it, expect } from "vitest";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import JSZip from "jszip";
import { parsePptx, serializeDeck } from "../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Real client decks (Dickinson, eon-deck) live in the gitignored
// `.context/attachments/` Conductor workspace dir — they're branded
// samples we can't commit publicly. Tests `it.skipIf` themselves when
// the fixture isn't on disk so CI stays green for outside contributors
// while the regression guards run locally / on workspaces that have
// the fixtures available.
const attachmentsDir = path.resolve(
  __dirname,
  "../../../../../../.context/attachments"
);

async function fixtureExists(name: string): Promise<boolean> {
  try {
    await access(path.join(attachmentsDir, name));
    return true;
  } catch {
    return false;
  }
}

async function loadFixture(name: string): Promise<ArrayBuffer> {
  const buf = await readFile(path.join(attachmentsDir, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const hasEon = await fixtureExists("eon-deck.pptx");
const hasDickinson = await fixtureExists("Dickinson_Sample_Slides.pptx");

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
  it.skipIf(!hasEon)("preserves slide masters / layouts / theme / fonts on a 16:9 source (eon-deck)", async () => {
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

  it.skipIf(!hasDickinson)("keeps slide content intact when the source has EMF pictures (Dickinson)", async () => {
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

  it.skipIf(!hasEon)(
    "source bytes survive structuredClone (host state cloning)",
    async () => {
      // Mirrors what every editor reducer does: deck is spread / cloned on
      // every edit. The non-enumerable SOURCE_PPTX attachment is stripped
      // by structuredClone, so chrome / EMF preservation has to find the
      // source via the enumerable `sourcePptxId` cache lookup instead.
      const source = await loadFixture("eon-deck.pptx");
      const deck = await parsePptx(source);
      expect(deck.sourcePptxId).toBeTruthy();

      // Round-trip through structuredClone and an object spread — same
      // operations the store's `snap()` and reducers perform.
      const cloned = structuredClone(deck);
      const edited = {
        ...cloned,
        title: cloned.title + " [edited]",
        slides: cloned.slides.map((s) => ({ ...s })),
      };
      // Non-enumerable attachments are gone; the enumerable id remains.
      expect(
        (edited as unknown as Record<string, unknown>)["__slidewiseSourcePptx"]
      ).toBeUndefined();
      expect(edited.sourcePptxId).toBe(deck.sourcePptxId);

      // Save with NO explicit source — preservation must still kick in
      // via the module-level cache keyed by sourcePptxId.
      const blob = await serializeDeck(edited);
      const out = await JSZip.loadAsync(await blob.arrayBuffer());

      let layoutCount = 0;
      let fontCount = 0;
      out.forEach((p) => {
        if (
          p.startsWith("ppt/slideLayouts/") &&
          p.endsWith(".xml") &&
          !p.includes("/_rels/")
        )
          layoutCount++;
        if (p.startsWith("ppt/fonts/") && !p.endsWith("/")) fontCount++;
      });
      expect(layoutCount).toBe(28);
      expect(fontCount).toBe(5);
    }
  );
});
