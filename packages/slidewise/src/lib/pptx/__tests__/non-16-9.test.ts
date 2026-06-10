import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parsePptx, serializeDeck } from "../index";
import type { Deck, TextElement } from "@/lib/types";

/**
 * B3 regression: a non-16:9 template (here 4:3) must keep its masters /
 * layouts / theme and be emitted at its own slide size — not silently fall
 * back to a generic 16:9 deck. Model-emitted (edited / added) elements must
 * land at the right place, i.e. the parse-time letterbox fit is inverted.
 */

const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT_MASTER =
  "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml";
const CT_LAYOUT =
  "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml";
const CT_THEME = "application/vnd.openxmlformats-officedocument.theme+xml";

/** A 4:3 source (9144000 × 6858000 EMU = 10 × 7.5 in) with one slide, one
 *  layout, one master, one theme. */
function fourThreeSource(): JSZip {
  return sizedSource(
    `<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>`
  );
}

/** A 16:10 source (9144000 × 5715000 EMU = 10 × 6.25 in). */
function sixteenTenSource(): JSZip {
  return sizedSource(
    `<p:sldSz cx="9144000" cy="5715000" type="screen16x10"/>`
  );
}

/**
 * Same one-slide template, with a caller-supplied `<p:sldSz>` fragment so we
 * can exercise different aspect ratios (and an unreadable size for the
 * chrome-skipped diagnostic).
 */
function sizedSource(sldSzXml: string): JSZip {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT_LAYOUT}"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT_MASTER}"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="${CT_THEME}"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${REL}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId2"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>${sldSzXml}</p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId3" Type="${REL}/theme" Target="theme/theme1.xml"/></Relationships>`
  );
  // Slide with one placeholder-free text shape at source 1in,0.5in.
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Hi</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="title"><p:cSld name="Title Slide"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>`
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/theme/theme1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
  );
  return zip;
}

async function load(blob: Blob): Promise<JSZip> {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

describe("B3: non-16:9 source", () => {
  it("preserves chrome and emits the 4:3 slide size", async () => {
    const source = await fourThreeSource().generateAsync({
      type: "arraybuffer",
    });
    const deck = await parsePptx(source);
    const blob = await serializeDeck(deck, { source });
    const out = await load(blob);

    // Slide size is the 4:3 source size, NOT the default 16:9 LAYOUT_WIDE.
    const pres = await out.file("ppt/presentation.xml")!.async("string");
    expect(pres).toMatch(/<p:sldSz[^>]*cx="9144000"/);
    expect(pres).toMatch(/<p:sldSz[^>]*cy="6858000"/);
    expect(pres).not.toContain('cx="12192000"');

    // Chrome survived (would be dropped pre-fix because 4:3 ≠ 16:9).
    const paths = Object.keys(out.files);
    expect(paths).toContain("ppt/slideMasters/slideMaster1.xml");
    expect(paths).toContain("ppt/slideLayouts/slideLayout1.xml");
    expect(paths).toContain("ppt/theme/theme1.xml");
  });

  it("inverts the letterbox fit for model-emitted elements", async () => {
    const source = await fourThreeSource().generateAsync({
      type: "arraybuffer",
    });
    const parsed = await parsePptx(source);

    // Add a brand-new text box at the authoring-canvas position that maps to
    // exactly 1in,1in / 2in×1in on the 4:3 slide. 4:3 fit = scale 1, offsetX
    // 240, offsetY 0, so canvas x = sourcePx + 240; 1in = 144px → canvas 384.
    const added: TextElement = {
      id: "added-1",
      type: "text",
      x: 384,
      y: 144,
      w: 288,
      h: 144,
      rotation: 0,
      z: 10,
      text: "Added",
      fontFamily: "Inter",
      fontSize: 24,
      fontWeight: 400,
      italic: false,
      underline: false,
      strike: false,
      color: "#000000",
      align: "left",
      vAlign: "top",
      lineHeight: 1.2,
      letterSpacing: 0,
    };
    const edited: Deck = {
      ...structuredClone(parsed),
      slides: parsed.slides.map((s, i) =>
        i === 0 ? { ...s, elements: [...s.elements, added] } : s
      ),
    };

    const blob = await serializeDeck(edited, { source });
    const out = await load(blob);
    const slide1 = await out.file("ppt/slides/slide1.xml")!.async("string");

    // The added box should land at 1in (914400 EMU), 1in, 2in×1in — proving
    // the offset+scale inverse ran. Without it the 240px offset would survive
    // as ~1.67in (1524000 EMU).
    expect(slide1).toContain('x="914400"');
    expect(slide1).toContain('cx="1828800"');
    expect(slide1).not.toContain('x="1524000"');
  });

  it("preserves chrome and emits the 16:10 slide size", async () => {
    const source = await sixteenTenSource().generateAsync({
      type: "arraybuffer",
    });
    const deck = await parsePptx(source);
    const warnings: { code: string }[] = [];
    const blob = await serializeDeck(deck, {
      source,
      onWarning: (w) => warnings.push(w),
    });
    const out = await load(blob);

    const pres = await out.file("ppt/presentation.xml")!.async("string");
    expect(pres).toMatch(/<p:sldSz[^>]*cx="9144000"/);
    expect(pres).toMatch(/<p:sldSz[^>]*cy="5715000"/);
    expect(pres).not.toContain('cx="12192000"');

    const paths = Object.keys(out.files);
    expect(paths).toContain("ppt/slideMasters/slideMaster1.xml");
    expect(paths).toContain("ppt/slideLayouts/slideLayout1.xml");
    expect(paths).toContain("ppt/theme/theme1.xml");

    // A matchable aspect ratio means chrome was preserved — no diagnostic.
    expect(warnings.some((w) => w.code === "chrome-skipped")).toBe(false);
  });

  it("reports a machine-readable chrome-skipped warning when the source size is unreadable", async () => {
    // Valid deck, but a source whose <p:sldSz> can't be parsed → the chrome
    // preserve can't match aspect ratios and bails to generic chrome. The host
    // gets a structured warning instead of only a console line.
    const deck = await parsePptx(
      await fourThreeSource().generateAsync({ type: "arraybuffer" })
    );
    const brokenSource = await sizedSource(
      `<p:sldSz cx="bad" cy="bad"/>`
    ).generateAsync({ type: "arraybuffer" });

    const warnings: { code: string; message: string }[] = [];
    await serializeDeck(deck, {
      source: brokenSource,
      onWarning: (w) => warnings.push(w),
    });

    const skipped = warnings.find((w) => w.code === "chrome-skipped");
    expect(skipped).toBeTruthy();
    expect(skipped!.message).toMatch(/generic chrome/);
  });
});
