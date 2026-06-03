import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parsePptx, isPptxTemplate, serializeDeck } from "../index";
import { CURRENT_DECK_VERSION } from "@/lib/schema/migrate";
import type { Deck } from "@/lib/types";

const PRESENTATION_MAIN_CT =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const TEMPLATE_MAIN_CT =
  "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml";
const POTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.template";
const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function makeDeck(): Deck {
  return {
    version: CURRENT_DECK_VERSION,
    title: "Template fixture",
    slides: [
      {
        id: "slide-1",
        background: "#FFFFFF",
        elements: [
          {
            id: "t1",
            type: "text",
            rotation: 0,
            z: 1,
            x: 200,
            y: 240,
            w: 1200,
            h: 200,
            text: "Template slide",
            fontFamily: "Inter",
            fontSize: 48,
            fontWeight: 400,
            italic: false,
            underline: false,
            strike: false,
            color: "#0E1330",
            align: "left",
            vAlign: "top",
            lineHeight: 1.2,
            letterSpacing: 0,
          },
        ],
      },
    ],
  };
}

async function contentTypesXml(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const file = zip.file("[Content_Types].xml");
  return file ? file.async("string") : "";
}

describe("pptx ↔ potx", () => {
  it("emits the presentation content type by default", async () => {
    const blob = await serializeDeck(makeDeck());
    expect(blob.type).toBe(PPTX_MIME);
    const xml = await contentTypesXml(blob);
    expect(xml).toContain(PRESENTATION_MAIN_CT);
    expect(xml).not.toContain(TEMPLATE_MAIN_CT);
  });

  it("emits the template content type and MIME when asTemplate is true", async () => {
    const blob = await serializeDeck(makeDeck(), { asTemplate: true });
    expect(blob.type).toBe(POTX_MIME);
    const xml = await contentTypesXml(blob);
    expect(xml).toContain(TEMPLATE_MAIN_CT);
    // The presentation override must be gone — exactly one main part.
    expect(xml).not.toContain(PRESENTATION_MAIN_CT);
  });

  it("isPptxTemplate detects templates by content type, not filename", async () => {
    const template = await templateSourceZip().generateAsync({
      type: "arraybuffer",
    });
    expect(await isPptxTemplate(template)).toBe(true);
    // A presentation (the default serializer output) is not a template.
    const presentation = await (await serializeDeck(makeDeck())).arrayBuffer();
    expect(await isPptxTemplate(presentation)).toBe(false);
    // Garbage / non-zip input is reported as not-a-template rather than throwing.
    expect(await isPptxTemplate(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("parses a .potx package (same OOXML as .pptx)", async () => {
    const zip = templateSourceZip();
    const buffer = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(buffer);
    expect(deck.slides.length).toBe(1);
  });

  it("round-trips a parsed template back to a template by default", async () => {
    const zip = templateSourceZip();
    const source = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(source);
    // No asTemplate flag: template-ness is inherited from the source archive.
    const blob = await serializeDeck(deck, { source });
    expect(blob.type).toBe(POTX_MIME);
    const xml = await contentTypesXml(blob);
    expect(xml).toContain(TEMPLATE_MAIN_CT);
    expect(xml).not.toContain(PRESENTATION_MAIN_CT);
  });

  it("can force a parsed template back to a presentation", async () => {
    const zip = templateSourceZip();
    const source = await zip.generateAsync({ type: "arraybuffer" });
    const deck = await parsePptx(source);
    const blob = await serializeDeck(deck, { source, asTemplate: false });
    expect(blob.type).toBe(PPTX_MIME);
    const xml = await contentTypesXml(blob);
    expect(xml).toContain(PRESENTATION_MAIN_CT);
    expect(xml).not.toContain(TEMPLATE_MAIN_CT);
  });
});

/**
 * Minimal valid POTX package: identical layout to a PPTX, but the main part
 * is declared as a template in [Content_Types].xml.
 */
function templateSourceZip(): JSZip {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="${TEMPLATE_MAIN_CT}"/>
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
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3000000" cy="500000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Hi</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  );
  return zip;
}
