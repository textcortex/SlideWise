import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  parsePptx,
  serializeDeck,
  addSlideFromLayout,
  summarizeLayouts,
} from "../../../index";

/**
 * F1: master layouts are exposed as instantiable templates (Deck.layouts), and
 * addSlideFromLayout mints a fresh slide bound to a layout with its text
 * placeholders ready to fill. The serializer points the new slide at the
 * source layout part.
 */

const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function sourceWithLayout(): JSZip {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${REL}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId2"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>`
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
  );
  // Layout with a title and a body placeholder, each with explicit geometry.
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="obj"><p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="10363200" cy="1143000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400"><a:latin typeface="Georgia"/></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:endParaRPr/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="1714500"/><a:ext cx="10363200" cy="4114800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`
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

/**
 * A source with two distinct layouts — a "title" cover (ctrTitle + subTitle)
 * and an "obj" content layout (title + body) — so instantiated slides must be
 * routed to the correct, per-layout chrome.
 */
function sourceWithTwoLayouts(): JSZip {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${REL}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId2"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>`
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout2.xml"/></Relationships>`
  );
  // slideLayout1: a title cover (ctrTitle + subTitle).
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="title"><p:cSld name="Title Slide"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="2057400"/><a:ext cx="10363200" cy="1143000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Subtitle 2"/><p:cNvSpPr/><p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="3429000"/><a:ext cx="10363200" cy="1143000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`
  );
  // slideLayout2: title + content.
  zip.file(
    "ppt/slideLayouts/slideLayout2.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="obj"><p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="10363200" cy="1143000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="1714500"/><a:ext cx="10363200" cy="4114800"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout2.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst></p:sldMaster>`
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout2.xml"/><Relationship Id="rId3" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`
  );
  zip.file(
    "ppt/theme/theme1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
  );
  return zip;
}

describe("F1: instantiable layouts", () => {
  it("exposes layouts with placeholder geometry + style", async () => {
    const source = await sourceWithLayout().generateAsync({
      type: "arraybuffer",
    });
    const deck = await parsePptx(source);

    expect(deck.layouts).toBeTruthy();
    expect(deck.layouts!.length).toBe(1);
    const layout = deck.layouts![0];
    expect(layout.id).toBe("slideLayout1");
    expect(layout.name).toBe("Title and Content");
    expect(layout.sourcePath).toBe("ppt/slideLayouts/slideLayout1.xml");
    expect(layout.placeholders.length).toBe(2);

    const title = layout.placeholders.find((p) => p.type === "title")!;
    // 914400 EMU = 144 canvas px on a 16:9 source (fit scale 1, offset 0).
    expect(title.x).toBe(144);
    expect(title.y).toBe(72);
    expect(title.align).toBe("center");
    expect(title.fontFamily).toBe("Georgia");
    expect(title.fontSize).toBe(88); // sz 4400 → 44pt → 88px

    const body = layout.placeholders.find((p) => p.type === "body")!;
    expect(body.idx).toBe(1);
    expect(body.y).toBe(270); // 1714500 EMU → 270px
  });

  it("addSlideFromLayout mints a bound slide with filled text placeholders", async () => {
    const source = await sourceWithLayout().generateAsync({
      type: "arraybuffer",
    });
    const deck = await parsePptx(source);

    const next = addSlideFromLayout(deck, "slideLayout1", {
      fills: { title: "Hello", "body:1": "World" },
    });
    // Pure: original deck unchanged, new deck has the extra slide.
    expect(deck.slides.length).toBe(1);
    expect(next.slides.length).toBe(2);

    const slide = next.slides[1];
    expect(slide.sourceLayoutId).toBe("slideLayout1");
    expect(slide.elements.length).toBe(2);
    const titleEl = slide.elements[0];
    expect(titleEl.type).toBe("text");
    expect((titleEl as { text: string }).text).toBe("Hello");
    expect(titleEl.x).toBe(144);

    // The serialized new slide points at the source layout part.
    const blob = await serializeDeck(next, { source });
    const out = await JSZip.loadAsync(await blob.arrayBuffer());
    const rels = await out
      .file("ppt/slides/_rels/slide2.xml.rels")!
      .async("string");
    expect(rels).toMatch(/slideLayout1\.xml/);
  });

  it("throws for an unknown layout id", async () => {
    const source = await sourceWithLayout().generateAsync({
      type: "arraybuffer",
    });
    const deck = await parsePptx(source);
    expect(() => addSlideFromLayout(deck, "nope")).toThrow(/no layout/);
  });

  it("captures the layout role type and summarises layouts for selection", async () => {
    const source = await sourceWithLayout().generateAsync({
      type: "arraybuffer",
    });
    const deck = await parsePptx(source);

    // Raw OOXML role survives the import.
    expect(deck.layouts![0].type).toBe("obj");

    const menu = summarizeLayouts(deck);
    expect(menu.length).toBe(1);
    const [layout] = menu;
    expect(layout.id).toBe("slideLayout1");
    expect(layout.name).toBe("Title and Content");
    expect(layout.type).toBe("obj");
    expect(layout.role).toBe("Title and content");
    // Both placeholders are text → fillable; keys match the `fills` contract.
    expect(layout.fillable).toEqual(["title", "body:1"]);
    const body = layout.placeholders.find((p) => p.type === "body")!;
    expect(body.key).toBe("body:1");
    expect(body.idx).toBe(1);
    expect(body.category).toBe("text");
    expect(body.fillable).toBe(true);
    // Geometry comes along for layout-menu rendering.
    expect(body.y).toBe(270);
  });
});

describe("F1: instantiated slides carry their layout's chrome", () => {
  it("points each instantiated slide at its own layout and drops the flat bg", async () => {
    const source = await sourceWithTwoLayouts().generateAsync({
      type: "arraybuffer",
    });
    const deck = await parsePptx(source);
    expect(deck.layouts!.map((l) => l.id)).toEqual([
      "slideLayout1",
      "slideLayout2",
    ]);

    // Roles distinguish the two layouts for a model menu.
    const menu = summarizeLayouts(deck);
    expect(menu.find((l) => l.id === "slideLayout1")!.role).toBe("Title slide");
    expect(menu.find((l) => l.id === "slideLayout2")!.role).toBe(
      "Title and content"
    );

    // Instantiate a fresh slide from EACH layout (the 35-slide-scale use case:
    // more slides than the template hand-authored, using its own variety).
    let next = addSlideFromLayout(deck, "slideLayout1", {
      fills: { ctrTitle: "Cover" },
    });
    next = addSlideFromLayout(next, "slideLayout2", {
      fills: { title: "Agenda", "body:1": "Points" },
    });
    // [source, fromLayout1, fromLayout2] → output slide1 / slide2 / slide3.
    expect(next.slides.length).toBe(3);

    const blob = await serializeDeck(next, { source });
    const out = await JSZip.loadAsync(await blob.arrayBuffer());

    // Each instantiated slide's rels point at the SOURCE layout part it was
    // minted from — not a shared default, not output position.
    const rels2 = await out
      .file("ppt/slides/_rels/slide2.xml.rels")!
      .async("string");
    const rels3 = await out
      .file("ppt/slides/_rels/slide3.xml.rels")!
      .async("string");
    expect(rels2).toMatch(/slideLayouts\/slideLayout1\.xml/);
    expect(rels2).not.toMatch(/slideLayout2\.xml/);
    expect(rels3).toMatch(/slideLayouts\/slideLayout2\.xml/);
    expect(rels3).not.toMatch(/slideLayout1\.xml/);

    // pptxgenjs's opaque flat-hex <p:bg> is stripped so the layout/master/theme
    // background shows through (transparent default = inherited chrome).
    const slide2 = await out.file("ppt/slides/slide2.xml")!.async("string");
    const slide3 = await out.file("ppt/slides/slide3.xml")!.async("string");
    expect(slide2).not.toMatch(/<p:bg\b/);
    expect(slide3).not.toMatch(/<p:bg\b/);

    // Both layout parts (and the master + theme they need) survived into the
    // output package, and every slide is declared — opens without repair.
    const types = await out.file("[Content_Types].xml")!.async("string");
    for (const part of [
      "/ppt/slides/slide1.xml",
      "/ppt/slides/slide2.xml",
      "/ppt/slides/slide3.xml",
      "/ppt/slideLayouts/slideLayout1.xml",
      "/ppt/slideLayouts/slideLayout2.xml",
    ]) {
      expect(types).toContain(part);
    }
    expect(out.file("ppt/slideLayouts/slideLayout1.xml")).toBeTruthy();
    expect(out.file("ppt/slideLayouts/slideLayout2.xml")).toBeTruthy();
    expect(out.file("ppt/slideMasters/slideMaster1.xml")).toBeTruthy();
    expect(out.file("ppt/theme/theme1.xml")).toBeTruthy();

    // The presentation lists all three slides in order.
    const presRels = await out
      .file("ppt/_rels/presentation.xml.rels")!
      .async("string");
    for (const n of [1, 2, 3]) {
      expect(presRels).toMatch(new RegExp(`slides/slide${n}\\.xml`));
    }
  });

  it("honours an explicit non-transparent background on an instantiated slide", async () => {
    const source = await sourceWithTwoLayouts().generateAsync({
      type: "arraybuffer",
    });
    const deck = await parsePptx(source);
    const next = addSlideFromLayout(deck, "slideLayout2", {
      background: "#FF0000",
      fills: { title: "Solid" },
    });
    const blob = await serializeDeck(next, { source });
    const out = await JSZip.loadAsync(await blob.arrayBuffer());
    // Host asked for an opaque fill, so the bg is kept (not stripped to inherit).
    const slide2 = await out.file("ppt/slides/slide2.xml")!.async("string");
    expect(slide2).toMatch(/<p:bg\b/);
  });
});
