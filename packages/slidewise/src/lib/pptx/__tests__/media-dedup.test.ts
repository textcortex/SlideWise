/**
 * Regression guard for the "a small edit balloons the file" bug.
 *
 * A real 1.5 MB deck came back ~6 MB after a single edit-and-save because of
 * two independent serializer defects:
 *
 *   (A) Media de-duplication was missing. The same source image is routinely
 *       referenced from many slides (icons, logos, backgrounds). The preserve
 *       path copied it once *per reference* under `slidewise_preserved_N_`
 *       names — one image was written nine times — because `uniqueTarget` only
 *       avoided path collisions, not byte duplication.
 *
 *   (B) The package shipped with `STORE` (no) compression. JSZip defaults to
 *       STORE; `finalizeOutput` never asked for DEFLATE, so multi-megabyte
 *       slide XML (which compresses ~90%) went out raw.
 *
 * These tests build minimal packages through the public parse/serialize API and
 * assert neither defect recurs.
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parsePptx, serializeDeck } from "../index";
import type { Deck } from "@/lib/types";

const NS =
  `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ` +
  `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;

// A valid 1×1 transparent PNG (CRC-correct chunks).
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII="
  ),
  (c) => c.charCodeAt(0)
);

/** A `<p:pic>` referencing the slide-rels image `rId10`. */
function pic(id: number): string {
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="p${id}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="rId10"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

function slideXml(picId: number): string {
  return (
    `<?xml version="1.0"?><p:sld ${NS}><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    `${pic(picId)}</p:spTree></p:cSld></p:sld>`
  );
}

const SLIDE_RELS =
  `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/shared.png"/>` +
  `</Relationships>`;

/** A two-slide source deck where BOTH slides reference the same `shared.png`. */
async function twoSlidesSharingOneImage(): Promise<ArrayBuffer> {
  const z = new JSZip();
  z.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="png" ContentType="image/png"/>` +
      `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
      `<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>` +
      `<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>` +
      `</Types>`
  );
  z.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  );
  z.file(
    "ppt/presentation.xml",
    `<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst>` +
      `<p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/>` +
      `</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
  );
  z.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>` +
      `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`
  );
  z.file("ppt/slides/slide1.xml", slideXml(2));
  z.file("ppt/slides/slide2.xml", slideXml(3));
  z.file("ppt/slides/_rels/slide1.xml.rels", SLIDE_RELS);
  z.file("ppt/slides/_rels/slide2.xml.rels", SLIDE_RELS);
  z.file("ppt/media/shared.png", PNG);
  return z.generateAsync({ type: "arraybuffer" });
}

describe("serialize: media de-duplication", () => {
  it("writes a shared image ONCE no matter how many slides reference it", async () => {
    const src = await twoSlidesSharingOneImage();
    const deck = await parsePptx(src);
    expect(deck.slides).toHaveLength(2);

    const out = await serializeDeck(deck, { source: src });
    const zip = await JSZip.loadAsync(await out.arrayBuffer());

    // Exactly one media part survives — not one-per-reference.
    const media = Object.keys(zip.files).filter(
      (p) => p.startsWith("ppt/media/") && !zip.files[p].dir
    );
    expect(media).toHaveLength(1);

    // And it must NOT carry a >0 preserve index (which would mean a duplicate
    // copy was written before it).
    for (const p of media) {
      expect(p).not.toMatch(/slidewise_preserved_[1-9]/);
    }

    // Both slides' rels resolve to that single shared part, so the image still
    // renders on both — dedup must not orphan a reference.
    const target = media[0].slice("ppt/media/".length);
    for (const n of [1, 2]) {
      const relsXml = await zip
        .file(`ppt/slides/_rels/slide${n}.xml.rels`)!
        .async("string");
      expect(relsXml).toContain(target);
    }
  });
});

describe("serialize: package compression", () => {
  it("DEFLATEs the package instead of storing it raw", async () => {
    // No source needed: every save flows through finalizeOutput.
    const deck = {
      version: 0,
      title: "compression",
      slides: [
        { id: "s1", elements: [] },
        { id: "s2", elements: [] },
      ],
    } as unknown as Deck;

    const blob = await serializeDeck(deck);
    const ab = await blob.arrayBuffer();
    const zip = await JSZip.loadAsync(ab);

    let totalUncompressed = 0;
    for (const p of Object.keys(zip.files)) {
      const f = zip.files[p];
      if (f.dir) continue;
      totalUncompressed += (await f.async("uint8array")).byteLength;
    }

    // With STORE the archive is >= the sum of its raw parts (plus per-entry
    // headers); DEFLATE drops it well below. The boilerplate OOXML here
    // compresses to roughly a third.
    expect(ab.byteLength).toBeLessThan(totalUncompressed * 0.8);
  });
});
