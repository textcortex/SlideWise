import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parsePptx } from "../index";
import type { SlideElement } from "@/lib/types";

/**
 * `<a:grpFill/>` means "paint with the enclosing group's fill". Decorative
 * line-art (e.g. the swoosh graphic on a title slide) is commonly authored as
 * many `<a:custGeom>` segments inside one `<p:grpSp>`, with every segment
 * declaring `<a:grpFill/>` so they share the group's single translucent
 * colour. If the importer doesn't resolve grpFill the segments fall through to
 * transparent and the whole graphic disappears. This guards that inheritance.
 */
function baseZip(): JSZip {
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
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  );
  return zip;
}

function flatten(els: SlideElement[]): SlideElement[] {
  return els.flatMap((e) =>
    e.type === "group" ? [e, ...flatten(e.children)] : [e]
  );
}

const NS =
  `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"`;

describe("grpFill inheritance", () => {
  it("a <a:grpFill/> shape inherits its group's solid fill", async () => {
    const zip = baseZip();
    // Group carries a red solid fill; its custGeom child declares <a:grpFill/>
    // and no fill of its own, so it must render red.
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree><p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="2000000"/><a:chOff x="0" y="0"/><a:chExt cx="2000000" cy="2000000"/></a:xfrm><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="3" name="seg"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000000" cy="1000000"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:rect l="0" t="0" r="0" b="0"/><a:pathLst><a:path w="1000000" h="1000000"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="1000000" y="0"/></a:lnTo><a:lnTo><a:pt x="1000000" y="1000000"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom><a:grpFill/><a:ln><a:noFill/></a:ln></p:spPr></p:sp></p:grpSp></p:spTree></p:cSld></p:sld>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const shape = flatten(deck.slides[0].elements).find(
      (e) => e.type === "shape"
    );
    expect(shape).toBeTruthy();
    if (shape && shape.type === "shape") {
      // Inherited the group's red fill rather than collapsing to transparent.
      expect(String(shape.fill).toUpperCase()).toContain("FF0000");
      // The custGeom silhouette is preserved so it draws as line-art, not a box.
      expect(shape.path).toBeTruthy();
    }
  });
});
