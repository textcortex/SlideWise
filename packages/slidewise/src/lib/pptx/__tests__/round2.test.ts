import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parsePptx } from "../index";

/**
 * Minimal PPTX scaffolding shared across the round-2 fixtures (table
 * styles, charts, EMF fallback). Each test layers its own slide / part
 * files on top.
 */
function baseZip(): JSZip {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>
  <Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
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
  return zip;
}

// Smallest valid PNG (1×1 transparent).
const ONE_PX_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe("pptx importer — round 2", () => {
  it("applies table styles for header, body, and banded rows", async () => {
    const zip = baseZip();
    // tableStyles.xml referenced from presentation rels with the spec
    // relationship type. The fixture style sets a red whole-table fill,
    // a blue first-row fill, and a green band2 fill for alternating
    // body rows.
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/></Relationships>`
    );
    zip.file(
      "ppt/tableStyles.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{ABCDEF01-0000-0000-0000-000000000001}"><a:tblStyle styleId="{ABCDEF01-0000-0000-0000-000000000001}" styleName="Test"><a:wholeTbl><a:tcStyle><a:fill><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:fill></a:tcStyle></a:wholeTbl><a:firstRow><a:tcStyle><a:fill><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></a:fill></a:tcStyle><a:tcTxStyle><a:srgbClr val="FFFFFF"/></a:tcTxStyle></a:firstRow><a:band2H><a:tcStyle><a:fill><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:fill></a:tcStyle></a:band2H></a:tblStyle></a:tblStyleLst>`
    );
    // Slide carries a 2×2 table that opts into firstRow + bandRow and
    // references the style id above.
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="6000000" cy="2000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{ABCDEF01-0000-0000-0000-000000000001}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="3000000"/><a:gridCol w="3000000"/></a:tblGrid><a:tr h="500000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>H1</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>H2</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr h="500000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>B</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const table = deck.slides[0].elements.find((e) => e.type === "table");
    expect(table).toBeTruthy();
    if (table?.type !== "table") return;

    expect(table.hasHeader).toBe(true);
    expect(table.bandRows).toBe(true);
    expect(table.headerFill.toUpperCase()).toBe("#0000FF");
    expect(table.headerTextColor?.toUpperCase()).toBe("#FFFFFF");
    // Body rows fall back to the whole-table fill (no band1H set).
    expect(table.rowFill.toUpperCase()).toBe("#FF0000");
    expect(table.rowAltFill?.toUpperCase()).toBe("#00FF00");
  });

  it("renders the cached chart image when chart rels carry one", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="c"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="6000000" cy="3000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId1"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`
    );
    zip.file(
      "ppt/charts/chart1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>`
    );
    zip.file(
      "ppt/charts/_rels/chart1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/chart-preview.png"/></Relationships>`
    );
    zip.file("ppt/media/chart-preview.png", ONE_PX_PNG);

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const image = deck.slides[0].elements.find((e) => e.type === "image");
    expect(image).toBeTruthy();
    if (image?.type !== "image") return;
    expect(image.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(image.alt).toBe("Chart");
  });

  it("falls back to a same-basename raster when a pic embeds an EMF", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="2" name="p"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`
    );
    // Slide rels point to an EMF as the primary blip target, with a
    // sibling raster sharing the same basename.
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/wordmark.emf"/><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/wordmark.png"/></Relationships>`
    );
    // Need bytes for both so the fallback scan actually succeeds.
    zip.file("ppt/media/wordmark.emf", Uint8Array.from([0x01, 0x02, 0x03]));
    zip.file("ppt/media/wordmark.png", ONE_PX_PNG);

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const image = deck.slides[0].elements.find((e) => e.type === "image");
    expect(image).toBeTruthy();
    if (image?.type !== "image") return;
    expect(image.src.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("still skips a pic that only ships EMF with no raster sibling", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="2" name="p"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/only.emf"/></Relationships>`
    );
    zip.file("ppt/media/only.emf", Uint8Array.from([0x01, 0x02, 0x03]));

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    // Picture dropped — no image element emitted; nothing else either.
    const image = deck.slides[0].elements.find((e) => e.type === "image");
    expect(image).toBeUndefined();
  });

  it("captures rPr cap='all' as a run-level uppercase transform", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="de-DE" cap="all"/><a:t>Kapitelname</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const text = deck.slides[0].elements.find((e) => e.type === "text");
    expect(text?.type).toBe("text");
    if (text?.type !== "text") return;
    // Stored characters are unchanged; the transform rides on the run.
    expect(text.text).toContain("Kapitelname");
    expect(text.runs?.[0]?.cap).toBe("all");
    // A single-line spAutoFit box must not re-wrap under a substitute font.
    expect(text.noWrap).toBe(true);
  });

  it("applies a shape's own txBody lstStyle defRPr to runs that omit props", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    // Non-placeholder text box: the run has no sz/b/typeface — those live only
    // in the shape's own <a:lstStyle><a:lvl1pPr><a:defRPr>. Without consulting
    // it, the run would fall through to the master default (wrong size/font).
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="label"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="400000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="1200" b="1"><a:latin typeface="Arial"/></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr lang="de-DE"/><a:t>02 |</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const text = deck.slides[0].elements.find((e) => e.type === "text");
    expect(text?.type).toBe("text");
    if (text?.type !== "text") return;
    // Weight + typeface come from the shape's lstStyle defRPr, not the master.
    expect(text.fontWeight).toBe(700);
    expect(text.fontFamily).toBe("Arial");
  });

  it("skips the arrow-tip text inset for a no-fill homePlate label", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    const slide = (fill: string) =>
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="tab"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="500000"/></a:xfrm><a:prstGeom prst="homePlate"><a:avLst><a:gd name="adj" fmla="val 50000"/></a:avLst></a:prstGeom>${fill}<a:bodyPr rIns="36000" lIns="0"/></p:spPr><p:txBody><a:bodyPr rIns="36000" lIns="0"/><a:lstStyle/><a:p><a:r><a:rPr lang="de-DE"/><a:t>Phase</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const parse = async (fill: string) => {
      zip.file("ppt/slides/slide1.xml", slide(fill));
      zip.file(
        "ppt/slides/_rels/slide1.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
      );
      const buffer = await zip.generateAsync({ type: "arraybuffer" });
      const deck = await parsePptx(buffer);
      const el = deck.slides[0].elements.find((e) => e.type === "text");
      return el?.type === "text" ? el.padding?.r ?? 0 : -1;
    };
    // No fill → no arrow tip reserved → padding.r is just the small rIns.
    const noFillR = await parse("<a:noFill/>");
    // Filled (visible arrow) → text is inset away from the tip → much larger.
    const filledR = await parse(
      "<a:solidFill><a:srgbClr val=\"3F8CA3\"/></a:solidFill>"
    );
    expect(noFillR).toBeLessThan(20);
    expect(filledR).toBeGreaterThan(noFillR + 20);
  });

  it("derives font-weight from a weight-named family (Gilroy ExtraBold → 800)", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    // Family name encodes the weight; the substitute font must render heavy.
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="400000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="de-DE" sz="1200"><a:latin typeface="Gilroy ExtraBold"/></a:rPr><a:t>Phase</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const text = deck.slides[0].elements.find((e) => e.type === "text");
    if (text?.type !== "text") return;
    // No bold attribute, but the "ExtraBold" family name drives weight 800.
    expect(text.fontWeight).toBe(800);
  });

  it("keeps distinct per-cell fills and text colours (think-cell Gantt cells)", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    // 2×2 table: every cell carries its own <a:tcPr><a:solidFill>. The flat
    // header/body model would collapse these to two colours — the per-cell
    // arrays must preserve all four.
    const cell = (txt: string, hex: string, textHex: string) =>
      `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="de-DE"><a:solidFill><a:srgbClr val="${textHex}"/></a:solidFill></a:rPr><a:t>${txt}</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></a:tcPr></a:tc>`;
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="6000000" cy="2000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid><a:gridCol w="1000000"/><a:gridCol w="5000000"/></a:tblGrid><a:tr h="300000">${cell("A", "3F8CA3", "FFFFFF")}${cell("B", "FFFFFF", "0F2B53")}</a:tr><a:tr h="900000">${cell("C", "0F2B53", "FFFFFF")}${cell("D", "ADD4DF", "0F2B53")}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const table = deck.slides[0].elements.find((e) => e.type === "table");
    expect(table?.type).toBe("table");
    if (table?.type !== "table") return;
    expect(table.cellFills).toBeTruthy();
    const fills = (table.cellFills ?? []).map((r) =>
      r.map((c) => (c ?? "").toUpperCase())
    );
    expect(fills[0][0]).toBe("#3F8CA3");
    expect(fills[0][1]).toBe("#FFFFFF");
    expect(fills[1][0]).toBe("#0F2B53");
    expect(fills[1][1]).toBe("#ADD4DF");
    // Per-cell text colours survive too.
    const texts = (table.cellTextColors ?? []).map((r) =>
      r.map((c) => (c ?? "").toUpperCase())
    );
    expect(texts[0][0]).toBe("#FFFFFF");
    expect(texts[1][0]).toBe("#FFFFFF");
    // Non-uniform column widths and row heights are preserved (proportions).
    expect(table.colWidths).toEqual([1000000, 5000000]);
    expect(table.rowHeights).toEqual([300000, 900000]);
  });

  it("keeps a bold header cell's weight and honours its centre anchor", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    // Header cell: bold semibold-named font, vertically centred (anchor="ctr"),
    // no <a:tblPr firstRow> — the flat model would otherwise drop the weight
    // and top-align it.
    const header =
      `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="de-DE" sz="1400" b="1"><a:solidFill><a:schemeClr val="bg1"/></a:solidFill><a:latin typeface="Gilroy SemiBold"/></a:rPr><a:t>Situation</a:t></a:r></a:p></a:txBody><a:tcPr anchor="ctr"><a:solidFill><a:srgbClr val="0F2B53"/></a:solidFill></a:tcPr></a:tc>`;
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="500000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="3000000"/></a:tblGrid><a:tr h="500000">${header}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const table = deck.slides[0].elements.find((e) => e.type === "table");
    if (table?.type !== "table") return;
    // The bold semibold header is kept as a rich run at weight 700.
    expect(table.cellRuns?.[0]?.[0]?.[0]?.fontWeight).toBe(700);
    // The centre anchor is captured so the renderer doesn't top-align it.
    expect(table.cellVAligns?.[0]?.[0]).toBe("middle");
  });

  it("leaves unfilled cells null so they don't inherit a sibling's fill", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    // One cream cell; the other three have no <a:tcPr> fill at all. Their
    // parsed fill must stay null (renderer paints them transparent) — they
    // must NOT pick up the cream as a row default, which would flood the grid.
    const cream =
      `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>c</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="F8F6F2"/></a:solidFill></a:tcPr></a:tc>`;
    const empty =
      `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>e</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="6000000" cy="2000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="3000000"/><a:gridCol w="3000000"/></a:tblGrid><a:tr h="500000">${cream}${empty}</a:tr><a:tr h="500000">${empty}${empty}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const table = deck.slides[0].elements.find((e) => e.type === "table");
    if (table?.type !== "table") return;
    expect(table.cellFills?.[0]?.[0]?.toUpperCase()).toBe("#F8F6F2");
    // The three fill-less cells stay null — not the cream colour.
    expect(table.cellFills?.[0]?.[1]).toBeNull();
    expect(table.cellFills?.[1]?.[0]).toBeNull();
    expect(table.cellFills?.[1]?.[1]).toBeNull();
  });

  it("trims trailing empty paragraphs but keeps leading ones", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    const empty = `<a:p><a:pPr/><a:endParaRPr lang="de-DE"/></a:p>`;
    const line = (t: string) =>
      `<a:p><a:pPr/><a:r><a:rPr lang="de-DE"/><a:t>${t}</a:t></a:r></a:p>`;
    // leading blank, content, then two trailing blanks.
    const body = empty + line("Xa") + line("Xb") + empty + empty;
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const text = deck.slides[0].elements.find((e) => e.type === "text");
    if (text?.type !== "text") return;
    // The two trailing blanks are gone (no trailing newlines), the leading
    // blank stays (text begins with a newline).
    expect(text.text).toBe("\nXa\nXb");
  });

  it("omits the bullet glyph on an empty paragraph", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    // Two bulleted lines with text, then an empty bulleted paragraph (only
    // endParaRPr) — the empty one must NOT render a bullet glyph.
    const para = (body: string) =>
      `<a:p><a:pPr><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>${body}</a:p>`;
    const tb =
      para("<a:r><a:rPr lang=\"de-DE\"/><a:t>xa</a:t></a:r>") +
      para("<a:r><a:rPr lang=\"de-DE\"/><a:t>xb</a:t></a:r>") +
      para("<a:endParaRPr lang=\"de-DE\"/>");
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="1200000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${tb}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const text = deck.slides[0].elements.find((e) => e.type === "text");
    if (text?.type !== "text") return;
    // Exactly two bullets — the empty third line stays bullet-less.
    expect((text.text.match(/•/g) ?? []).length).toBe(2);
  });

  it("draws a dashed outline whose colour comes from the style lnRef", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    // A rect with a dashed line that has NO colour of its own — colour must
    // come from <p:style><a:lnRef>.
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:prstDash val="lgDash"/></a:ln></p:spPr><p:style><a:lnRef idx="2"><a:srgbClr val="204652"/></a:lnRef><a:fillRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef><a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"/></p:style><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const shape = deck.slides[0].elements.find((e) => e.type === "shape");
    if (shape?.type !== "shape") return;
    expect(shape.stroke?.toUpperCase()).toBe("#204652");
    expect(shape.strokeDash).toBe("lgDash");
  });

  it("maps the Wingdings 'q' bullet to an empty checkbox glyph", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:buFont typeface="Wingdings"/><a:buChar char="q"/></a:pPr><a:r><a:rPr lang="de-DE"/><a:t>xa</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const text = deck.slides[0].elements.find((e) => e.type === "text");
    if (text?.type !== "text") return;
    expect(text.text).toContain("☐");
    // The raw Wingdings code point must not leak through as a Latin "q".
    expect(text.text.startsWith("q")).toBe(false);
  });

  it("synthesises an arrowhead path for block-arrow presets (downArrow)", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="arrow"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="500000" cy="700000"/></a:xfrm><a:prstGeom prst="downArrow"><a:avLst><a:gd name="adj1" fmla="val 50000"/><a:gd name="adj2" fmla="val 50000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="F2F2F2"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const shape = deck.slides[0].elements.find((e) => e.type === "shape");
    expect(shape?.type).toBe("shape");
    if (shape?.type !== "shape") return;
    expect(shape.path).toBeTruthy();
    // 7-point arrow polygon = 6 line segments, and the tip is at bottom-centre.
    expect((shape.path!.d.match(/L/g) ?? []).length).toBe(6);
    const { viewW, viewH } = shape.path!;
    expect(shape.path!.d).toContain(`${(viewW / 2).toFixed(2)} ${viewH.toFixed(2)}`);
  });

  it("repeats a character bullet on each line of a one-paragraph callout", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    // One bulleted paragraph with <a:br> line breaks between items — the bullet
    // glyph must appear on every line, not just the first.
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="callout"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1500000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="de-DE"/><a:t>xa</a:t></a:r><a:br/><a:r><a:rPr lang="de-DE"/><a:t>xb</a:t></a:r><a:br/><a:r><a:rPr lang="de-DE"/><a:t>xc</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const text = deck.slides[0].elements.find((e) => e.type === "text");
    if (text?.type !== "text") return;
    // Three bulleted lines, one bullet per item.
    expect((text.text.match(/•/g) ?? []).length).toBe(3);
    expect(text.text).toContain("•");
    expect(text.text.split("\n").length).toBe(3);
  });

  it("keeps the outline of a white-filled chevron that holds text", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    // A white chevron with a teal outline holding "xyz": only the border makes
    // it visible, so the backing path must carry the stroke.
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="step"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="400000"/></a:xfrm><a:prstGeom prst="chevron"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="3F8CA3"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>xyz</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const text = deck.slides[0].elements.find((e) => e.type === "text");
    if (text?.type !== "text") return;
    expect(text.backingPath).toBeTruthy();
    expect(text.backingPath?.stroke?.toUpperCase()).toBe("#3F8CA3");
    expect((text.backingPath?.strokeWidth ?? 0)).toBeGreaterThan(0);
  });

  it("keeps a text-bearing roundRect's fill, border, and corner radius", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    // A white roundRect with a navy outline that hosts text — without keeping
    // the box it would vanish into the slide (white-on-white, no border).
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="bubble"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1200000"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 10000"/></a:avLst></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="0F2B53"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>xa</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const text = deck.slides[0].elements.find((e) => e.type === "text");
    expect(text?.type).toBe("text");
    if (text?.type !== "text") return;
    expect(text.background?.toUpperCase()).toBe("#FFFFFF");
    expect(text.borderColor?.toUpperCase()).toBe("#0F2B53");
    expect((text.borderWidth ?? 0)).toBeGreaterThan(0);
    expect((text.borderRadius ?? 0)).toBeGreaterThan(0);
  });

  it("only no-wraps SHORT autofit labels, not long autofit paragraphs", async () => {
    const make = async (t: string) => {
      const zip = baseZip();
      zip.file(
        "ppt/_rels/presentation.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
      );
      zip.file(
        "ppt/slides/slide1.xml",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="de-DE"/><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
      );
      zip.file(
        "ppt/slides/_rels/slide1.xml.rels",
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
      );
      const buffer = await zip.generateAsync({ type: "arraybuffer" });
      const deck = await parsePptx(buffer);
      const el = deck.slides[0].elements.find((e) => e.type === "text");
      return el?.type === "text" ? el.noWrap : undefined;
    };
    expect(await make("02 |")).toBe(true);
    expect(
      await make("Sparringspartner & Umsetzungs-Begleitung des Mitigationsplans")
    ).toBeFalsy();
  });

  it("keeps rich cell content: ✓ glyphs, highlight, and bullet line breaks", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    // A cell with two Wingdings-checkmark bullet paragraphs, each run
    // highlighted yellow. Expect ✓ glyphs (mapped from "ü"), preserved line
    // breaks, and per-run highlight in cellRuns.
    const para = (t: string) =>
      `<a:p><a:pPr><a:buFont typeface="Wingdings"/><a:buChar char="ü"/></a:pPr><a:r><a:rPr lang="de-DE"><a:highlight><a:srgbClr val="FFFF00"/></a:highlight></a:rPr><a:t>${t}</a:t></a:r></a:p>`;
    const tc =
      `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${para("xa")}${para("xb")}</a:txBody><a:tcPr/></a:tc>`;
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="4000000"/></a:tblGrid><a:tr h="1000000">${tc}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const table = deck.slides[0].elements.find((e) => e.type === "table");
    if (table?.type !== "table") return;
    const runs = table.cellRuns?.[0]?.[0];
    expect(runs && runs.length).toBeTruthy();
    const joined = (runs ?? []).map((r) => r.text).join("");
    // Wingdings "ü" became a real check mark, not a stray Latin char.
    expect(joined).toContain("✓");
    expect(joined).not.toContain("ü");
    // Line break between the two bullet paragraphs is preserved.
    expect(joined).toContain("\n");
    // Highlight rides on the runs.
    expect((runs ?? []).some((r) => r.highlight?.toUpperCase() === "#FFFF00")).toBe(
      true
    );
  });

  it("spans a merged cell (gridSpan) so a band covers its full width", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    // Row with a 3-wide merge: c0 is the gridSpan origin, c1/c2 are hMerge
    // continuations covered by it.
    const origin =
      `<a:tc gridSpan="3"><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>band</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="F8F6F2"/></a:solidFill></a:tcPr></a:tc>`;
    const merged =
      `<a:tc hMerge="1"><a:txBody><a:bodyPr/><a:lstStyle/><a:p/></a:txBody><a:tcPr/></a:tc>`;
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="6000000" cy="1000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="2000000"/><a:gridCol w="2000000"/><a:gridCol w="2000000"/></a:tblGrid><a:tr h="500000">${origin}${merged}${merged}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const table = deck.slides[0].elements.find((e) => e.type === "table");
    if (table?.type !== "table") return;
    expect(table.cellSpans?.[0]?.[0]).toEqual({ colSpan: 3 });
    expect(table.cellSpans?.[0]?.[1]?.covered).toBe(true);
    expect(table.cellSpans?.[0]?.[2]?.covered).toBe(true);
    // The origin keeps its fill across the whole span.
    expect(table.cellFills?.[0]?.[0]?.toUpperCase()).toBe("#F8F6F2");
  });

  it("reads per-side cell borders: colour vs noFill vs unspecified", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    // One cell: teal top line (1pt), navy right line (3pt), bottom noFill,
    // left side unspecified. The renderer should draw only the two lines.
    const tcPr =
      `<a:tcPr>` +
      `<a:lnT w="12700"><a:solidFill><a:srgbClr val="3F8CA3"/></a:solidFill></a:lnT>` +
      `<a:lnR w="38100"><a:solidFill><a:srgbClr val="0F2B53"/></a:solidFill></a:lnR>` +
      `<a:lnB><a:noFill/></a:lnB>` +
      `</a:tcPr>`;
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="4000000"/></a:tblGrid><a:tr h="1000000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>X</a:t></a:r></a:p></a:txBody>${tcPr}</a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
    );

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const table = deck.slides[0].elements.find((e) => e.type === "table");
    expect(table?.type).toBe("table");
    if (table?.type !== "table") return;
    const cb = table.cellBorders?.[0]?.[0];
    expect(cb).toBeTruthy();
    expect(cb?.t?.color.toUpperCase()).toBe("#3F8CA3");
    expect(cb?.r?.color.toUpperCase()).toBe("#0F2B53");
    // Wider line keeps a larger pixel width than the thin one.
    expect((cb?.r?.width ?? 0)).toBeGreaterThan(cb?.t?.width ?? 0);
    expect(cb?.b).toBeNull(); // explicit <a:noFill> → no line
    expect(cb?.l).toBeUndefined(); // side not specified at all
  });

  it("skips shapes flagged hidden='1' (e.g. think-cell data objects)", async () => {
    const zip = baseZip();
    zip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    // Two pictures: one hidden ("do not delete" data object pinned to the
    // top-left corner) and one visible. Only the visible one should render.
    zip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:pic><p:nvPicPr><p:cNvPr id="5" name="think-cell data - do not delete" hidden="1"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="1588" y="1588"/><a:ext cx="1227" cy="1588"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic><p:pic><p:nvPicPr><p:cNvPr id="6" name="visible"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="2000000" y="2000000"/><a:ext cx="2000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/dot.png"/></Relationships>`
    );
    zip.file("ppt/media/dot.png", ONE_PX_PNG);

    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    const images = deck.slides[0].elements.filter((e) => e.type === "image");
    // Hidden picture dropped; only the visible one survives.
    expect(images.length).toBe(1);
    if (images[0]?.type !== "image") return;
    // The survivor is the visible picture, not the tiny top-left data object.
    expect(images[0].x).toBeGreaterThan(10);
    expect(images[0].y).toBeGreaterThan(10);
  });
});
