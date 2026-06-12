import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parsePptx } from "../index";

/**
 * `deck.fontUsage` font-transparency report: every family the text uses, each
 * flagged embedded (a real `ppt/fonts/*` part in `<p:embeddedFontLst>`) vs only
 * referenced (system-fallback risk on viewers that don't ship it).
 */

const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function rels(entries: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`
  );
}

function textSp(id: number, x: number, typeface: string, text: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="t${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="0"/><a:ext cx="3000000" cy="800000"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"><a:latin typeface="${typeface}"/></a:rPr>` +
    `<a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`
  );
}

async function buildFontTemplate(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="fntdata" ContentType="application/x-fontdata"/>` +
      `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
      `<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>` +
      `</Types>`
  );
  zip.file("_rels/.rels", rels(`<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="ppt/presentation.xml"/>`));

  // Embed FontA only; FontB is referenced by text but not embedded.
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:presentation xmlns:p="${NS_P}" xmlns:r="${NS_R}">` +
      `<p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>` +
      `<p:sldSz cx="12192000" cy="6858000"/>` +
      `<p:embeddedFontLst><p:embeddedFont><p:font typeface="FontA"/><p:regular r:id="rIdFontA"/></p:embeddedFont></p:embeddedFontLst>` +
      `</p:presentation>`
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    rels(
      `<Relationship Id="rId1" Type="${NS_R}/slide" Target="slides/slide1.xml"/>` +
        `<Relationship Id="rIdFontA" Type="${NS_R}/font" Target="fonts/font1.fntdata"/>`
    )
  );
  zip.file("ppt/fonts/font1.fntdata", Uint8Array.from([0x00, 0x01, 0x00, 0x00, 0x00]));

  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:sld xmlns:p="${NS_P}" xmlns:a="${NS_A}"><p:cSld><p:spTree>` +
      `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
      textSp(2, 0, "FontA", "Embedded brand text") +
      textSp(3, 4000000, "FontB", "Referenced-only text") +
      `</p:spTree></p:cSld></p:sld>`
  );
  zip.file("ppt/slides/_rels/slide1.xml.rels", rels(""));

  return zip.generateAsync({ type: "uint8array" });
}

describe("deck.fontUsage", () => {
  it("flags embedded vs referenced-only font families", async () => {
    const deck = await parsePptx(await buildFontTemplate());
    const usage = deck.fontUsage ?? [];
    const byFamily = new Map(usage.map((u) => [u.family, u.embedded]));

    expect(byFamily.get("FontA")).toBe(true); // embedded via <p:embeddedFontLst>
    expect(byFamily.get("FontB")).toBe(false); // referenced by text, not embedded
  });
});
