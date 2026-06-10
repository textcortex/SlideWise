import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parsePptx, serializeDeck } from "../index";
import type { Deck } from "@/lib/types";

/**
 * B1 regression: the serializer must replay each output slide's chrome
 * (background + layout reference) from the source slide the host declares via
 * `Slide.sourceSlideIndex`, NOT from the output slide's position. AI deck
 * generators clone / reorder / subset the imported slides, so output position
 * no longer matches source position — and the non-enumerable per-slide source
 * attachment is stripped the moment the deck is cloned.
 */

const NS_P =
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const NS_A =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const NS_R =
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A slide whose ONLY distinctive feature is a solid `<p:bg>` colour. */
function slideXml(bgHex: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS_P} ${NS_A} ${NS_R}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bgHex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Hi</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}

/** Two-slide 16:9 source: slide1 bg = DD1111, slide2 bg = 22DD22. */
function twoSlideSource(): JSZip {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS_P} ${NS_R}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`
  );
  zip.file("ppt/slides/slide1.xml", slideXml("DD1111"));
  zip.file("ppt/slides/slide2.xml", slideXml("22DD22"));
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  );
  zip.file(
    "ppt/slides/_rels/slide2.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  );
  return zip;
}

async function slideBg(blob: Blob, n: number): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return (await zip.file(`ppt/slides/slide${n}.xml`)?.async("string")) ?? "";
}

describe("B1: per-slide source mapping", () => {
  it("replays backgrounds by sourceSlideIndex after clone + reorder", async () => {
    const source = await twoSlideSource().generateAsync({
      type: "arraybuffer",
    });
    const parsed = await parsePptx(source);
    expect(parsed.slides.length).toBe(2);

    // Mimic an AI host: clone (strips the non-enumerable source attachment),
    // reorder the slides (swap), and neutralise each slide's own background so
    // the ONLY thing that can re-introduce the distinctive source colour is
    // the source-slide replay keyed by `sourceSlideIndex`.
    const cloned = structuredClone(parsed) as Deck;
    const edited: Deck = {
      ...cloned,
      slides: [
        { ...cloned.slides[1], background: "#FFFFFF", sourceSlideIndex: 1 },
        { ...cloned.slides[0], background: "#FFFFFF", sourceSlideIndex: 0 },
      ],
    };

    const blob = await serializeDeck(edited, { source });

    // Output slide 1 was declared to come from source slide index 1 (22DD22).
    const out1 = await slideBg(blob, 1);
    expect(out1).toContain("22DD22");
    expect(out1).not.toContain("DD1111");

    // Output slide 2 was declared to come from source slide index 0 (DD1111).
    const out2 = await slideBg(blob, 2);
    expect(out2).toContain("DD1111");
    expect(out2).not.toContain("22DD22");
  });

  it("falls back to positional mapping when sourceSlideIndex is unset", async () => {
    // The untouched parse -> serialize path: no clone, attachment intact,
    // output order matches source order. Backgrounds line up positionally.
    const source = await twoSlideSource().generateAsync({
      type: "arraybuffer",
    });
    const parsed = await parsePptx(source);
    const blob = await serializeDeck(parsed, { source });

    expect(await slideBg(blob, 1)).toContain("DD1111");
    expect(await slideBg(blob, 2)).toContain("22DD22");
  });
});
