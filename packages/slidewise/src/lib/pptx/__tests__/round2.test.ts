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
});
