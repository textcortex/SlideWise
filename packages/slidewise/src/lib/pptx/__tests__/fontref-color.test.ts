import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parsePptx } from "../index";

/**
 * When a run sets no colour, PowerPoint paints it with the shape's
 * `<p:style><a:fontRef>` colour. A common case is a card whose fontRef is `lt1`
 * (white) so its label reads against the fill — without this, the run falls
 * back to the default dark colour and a white-on-card label shows up as stray
 * dark text. For a non-placeholder shape the fontRef colour also outranks the
 * master's generic text default.
 */
const NS =
  `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`;

function zipWith(slideInner: string): JSZip {
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

describe("fontRef text colour fallback", () => {
  it("colours an uncoloured run from the shape's <a:fontRef> (lt1 → white)", async () => {
    // A non-placeholder card: white fill, a run with no colour, fontRef = lt1.
    const sp = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="card"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2600000" cy="900000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></p:spPr><p:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Label</a:t></a:r></a:p></p:txBody></p:sp>`;
    const deck = await parsePptx(await zipWith(sp).generateAsync({ type: "arraybuffer" }));
    const text = deck.slides[0].elements.find((e) => e.type === "text");
    expect(text).toBeTruthy();
    if (text && text.type === "text") {
      expect(text.color.toUpperCase()).toBe("#FFFFFF");
    }
  });

  it("does not override an explicit run colour", async () => {
    const sp = `<p:sp><p:nvSpPr><p:cNvPr id="3" name="card"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2600000" cy="900000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom></p:spPr><p:style><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>Red</a:t></a:r></a:p></p:txBody></p:sp>`;
    const deck = await parsePptx(await zipWith(sp).generateAsync({ type: "arraybuffer" }));
    const text = deck.slides[0].elements.find((e) => e.type === "text");
    expect(text && text.type === "text" && text.color.toUpperCase()).toBe("#FF0000");
  });
});
