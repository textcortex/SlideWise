import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  parsePptx,
  serializeDeck,
  addSlideFromLayout,
  summarizeLayouts,
} from "../../../index";
import type { ImageElement, Slide } from "@/lib/types";

// 1×1 transparent PNG for host-authored image-slot tests.
const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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

function themeXml(name: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${name}"><a:themeElements><a:clrScheme name="${name}"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="${name}"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="${name}"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

/**
 * A two-master source: master1 owns slideLayout1 + theme1, master2 owns
 * slideLayout2 + theme2. Instantiating from a layout under master2 must route
 * its chrome through master2 / theme2, not master1.
 */
function sourceWithTwoMasters(): JSZip {
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
  <Override PartName="/ppt/slideMasters/slideMaster2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${REL}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId2"/><p:sldMasterId id="2147483649" r:id="rId3"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId3" Type="${REL}/slideMaster" Target="slideMasters/slideMaster2.xml"/></Relationships>`
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>`
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`
  );
  for (const [n, master] of [
    [1, 1],
    [2, 2],
  ]) {
    zip.file(
      `ppt/slideLayouts/slideLayout${n}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" type="obj"><p:cSld name="Layout ${n}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="457200"/><a:ext cx="10363200" cy="1143000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`
    );
    zip.file(
      `ppt/slideLayouts/_rels/slideLayout${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster${master}.xml"/></Relationships>`
    );
    zip.file(
      `ppt/slideMasters/slideMaster${n}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="${2147483650 + n}" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`
    );
    zip.file(
      `ppt/slideMasters/_rels/slideMaster${n}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout${n}.xml"/><Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme${n}.xml"/></Relationships>`
    );
    zip.file(`ppt/theme/theme${n}.xml`, themeXml(`Office${n}`));
  }
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

describe("F1: host author-a-slide contract", () => {
  it("filled placeholder text survives the round-trip and re-parses", async () => {
    const source = await sourceWithLayout().generateAsync({
      type: "arraybuffer",
    });
    const deck = await parsePptx(source);
    const next = addSlideFromLayout(deck, "slideLayout1", {
      fills: { title: "Quarterly Review", "body:1": "Revenue up 24%" },
    });

    const blob = await serializeDeck(next, { source });
    const reparsed = await parsePptx(await blob.arrayBuffer());
    // The instantiated slide (index 1) carries its filled text.
    const dump = JSON.stringify(reparsed.slides[1]);
    expect(dump).toContain("Quarterly Review");
    expect(dump).toContain("Revenue up 24%");
  });

  it("a host-authored element placed at a layout slot lands with layout chrome", async () => {
    // The Python-host path: read a slot's geometry from summarizeLayouts, set
    // sourceLayoutId, and drop a real element there — no addSlideFromLayout.
    const source = await sourceWithLayout().generateAsync({
      type: "arraybuffer",
    });
    const deck = await parsePptx(source);
    const slot = summarizeLayouts(deck)[0].placeholders.find(
      (p) => p.type === "body"
    )!;

    const image: ImageElement = {
      id: "hostimg",
      type: "image",
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
      rotation: 0,
      z: 1,
      src: PNG_1x1,
      fit: "cover",
    };
    const authored: Slide = {
      id: "authored1",
      background: "transparent",
      sourceLayoutId: "slideLayout1",
      elements: [image],
    };
    const next = { ...deck, slides: [...deck.slides, authored] };

    const blob = await serializeDeck(next, { source });
    const out = await JSZip.loadAsync(await blob.arrayBuffer());
    // The image landed on the instantiated slide…
    const slide2 = await out.file("ppt/slides/slide2.xml")!.async("string");
    expect(slide2).toContain("<p:pic>");
    // …pointed at the layout's chrome, with no opaque bg blocking inheritance.
    const rels2 = await out
      .file("ppt/slides/_rels/slide2.xml.rels")!
      .async("string");
    expect(rels2).toMatch(/slideLayout1\.xml/);
    expect(slide2).not.toMatch(/<p:bg\b/);
  });

  it("resolves sourceLayoutId by id convention even without deck.layouts", async () => {
    const source = await sourceWithLayout().generateAsync({
      type: "arraybuffer",
    });
    const deck = await parsePptx(source);
    // Host authored a deck WITHOUT carrying the layouts array — only the id.
    const authored: Slide = {
      id: "a1",
      background: "transparent",
      sourceLayoutId: "slideLayout1",
      elements: [],
    };
    const next = { ...deck, layouts: undefined, slides: [...deck.slides, authored] };

    const warnings: { code: string }[] = [];
    const blob = await serializeDeck(next, {
      source,
      onWarning: (w) => warnings.push(w),
    });
    const out = await JSZip.loadAsync(await blob.arrayBuffer());
    const rels2 = await out
      .file("ppt/slides/_rels/slide2.xml.rels")!
      .async("string");
    // Resolved from the source archive by the slideLayoutN convention.
    expect(rels2).toMatch(/slideLayout1\.xml/);
    expect(warnings.some((w) => w.code === "layout-unresolved")).toBe(false);
  });

  it("warns (machine-readably) when sourceLayoutId resolves to nothing", async () => {
    const source = await sourceWithLayout().generateAsync({
      type: "arraybuffer",
    });
    const deck = await parsePptx(source);
    const authored: Slide = {
      id: "a1",
      background: "transparent",
      sourceLayoutId: "slideLayoutNope",
      elements: [],
    };
    const next = { ...deck, slides: [...deck.slides, authored] };

    const warnings: { code: string; layoutId?: string; slideIndex?: number }[] =
      [];
    await serializeDeck(next, { source, onWarning: (w) => warnings.push(w) });
    const unresolved = warnings.find((w) => w.code === "layout-unresolved");
    expect(unresolved).toBeTruthy();
    expect(unresolved!.layoutId).toBe("slideLayoutNope");
    expect(unresolved!.slideIndex).toBe(1);
  });

  it("instantiating from a second master routes chrome through that master/theme", async () => {
    const source = await sourceWithTwoMasters().generateAsync({
      type: "arraybuffer",
    });
    const deck = await parsePptx(source);
    expect(deck.layouts!.map((l) => l.id)).toEqual([
      "slideLayout1",
      "slideLayout2",
    ]);

    // Instantiate from slideLayout2, which lives under master2 / theme2.
    const next = addSlideFromLayout(deck, "slideLayout2", {
      fills: { title: "Under master 2" },
    });
    const blob = await serializeDeck(next, { source });
    const out = await JSZip.loadAsync(await blob.arrayBuffer());

    // Both masters + both themes survived into the output.
    const paths = Object.keys(out.files);
    expect(paths).toContain("ppt/slideMasters/slideMaster1.xml");
    expect(paths).toContain("ppt/slideMasters/slideMaster2.xml");
    expect(paths).toContain("ppt/theme/theme1.xml");
    expect(paths).toContain("ppt/theme/theme2.xml");

    // The instantiated slide → layout2 → master2 → theme2 chain resolves.
    const slideRels = await out
      .file("ppt/slides/_rels/slide2.xml.rels")!
      .async("string");
    expect(slideRels).toMatch(/slideLayout2\.xml/);
    const layoutRels = await out
      .file("ppt/slideLayouts/_rels/slideLayout2.xml.rels")!
      .async("string");
    expect(layoutRels).toMatch(/slideMaster2\.xml/);
    const masterRels = await out
      .file("ppt/slideMasters/_rels/slideMaster2.xml.rels")!
      .async("string");
    expect(masterRels).toMatch(/theme2\.xml/);
  });
});
