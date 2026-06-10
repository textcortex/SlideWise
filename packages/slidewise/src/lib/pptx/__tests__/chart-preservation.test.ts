import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parsePptx, serializeDeck } from "../index";

/**
 * B2 regression: a preserved (not regenerated) chart must carry its WHOLE
 * dependency tree across a round-trip — the embedded Excel workbook, the
 * `colors*.xml` / `style*.xml` parts, the chart's rels, and a content-type
 * declaration — not just the directly-referenced `chartN.xml`. Otherwise the
 * chart renders from baked caches but PowerPoint flags a repair and
 * "Edit Data" / custom colours+styles are lost.
 */

const CHART_NS =
  'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const CHART_CT =
  "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
const COLORS_CT = "application/vnd.ms-office.chartcolorstyle+xml";
const STYLE_CT = "application/vnd.ms-office.chartstyle+xml";
const XLSX_CT =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function chartSourceZip(): JSZip {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="xlsx" ContentType="${XLSX_CT}"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/charts/chart1.xml" ContentType="${CHART_CT}"/>
  <Override PartName="/ppt/charts/colors1.xml" ContentType="${COLORS_CT}"/>
  <Override PartName="/ppt/charts/style1.xml" ContentType="${STYLE_CT}"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="Chart 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="5000000" cy="3000000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/charts/chart1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace ${CHART_NS}><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series 1</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="1"><c:v>5</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart><c:externalData r:id="rId3"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`
  );
  zip.file(
    "ppt/charts/_rels/chart1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartColorStyle" Target="colors1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartStyle" Target="style1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/package" Target="../embeddings/Microsoft_Excel_Worksheet.xlsx"/></Relationships>`
  );
  zip.file(
    "ppt/charts/colors1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cs:colorStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" meth="cycle" id="10"><a:schemeClr val="accent1"/></cs:colorStyle>`
  );
  zip.file(
    "ppt/charts/style1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cs:chartStyle xmlns:cs="http://schemas.microsoft.com/office/drawing/2012/chartStyle" id="201"/>`
  );
  // Stand-in workbook bytes — the copy path doesn't care that it's a real xlsx.
  zip.file(
    "ppt/embeddings/Microsoft_Excel_Worksheet.xlsx",
    Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03, 0x04])
  );
  return zip;
}

describe("B2: deep chart preservation", () => {
  it("carries the chart's workbook, colors/style parts, rels, and content type", async () => {
    const source = await chartSourceZip().generateAsync({
      type: "arraybuffer",
    });
    const parsed = await parsePptx(source);

    // However the importer modelled it (live ChartElement or UnknownElement),
    // the graphicFrame OOXML — including its <c:chart r:id> — is preserved.
    const el = parsed.slides[0].elements.find(
      (e) => e.type === "chart" || e.type === "unknown"
    );
    expect(el).toBeTruthy();

    const blob = await serializeDeck(parsed, { source });
    const out = await JSZip.loadAsync(await blob.arrayBuffer());
    const paths = Object.keys(out.files);

    // The chart part itself was copied.
    const chartPath = paths.find((p) => /ppt\/charts\/.*chart1\.xml$/.test(p));
    expect(chartPath, "chart part copied").toBeTruthy();

    // Its rels were carried (this is the part the old one-level copy dropped).
    const chartRelsPath = chartPath!.replace(
      /([^/]+)\.xml$/,
      "_rels/$1.xml.rels"
    );
    const chartRelsXml = await out.file(chartRelsPath)?.async("string");
    expect(chartRelsXml, "chart rels carried").toBeTruthy();

    // The embedded workbook, colors, and style parts all came along.
    expect(
      paths.some((p) => /ppt\/embeddings\/.*\.xlsx$/.test(p)),
      "embedded workbook copied"
    ).toBe(true);
    expect(
      paths.some((p) => /ppt\/charts\/.*colors1\.xml$/.test(p)),
      "colors part copied"
    ).toBe(true);
    expect(
      paths.some((p) => /ppt\/charts\/.*style1\.xml$/.test(p)),
      "style part copied"
    ).toBe(true);

    // The chart's rels point at the copied dependents (targets resolve to
    // files that actually exist in the output).
    const relTargets = [...chartRelsXml!.matchAll(/Target="([^"]+)"/g)].map(
      (m) => m[1]
    );
    expect(relTargets.length).toBe(3);
    for (const t of relTargets) {
      const full = t.startsWith("../")
        ? "ppt/" + t.replace(/^\.\.\//, "")
        : "ppt/charts/" + t;
      expect(paths, `rel target ${t} exists`).toContain(full);
    }

    // The chart part is declared with the chart content type (an Override that
    // supersedes pptxgenjs's generic Default xml).
    const ct = await out.file("[Content_Types].xml")!.async("string");
    expect(ct).toContain(`PartName="/${chartPath}"`);
    expect(ct).toContain(CHART_CT);
  });
});
