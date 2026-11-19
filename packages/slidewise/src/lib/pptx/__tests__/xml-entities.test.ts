import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import pptxgen from "pptxgenjs";
import { parsePptx } from "../index";
import type { Deck } from "@/lib/types";

/**
 * XML character references (`&#8226;`, `&#x2022;`) and the five predefined
 * entities must be decoded wherever the importer reads attribute values or
 * text. pptxgenjs writes every bullet as `<a:buChar char="&#x2022;"/>`
 * (valid XML), which used to surface as the literal text "&#x2022;".
 */

function baseZip(): JSZip {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
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
    "ppt/slides/_rels/slide1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  );
  return zip;
}

/** One text box whose `<p:txBody>` holds `paragraphs`. */
async function deckWithParagraphs(paragraphs: string, zip = baseZip()): Promise<Deck> {
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
  );
  return parsePptx(await zip.generateAsync({ type: "arraybuffer" }));
}

function textOf(deck: Deck): string {
  const el = deck.slides[0].elements.find((e) => e.type === "text");
  return el?.type === "text" ? el.text : "";
}

describe("pptx importer — XML character references", () => {
  it("decodes the bullet characters pptxgenjs writes as hex references", async () => {
    const pptx = new pptxgen();
    const slide = pptx.addSlide();
    slide.addText(
      [
        { text: "Default bullet", options: { bullet: true, breakLine: true } },
        { text: "Arrow bullet", options: { bullet: { code: "25BA" }, breakLine: true } },
        { text: "Star bullet", options: { bullet: { code: "2605" } } },
      ],
      { x: 0.5, y: 0.5, w: 6, h: 2 }
    );
    const buffer = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
    const text = textOf(await parsePptx(buffer));

    expect(text).not.toContain("&#x");
    expect(text).toContain("•");
    expect(text).toContain("►");
    expect(text).toContain("★");
  });

  it("decodes decimal and hex references in attributes", async () => {
    const para = (char: string, body: string) =>
      `<a:p><a:pPr><a:buFont typeface="Arial"/><a:buChar char="${char}"/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>${body}</a:t></a:r></a:p>`;
    const text = textOf(
      await deckWithParagraphs(para("&#8226;", "decimal") + para("&#X25ba;", "hex"))
    );
    expect(text).toMatch(/•\s*decimal/);
    expect(text).toMatch(/►\s*hex/);
    expect(text).not.toContain("&#");
  });

  it("decodes references and entities in text runs in a single pass", async () => {
    const text = textOf(
      await deckWithParagraphs(
        `<a:p><a:r><a:rPr lang="en-US"/><a:t>Tom &amp; Jerry &#x263A; &#128512; &lt;b&gt; &quot;q&quot; &apos;a&apos; &amp;#x2022;</a:t></a:r></a:p>`
      )
    );
    // `&amp;#x2022;` is the escaped literal text "&#x2022;" — it must not be
    // decoded twice into a bullet.
    expect(text).toBe(`Tom & Jerry ☺ 😀 <b> "q" 'a' &#x2022;`);
  });

  it("decodes entities in the deck title", async () => {
    const zip = baseZip();
    zip.file(
      "docProps/core.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Q&amp;A &#x2013; intro</dc:title></cp:coreProperties>`
    );
    const deck = await deckWithParagraphs(`<a:p><a:r><a:t>x</a:t></a:r></a:p>`, zip);
    expect(deck.title).toBe("Q&A – intro");
  });
});
