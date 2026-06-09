import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parsePptx } from "../index";

/**
 * A `<a:outerShdw>` drop shadow is frequently the only thing distinguishing a
 * card from a same-coloured slide (a white card on a white background). The
 * importer must surface it as `ShadowSpec` — both on a plain shape and on a
 * shape that also hosts text (which imports as a card-backed text element).
 */
const NS =
  `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`;

// dist=50800 EMU, dir=5400000 (90°, straight down), blurRad=190500 EMU,
// black @ 20% alpha.
const SHDW =
  `<a:effectLst><a:outerShdw blurRad="190500" dist="50800" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="20000"/></a:srgbClr></a:outerShdw></a:effectLst>`;

function baseZip(slideInner: string): JSZip {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree>${slideInner}</p:spTree></p:cSld></p:sld>`
  );
  return zip;
}

const cardSpPr = `<p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2600000" cy="930000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>${SHDW}</p:spPr>`;

describe("outer shadow import", () => {
  it("parses a drop shadow on a plain card shape", async () => {
    const inner = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="card"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>${cardSpPr}</p:sp>`;
    const deck = await parsePptx(await baseZip(inner).generateAsync({ type: "arraybuffer" }));
    const shape = deck.slides[0].elements.find((e) => e.type === "shape");
    expect(shape).toBeTruthy();
    if (shape && shape.type === "shape") {
      expect(shape.shadow).toBeTruthy();
      // 90° → straight down: no x offset, positive y offset, blurred.
      expect(shape.shadow!.offsetX).toBe(0);
      expect(shape.shadow!.offsetY).toBeGreaterThan(0);
      expect(shape.shadow!.blur).toBeGreaterThan(0);
      // black @ 20% alpha.
      expect(shape.shadow!.color.toUpperCase()).toBe("#00000033");
    }
  });

  it("parses a drop shadow on a card that hosts text", async () => {
    const inner = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="card"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>${cardSpPr}<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Budgeting</a:t></a:r></a:p></p:txBody></p:sp>`;
    const deck = await parsePptx(await baseZip(inner).generateAsync({ type: "arraybuffer" }));
    const text = deck.slides[0].elements.find((e) => e.type === "text");
    expect(text).toBeTruthy();
    if (text && text.type === "text") {
      // It's a card: white background, rounded, and carries the shadow so the
      // renderer paints it as a box-shadow on the card box.
      expect(text.background?.toUpperCase()).toBe("#FFFFFF");
      expect(text.shadow).toBeTruthy();
      expect(text.shadow!.offsetY).toBeGreaterThan(0);
    }
  });
});
