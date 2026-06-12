import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parsePptx } from "../index";
import { applyEdits, type EditPlan, type SerializeWarning } from "../index";
import type { Deck } from "../../types";

/**
 * `applyEdits` — lossless surgical-edit API tests. Built on a synthetic 4-slide
 * template (no branded fixture needed) that carries the element kinds the API
 * patches: text placeholders, a native chart with an embedded workbook, a
 * "sample" chart to strip, a table, and an untouched decorative slide.
 */

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// Smallest valid PNG (1×1 transparent).
const ONE_PX_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

function sp(id: number, name: string, x: number, y: number, text: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="3000000" cy="800000"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2400" b="1"><a:solidFill><a:srgbClr val="0E1330"/></a:solidFill></a:rPr><a:t>${text}</a:t></a:r></a:p></p:txBody>` +
    `</p:sp>`
  );
}

function chartFrame(id: number, name: string, rid: string): string {
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="1000000" y="2000000"/><a:ext cx="6000000" cy="3000000"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
    `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${NS_R}" r:id="${rid}"/>` +
    `</a:graphicData></a:graphic></p:graphicFrame>`
  );
}

/** A bar chart part with one series + an embedded-workbook reference. */
function chartXml(externalDataRid: string | null): string {
  const ext = externalDataRid
    ? `<c:externalData r:id="${externalDataRid}"><c:autoUpdate val="0"/></c:externalData>`
    : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="${NS_A}" xmlns:r="${NS_R}">` +
    `<c:chart><c:plotArea><c:layout/>` +
    `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>` +
    `<c:ser><c:idx val="0"/><c:order val="0"/>` +
    `<c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Old Series</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
    `<c:spPr><a:solidFill><a:srgbClr val="EA1B0A"/></a:solidFill></c:spPr>` +
    `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>OldA</c:v></c:pt><c:pt idx="1"><c:v>OldB</c:v></c:pt></c:strCache></c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:val>` +
    `</c:ser>` +
    `<c:axId val="1"/><c:axId val="2"/></c:barChart>` +
    `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>` +
    `<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>` +
    `</c:plotArea><c:plotVisOnly val="1"/></c:chart>${ext}</c:chartSpace>`
  );
}

function tableFrame(id: number, name: string): string {
  return (
    `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="0" y="0"/><a:ext cx="6000000" cy="2000000"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>` +
    `<a:tblPr/><a:tblGrid><a:gridCol w="3000000"/><a:gridCol w="3000000"/></a:tblGrid>` +
    `<a:tr h="500000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>H1</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>H2</a:t></a:r></a:p></a:txBody></a:tc></a:tr>` +
    `<a:tr h="500000"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>a</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>b</a:t></a:r></a:p></a:txBody></a:tc></a:tr>` +
    `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  );
}

function picFrame(id: number, name: string, rid: string): string {
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="2000000" cy="2000000"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

function slide(body: string, withR = false): string {
  const rns = withR ? ` xmlns:r="${NS_R}"` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:p="${NS_P}" xmlns:a="${NS_A}"${rns}><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    body +
    `</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping/></p:clrMapOvr></p:sld>`
  );
}

function relsXml(entries: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`
  );
}

/** Build the 4-slide synthetic template. */
async function buildTemplate(): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="png" ContentType="image/png"/>` +
      `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
      `<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>` +
      `<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>` +
      `<Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>` +
      `<Override PartName="/ppt/slides/slide4.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>` +
      `<Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>` +
      `<Override PartName="/ppt/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>` +
      `<Override PartName="/ppt/embeddings/wb1.xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>` +
      `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
      `</Types>`
  );

  zip.file(
    "_rels/.rels",
    relsXml(
      `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="ppt/presentation.xml"/>` +
        `<Relationship Id="rId2" Type="${NS_R}/metadata/core-properties" Target="docProps/core.xml"/>`
    )
  );

  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Template</dc:title></cp:coreProperties>`
  );

  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:presentation xmlns:p="${NS_P}" xmlns:r="${NS_R}">` +
      `<p:sldIdLst>` +
      `<p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/>` +
      `<p:sldId id="258" r:id="rId3"/><p:sldId id="259" r:id="rId4"/>` +
      `</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    relsXml(
      `<Relationship Id="rId1" Type="${NS_R}/slide" Target="slides/slide1.xml"/>` +
        `<Relationship Id="rId2" Type="${NS_R}/slide" Target="slides/slide2.xml"/>` +
        `<Relationship Id="rId3" Type="${NS_R}/slide" Target="slides/slide3.xml"/>` +
        `<Relationship Id="rId4" Type="${NS_R}/slide" Target="slides/slide4.xml"/>`
    )
  );

  // Slide 1: a title placeholder.
  zip.file("ppt/slides/slide1.xml", slide(sp(2, "Title", 1000000, 500000, "Old Title")));
  zip.file("ppt/slides/_rels/slide1.xml.rels", relsXml(""));

  // Slide 2: body text + native chart with embedded workbook.
  zip.file(
    "ppt/slides/slide2.xml",
    slide(sp(2, "Body", 1000000, 500000, "Old Body") + chartFrame(3, "Chart", "rId1"), true)
  );
  zip.file(
    "ppt/slides/_rels/slide2.xml.rels",
    relsXml(`<Relationship Id="rId1" Type="${NS_R}/chart" Target="../charts/chart1.xml"/>`)
  );
  zip.file("ppt/charts/chart1.xml", chartXml("rId1"));
  zip.file(
    "ppt/charts/_rels/chart1.xml.rels",
    relsXml(`<Relationship Id="rId1" Type="${NS_R}/package" Target="../embeddings/wb1.xlsx"/>`)
  );
  zip.file("ppt/embeddings/wb1.xlsx", Uint8Array.from([0x50, 0x4b, 0x03, 0x04])); // placeholder

  // Slide 3: a sample chart to remove + a caption.
  zip.file(
    "ppt/slides/slide3.xml",
    slide(chartFrame(2, "SampleChart", "rId1") + sp(3, "Caption", 1000000, 5000000, "Caption"), true)
  );
  zip.file(
    "ppt/slides/_rels/slide3.xml.rels",
    relsXml(`<Relationship Id="rId1" Type="${NS_R}/chart" Target="../charts/chart2.xml"/>`)
  );
  zip.file("ppt/charts/chart2.xml", chartXml(null));
  zip.file("ppt/charts/_rels/chart2.xml.rels", relsXml(""));

  // Slide 4: untouched decorative slide with an image.
  zip.file("ppt/slides/slide4.xml", slide(picFrame(2, "Pic", "rId1"), true));
  zip.file(
    "ppt/slides/_rels/slide4.xml.rels",
    relsXml(`<Relationship Id="rId1" Type="${NS_R}/image" Target="../media/pic.png"/>`)
  );
  zip.file("ppt/media/pic.png", ONE_PX_PNG);

  return zip.generateAsync({ type: "uint8array" });
}

async function loadZip(bytes: Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(bytes);
}

/** Assert every internal relationship target resolves to a present part. */
async function assertNoDanglingRels(zip: JSZip): Promise<void> {
  const present = new Set<string>();
  zip.forEach((p, e) => {
    if (!e.dir) present.add(p);
  });
  const relsPaths: string[] = [];
  zip.forEach((p, e) => {
    if (!e.dir && p.endsWith(".rels")) relsPaths.push(p);
  });
  for (const relsPath of relsPaths) {
    const xml = await zip.file(relsPath)!.async("string");
    const ownerDir = relsPath.includes("/_rels/")
      ? relsPath.slice(0, relsPath.indexOf("/_rels/"))
      : "";
    for (const m of xml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
      const tag = m[0];
      const mode = /\bTargetMode="([^"]+)"/.exec(tag)?.[1];
      const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
      if (!target || mode === "External" || /^https?:/.test(target)) continue;
      const full = normalise(target, ownerDir);
      expect(present.has(full), `${relsPath} → ${target} resolves to ${full}`).toBe(true);
    }
  }
}

function normalise(target: string, baseDir: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segs = (baseDir ? baseDir.split("/") : []).concat(target.split("/"));
  const out: string[] = [];
  for (const s of segs) {
    if (s === "" || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return out.join("/");
}

function idOf(deck: Deck, slideIdx: number, pred: (e: Deck["slides"][number]["elements"][number]) => boolean): string {
  const el = deck.slides[slideIdx].elements.find(pred);
  if (!el) throw new Error("element not found");
  return el.id;
}

describe("applyEdits", () => {
  it("acceptance: edits text + fills a chart + removes a sample chart, leaving an untouched slide byte-identical with zero dangling rels", async () => {
    const source = await buildTemplate();
    const deck = await parsePptx(source);

    const titleId = idOf(deck, 0, (e) => e.type === "text");
    const bodyId = idOf(deck, 1, (e) => e.type === "text");
    const chartId = idOf(deck, 1, (e) => e.type === "chart");
    const captionId = idOf(deck, 2, (e) => e.type === "text");
    const sampleChartId = idOf(deck, 2, (e) => e.type === "chart");

    const warnings: SerializeWarning[] = [];
    const plan: EditPlan = {
      title: "Q3 Results",
      slides: [
        { source: { slideIndex: 1 }, edits: [{ op: "setText", elementId: titleId, text: "New Title" }] },
        {
          source: { slideIndex: 2 },
          edits: [
            { op: "setText", elementId: bodyId, text: "New Body" },
            {
              op: "setChartData",
              elementId: chartId,
              categories: ["Jan", "Feb", "Mar"],
              series: [{ name: "Revenue", values: [10, 20, 30] }],
            },
          ],
        },
        {
          source: { slideIndex: 3 },
          edits: [
            { op: "setText", elementId: captionId, text: "New Caption" },
            { op: "removeElement", elementId: sampleChartId },
          ],
        },
        { source: { slideIndex: 4 }, edits: [] },
      ],
    };

    const out = await applyEdits(source, plan, { onWarning: (w) => warnings.push(w) });
    expect(warnings).toEqual([]);

    const srcZip = await loadZip(source);
    const outZip = await loadZip(out);

    // (d) Slide 4 + its media stay byte-identical to source.
    const srcSlide4 = await srcZip.file("ppt/slides/slide4.xml")!.async("uint8array");
    const outSlide4 = await outZip.file("ppt/slides/slide4.xml")!.async("uint8array");
    expect(outSlide4).toEqual(srcSlide4);
    const srcPic = await srcZip.file("ppt/media/pic.png")!.async("uint8array");
    const outPic = await outZip.file("ppt/media/pic.png")!.async("uint8array");
    expect(outPic).toEqual(srcPic);

    // (a) Text edits applied.
    expect(await outZip.file("ppt/slides/slide1.xml")!.async("string")).toContain("New Title");
    expect(await outZip.file("ppt/slides/slide2.xml")!.async("string")).toContain("New Body");
    expect(await outZip.file("ppt/slides/slide3.xml")!.async("string")).toContain("New Caption");

    // (b) Chart caches reflect new data; type + colour preserved.
    const chart = await outZip.file("ppt/charts/chart1.xml")!.async("string");
    expect(chart).toContain("<c:barChart>");
    expect(chart).toContain("EA1B0A"); // template series colour preserved
    expect(chart).toContain("Revenue");
    expect(chart).toContain("Jan");
    expect(chart).toContain("Mar");
    expect(chart).not.toContain("OldA");

    // (b) Embedded workbook reflects the new data and is a valid xlsx package.
    const wbBytes = await outZip.file("ppt/embeddings/wb1.xlsx")!.async("uint8array");
    const wb = await loadZip(wbBytes);
    const sheet = await wb.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet).toContain("Jan");
    expect(sheet).toContain("Revenue");
    expect(sheet).toContain("<v>30</v>");
    await assertNoDanglingRels(wb);

    // (c) Sample chart removed; its part + workbook reclaimed.
    const slide3 = await outZip.file("ppt/slides/slide3.xml")!.async("string");
    expect(slide3).not.toContain("SampleChart");
    expect(outZip.file("ppt/charts/chart2.xml")).toBeNull();

    // Whole package: structurally intact (root rels + content types present),
    // zero dangling rels + title written.
    expect(outZip.file("_rels/.rels")).not.toBeNull();
    expect(outZip.file("[Content_Types].xml")).not.toBeNull();
    await assertNoDanglingRels(outZip);
    expect(await outZip.file("docProps/core.xml")!.async("string")).toContain("Q3 Results");
  });

  it("selects a subset of slides", async () => {
    const source = await buildTemplate();
    const plan: EditPlan = { slides: [{ source: { slideIndex: 4 }, edits: [] }] };
    const out = await applyEdits(source, plan);
    const zip = await loadZip(out);

    // Only the kept slide survives; the others (and their deps) are gone.
    expect(zip.file("ppt/slides/slide4.xml")).not.toBeNull();
    expect(zip.file("ppt/slides/slide1.xml")).toBeNull();
    expect(zip.file("ppt/slides/slide2.xml")).toBeNull();
    expect(zip.file("ppt/charts/chart1.xml")).toBeNull();
    expect(zip.file("ppt/embeddings/wb1.xlsx")).toBeNull();

    const pres = await zip.file("ppt/presentation.xml")!.async("string");
    expect((pres.match(/<p:sldId\b/g) ?? []).length).toBe(1);
    await assertNoDanglingRels(zip);
  });

  it("reorders slides via the plan order", async () => {
    const source = await buildTemplate();
    const plan: EditPlan = {
      slides: [
        { source: { slideIndex: 4 }, edits: [] },
        { source: { slideIndex: 1 }, edits: [] },
      ],
    };
    const out = await applyEdits(source, plan);
    const zip = await loadZip(out);

    const pres = await zip.file("ppt/presentation.xml")!.async("string");
    const presRels = await zip.file("ppt/_rels/presentation.xml.rels")!.async("string");
    const order = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => m[1]);
    const targetById = new Map(
      [...presRels.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g)].map(
        (m) => [m[1], m[2]]
      )
    );
    expect(order.map((id) => targetById.get(id))).toEqual([
      "slides/slide4.xml",
      "slides/slide1.xml",
    ]);
    await assertNoDanglingRels(zip);
  });

  it("repeats a source slide into independent copies", async () => {
    const source = await buildTemplate();
    const deck = await parsePptx(source);
    const titleId = idOf(deck, 0, (e) => e.type === "text");
    const plan: EditPlan = {
      slides: [
        { source: { slideIndex: 1 }, edits: [{ op: "setText", elementId: titleId, text: "First" }] },
        { source: { slideIndex: 1 }, edits: [{ op: "setText", elementId: titleId, text: "Second" }] },
      ],
    };
    const out = await applyEdits(source, plan);
    const zip = await loadZip(out);

    // The original slide1 holds the first edit; a clone holds the second.
    const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide1).toContain("First");
    expect(slide1).not.toContain("Second");
    const slidePaths: string[] = [];
    zip.forEach((p) => {
      if (/^ppt\/slides\/slide\w+\.xml$/.test(p)) slidePaths.push(p);
    });
    expect(slidePaths.length).toBe(2);
    const cloned = slidePaths.find((p) => p !== "ppt/slides/slide1.xml")!;
    expect(await zip.file(cloned)!.async("string")).toContain("Second");
    await assertNoDanglingRels(zip);
  });

  it("setText with runs rebuilds the paragraph; clearText blanks it", async () => {
    const source = await buildTemplate();
    const deck = await parsePptx(source);
    const titleId = idOf(deck, 0, (e) => e.type === "text");
    const captionId = idOf(deck, 2, (e) => e.type === "text");
    const plan: EditPlan = {
      slides: [
        {
          source: { slideIndex: 1 },
          edits: [
            {
              op: "setText",
              elementId: titleId,
              text: "x",
              runs: [{ text: "Bold", fontWeight: 700, color: "#FF0000" }],
            },
          ],
        },
        { source: { slideIndex: 3 }, edits: [{ op: "clearText", elementId: captionId }] },
      ],
    };
    const out = await applyEdits(source, plan);
    const zip = await loadZip(out);
    const slide1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(slide1).toContain("Bold");
    expect(slide1).toContain('b="1"');
    expect(slide1).toContain("FF0000");
    const slide3 = await zip.file("ppt/slides/slide3.xml")!.async("string");
    expect(slide3).not.toContain("<a:t>Caption</a:t>");
  });

  it("fills a native table, keeping its structure", async () => {
    const source = await buildTemplate();
    // Add a table to slide 4 for this test by re-parsing a template variant.
    const deck = await parsePptx(source);
    void deck;
    // Build a fresh template whose slide 1 is a table.
    const zipIn = await loadZip(source);
    zipIn.file("ppt/slides/slide1.xml", slide(tableFrame(2, "Tbl")));
    const tableSource = await zipIn.generateAsync({ type: "uint8array" });
    const tdeck = await parsePptx(tableSource);
    const tableId = idOf(tdeck, 0, (e) => e.type === "table");
    const plan: EditPlan = {
      slides: [
        {
          source: { slideIndex: 1 },
          edits: [
            {
              op: "setTableData",
              elementId: tableId,
              rows: [
                ["Region", "Sales"],
                ["EMEA", "100"],
              ],
            },
          ],
        },
      ],
    };
    const out = await applyEdits(tableSource, plan);
    const zip = await loadZip(out);
    const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(s1).toContain("Region");
    expect(s1).toContain("EMEA");
    expect(s1).toContain("<a:tbl>");
    expect(s1).not.toContain("<a:t>H1</a:t>");
    await assertNoDanglingRels(zip);
  });

  it("adds a new native chart into a region", async () => {
    const source = await buildTemplate();
    const plan: EditPlan = {
      slides: [
        {
          source: { slideIndex: 1 },
          edits: [
            {
              op: "addChart",
              bounds: { x: 100, y: 100, w: 600, h: 400 },
              kind: "column",
              categories: ["A", "B"],
              series: [{ name: "S", values: [3, 4] }],
            },
          ],
        },
      ],
    };
    const out = await applyEdits(source, plan);
    const zip = await loadZip(out);
    const s1 = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(s1).toContain("graphicData");
    // A chart part was written + content-typed.
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    expect(ct).toContain("drawingml.chart+xml");
    await assertNoDanglingRels(zip);
  });

  it("replaces an image's bytes", async () => {
    const source = await buildTemplate();
    const deck = await parsePptx(source);
    const imgId = idOf(deck, 3, (e) => e.type === "image");
    const newPng = Uint8Array.from([...ONE_PX_PNG]);
    newPng[20] = 0x02; // perturb so bytes differ
    const plan: EditPlan = {
      slides: [{ source: { slideIndex: 4 }, edits: [{ op: "setImage", elementId: imgId, data: newPng }] }],
    };
    const out = await applyEdits(source, plan);
    const zip = await loadZip(out);
    await assertNoDanglingRels(zip);
    // The blip now points at a fresh media part holding the new bytes.
    const s4 = await zip.file("ppt/slides/slide4.xml")!.async("string");
    const embed = /<a:blip\b[^>]*\br:embed="([^"]+)"/.exec(s4)![1];
    const rels = await zip.file("ppt/slides/_rels/slide4.xml.rels")!.async("string");
    const target = new RegExp(`Id="${embed}"[^>]*Target="([^"]+)"`).exec(rels)![1];
    const mediaPath = normalise(target, "ppt/slides");
    const bytes = await zip.file(mediaPath)!.async("uint8array");
    expect(bytes[20]).toBe(0x02);
  });

  it("applies a solid background and 'transparent' inheritance", async () => {
    const source = await buildTemplate();
    const plan: EditPlan = {
      slides: [
        { source: { slideIndex: 1 }, background: "#123456", edits: [] },
        { source: { slideIndex: 4 }, background: "transparent", edits: [] },
      ],
    };
    const out = await applyEdits(source, plan);
    const zip = await loadZip(out);
    expect(await zip.file("ppt/slides/slide1.xml")!.async("string")).toContain("123456");
    expect(await zip.file("ppt/slides/slide4.xml")!.async("string")).not.toContain("<p:bg>");
  });

  it("surfaces a warning for an unresolved element id instead of throwing", async () => {
    const source = await buildTemplate();
    const warnings: SerializeWarning[] = [];
    const plan: EditPlan = {
      slides: [{ source: { slideIndex: 1 }, edits: [{ op: "setText", elementId: "nope", text: "x" }] }],
    };
    const out = await applyEdits(source, plan, { onWarning: (w) => warnings.push(w) });
    expect(out.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.code === "element-write-failed")).toBe(true);
  });

  it("warns (does not crash) for unsupported layout instantiation", async () => {
    const source = await buildTemplate();
    const warnings: SerializeWarning[] = [];
    const plan: EditPlan = {
      slides: [
        { source: { slideIndex: 1 }, edits: [] },
        { source: { layoutId: "layout-x" }, edits: [] },
      ],
    };
    const out = await applyEdits(source, plan, { onWarning: (w) => warnings.push(w) });
    const zip = await loadZip(out);
    expect(warnings.some((w) => w.code === "layout-unresolved")).toBe(true);
    // The supported slide still ships.
    expect(zip.file("ppt/slides/slide1.xml")).not.toBeNull();
    await assertNoDanglingRels(zip);
  });
});
