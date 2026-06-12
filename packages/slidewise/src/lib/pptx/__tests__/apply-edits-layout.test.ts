import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { applyEdits, layoutSlotElementId, type EditPlan, type SerializeWarning } from "../index";

/**
 * `applyEdits` layout-instantiation tests. A `source: { layoutId }` planned
 * slide builds a fresh slide bound to one of the template's OWN layouts — still
 * a lossless patch (the layout/master/theme are already parts of `source`), so
 * the new slide inherits chrome while cloned/untouched parts stay byte-identical.
 */

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const ONE_PX_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

function relsXml(entries: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`
  );
}

/** A `<p:sp>` placeholder, optionally carrying its own geometry. */
function phSp(type: string, idx: number | null, geo: { x: number; y: number; w: number; h: number } | null): string {
  const idxAttr = idx != null ? ` idx="${idx}"` : "";
  const xfrm = geo
    ? `<a:xfrm><a:off x="${geo.x}" y="${geo.y}"/><a:ext cx="${geo.w}" cy="${geo.h}"/></a:xfrm>`
    : "";
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${Math.floor(Math.random() * 1e6) + 2}" name="${type}"/>` +
    `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${type}"${idxAttr}/></p:nvPr></p:nvSpPr>` +
    `<p:spPr>${xfrm}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`
  );
}

function slide(body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:p="${NS_P}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="3000000" cy="800000"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld></p:sld>`
  );
}

/** A 2-slide template with a real master + layout + theme chrome stack. */
async function buildLayoutTemplate(): Promise<Uint8Array> {
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
      `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
      `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>` +
      `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
      `</Types>`
  );

  zip.file(
    "_rels/.rels",
    relsXml(`<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="ppt/presentation.xml"/>`)
  );

  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:presentation xmlns:p="${NS_P}" xmlns:r="${NS_R}">` +
      `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId3"/></p:sldMasterIdLst>` +
      `<p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>` +
      `<p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    relsXml(
      `<Relationship Id="rId1" Type="${NS_R}/slide" Target="slides/slide1.xml"/>` +
        `<Relationship Id="rId2" Type="${NS_R}/slide" Target="slides/slide2.xml"/>` +
        `<Relationship Id="rId3" Type="${NS_R}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`
    )
  );

  // Two content slides, each bound to the layout.
  for (const n of [1, 2]) {
    zip.file(`ppt/slides/slide${n}.xml`, slide(`Slide ${n}`));
    zip.file(
      `ppt/slides/_rels/slide${n}.xml.rels`,
      relsXml(`<Relationship Id="rId1" Type="${NS_R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`)
    );
  }

  // Master: title + body (idx 1) placeholders, both with geometry.
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:sldMaster xmlns:p="${NS_P}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><p:cSld><p:spTree>` +
      `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
      phSp("title", null, { x: 838200, y: 365125, w: 10515600, h: 1325563 }) +
      phSp("body", 1, { x: 838200, y: 1825625, w: 10515600, h: 4351338 }) +
      `</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:sldMaster>`
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    relsXml(
      `<Relationship Id="rId1" Type="${NS_R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
        `<Relationship Id="rId2" Type="${NS_R}/theme" Target="../theme/theme1.xml"/>`
    )
  );

  // Layout: title (own xfrm), body idx1 (NO xfrm → inherits master), pic, chart.
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:sldLayout xmlns:p="${NS_P}" xmlns:a="${NS_A}" xmlns:r="${NS_R}" type="obj"><p:cSld name="Title and Content"><p:spTree>` +
      `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
      phSp("title", null, { x: 838200, y: 365125, w: 10515600, h: 1325563 }) +
      phSp("body", 1, null) +
      phSp("pic", 2, { x: 838200, y: 1825625, w: 5000000, h: 4000000 }) +
      phSp("chart", 3, { x: 6000000, y: 1825625, w: 5000000, h: 4000000 }) +
      `</p:spTree></p:cSld></p:sldLayout>`
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    relsXml(`<Relationship Id="rId1" Type="${NS_R}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`)
  );

  zip.file(
    "ppt/theme/theme1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<a:theme xmlns:a="${NS_A}" name="T"><a:themeElements><a:clrScheme name="T">` +
      `<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>` +
      `<a:dk2><a:srgbClr val="111111"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>` +
      `<a:accent1><a:srgbClr val="EA1B0A"/></a:accent1><a:accent2><a:srgbClr val="0E1330"/></a:accent2>` +
      `<a:accent3><a:srgbClr val="333333"/></a:accent3><a:accent4><a:srgbClr val="444444"/></a:accent4>` +
      `<a:accent5><a:srgbClr val="555555"/></a:accent5><a:accent6><a:srgbClr val="666666"/></a:accent6>` +
      `<a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink>` +
      `</a:clrScheme><a:fontScheme name="T"><a:majorFont><a:latin typeface="Arial"/></a:majorFont>` +
      `<a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme>` +
      `<a:fmtScheme name="T"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
      `<a:lnStyleLst><a:ln/></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
      `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>` +
      `</a:themeElements></a:theme>`
  );

  return zip.generateAsync({ type: "uint8array" });
}

async function loadZip(bytes: Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(bytes);
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
    const ownerDir = relsPath.includes("/_rels/") ? relsPath.slice(0, relsPath.indexOf("/_rels/")) : "";
    for (const m of xml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
      const tag = m[0];
      const mode = /\bTargetMode="([^"]+)"/.exec(tag)?.[1];
      const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
      if (!target || mode === "External" || /^https?:/.test(target)) continue;
      expect(present.has(normalise(target, ownerDir)), `${relsPath} → ${target}`).toBe(true);
    }
  }
}

/** Find the output slide part that is neither slide1 nor slide2 (the new one). */
function instantiatedSlidePath(zip: JSZip): string {
  const paths: string[] = [];
  zip.forEach((p) => {
    if (/^ppt\/slides\/slide\w+\.xml$/.test(p)) paths.push(p);
  });
  const p = paths.find((x) => x !== "ppt/slides/slide1.xml" && x !== "ppt/slides/slide2.xml");
  if (!p) throw new Error(`no instantiated slide among ${paths.join(", ")}`);
  return p;
}

describe("applyEdits — layout instantiation", () => {
  it("mixes cloned + layout-instantiated slides losslessly", async () => {
    const source = await buildLayoutTemplate();
    const warnings: SerializeWarning[] = [];

    const plan: EditPlan = {
      slides: [
        { source: { slideIndex: 1 }, edits: [] },
        { source: { slideIndex: 2 }, edits: [] },
        {
          source: { layoutId: "slideLayout1", fills: { title: "Hello", "body:1": "World" } },
          edits: [
            { op: "setImage", elementId: layoutSlotElementId("slideLayout1", "pic:2"), data: ONE_PX_PNG },
            {
              op: "addChart",
              bounds: { x: 600, y: 200, w: 500, h: 400 },
              kind: "column",
              categories: ["A", "B"],
              series: [{ name: "S", values: [1, 2] }],
            },
          ],
        },
      ],
    };

    const out = await applyEdits(source, plan, { onWarning: (w) => warnings.push(w) });
    expect(warnings).toEqual([]);

    const srcZip = await loadZip(source);
    const outZip = await loadZip(out);

    // Three output slides, in order.
    const pres = await outZip.file("ppt/presentation.xml")!.async("string");
    expect((pres.match(/<p:sldId\b/g) ?? []).length).toBe(3);

    // Untouched cloned slides stay byte-identical.
    for (const n of [1, 2]) {
      const a = await srcZip.file(`ppt/slides/slide${n}.xml`)!.async("uint8array");
      const b = await outZip.file(`ppt/slides/slide${n}.xml`)!.async("uint8array");
      expect(b, `slide${n} byte-identical`).toEqual(a);
    }

    const instPath = instantiatedSlidePath(outZip);
    const instXml = await outZip.file(instPath)!.async("string");
    const instRels = await outZip.file(`ppt/slides/_rels/${instPath.split("/").pop()}.rels`)!.async("string");

    // Bound to the right layout (so it inherits theme/master/background chrome).
    expect(instRels).toContain("../slideLayouts/slideLayout1.xml");
    expect(instRels).toContain("/slideLayout");

    // Fills populated the text placeholders.
    expect(instXml).toContain("<a:t>Hello</a:t>");
    expect(instXml).toContain("<a:t>World</a:t>");

    // The picture placeholder is a <p:pic> whose blip was repointed by setImage.
    expect(instXml).toContain("<p:pic>");
    const embed = /<a:blip\b[^>]*\br:embed="([^"]+)"/.exec(instXml)![1];
    const target = new RegExp(`Id="${embed}"[^>]*Target="([^"]+)"`).exec(instRels)![1];
    expect(await outZip.file(normalise(target, "ppt/slides"))!.async("uint8array")).toEqual(ONE_PX_PNG);

    // The added chart was spliced in + content-typed.
    expect(instXml).toContain("drawingml/2006/chart");
    expect(await outZip.file("[Content_Types].xml")!.async("string")).toContain("drawingml.chart+xml");

    // Chrome stack survives + structurally intact.
    expect(outZip.file("ppt/slideLayouts/slideLayout1.xml")).not.toBeNull();
    expect(outZip.file("ppt/slideMasters/slideMaster1.xml")).not.toBeNull();
    expect(outZip.file("ppt/theme/theme1.xml")).not.toBeNull();
    expect(outZip.file("_rels/.rels")).not.toBeNull();
    await assertNoDanglingRels(outZip);
  });

  it("inherits placeholder geometry from the master when the layout omits it", async () => {
    const source = await buildLayoutTemplate();
    const plan: EditPlan = {
      slides: [
        { source: { layoutId: "slideLayout1", fills: { "body:1": "Body text" } }, edits: [] },
      ],
    };
    const out = await applyEdits(source, plan);
    const zip = await loadZip(out);
    const instXml = await zip.file(instantiatedSlidePath(zip))!.async("string");
    // body had no layout xfrm → master geometry (off 838200,1825625) is used.
    expect(instXml).toContain("<a:t>Body text</a:t>");
    expect(instXml).toContain('y="1825625"');
    await assertNoDanglingRels(zip);
  });

  it("warns + skips an unresolvable layoutId without shipping a wrong slide", async () => {
    const source = await buildLayoutTemplate();
    const warnings: SerializeWarning[] = [];
    const plan: EditPlan = {
      slides: [
        { source: { slideIndex: 1 }, edits: [] },
        { source: { layoutId: "slideLayout999" }, edits: [] },
      ],
    };
    const out = await applyEdits(source, plan, { onWarning: (w) => warnings.push(w) });
    const zip = await loadZip(out);
    expect(warnings.some((w) => w.code === "layout-unresolved")).toBe(true);
    // Only the resolvable slide ships.
    const pres = await zip.file("ppt/presentation.xml")!.async("string");
    expect((pres.match(/<p:sldId\b/g) ?? []).length).toBe(1);
    await assertNoDanglingRels(zip);
  });
});
