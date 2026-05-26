import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { serializeDeck } from "../index";
import { CURRENT_DECK_VERSION } from "@/lib/schema/migrate";
import type { Deck } from "@/lib/types";

/**
 * Tests for the synth-OOXML writers added in the full-fidelity export work:
 * one assertion per PR, each round-trips a tiny showcase deck and inspects
 * the generated zip for the expected OOXML constructs.
 */

const base = { rotation: 0, z: 1 };

function makeDeck(slides: Deck["slides"]): Deck {
  return { version: CURRENT_DECK_VERSION, title: "Synth", slides };
}

async function generate(deck: Deck): Promise<JSZip> {
  const blob = await serializeDeck(deck);
  const buf = await blob.arrayBuffer();
  return JSZip.loadAsync(buf);
}

describe("synth writers (PRs 1, 2, 3, 4, 5, 6, 7)", () => {
  it("PR 1: emits <a:custGeom> for shapes carrying el.path", async () => {
    const deck = makeDeck([
      {
        id: "s",
        background: "#FFFFFF",
        elements: [
          {
            ...base,
            id: "logo",
            type: "shape",
            x: 100,
            y: 100,
            w: 400,
            h: 400,
            shape: "rect",
            fill: "#FF0066",
            path: {
              d: "M 0 0 L 100 0 L 100 100 L 0 100 Z",
              viewW: 100,
              viewH: 100,
              fillRule: "evenodd",
            },
          },
        ],
      },
    ]);

    const zip = await generate(deck);
    const slide = await zip.file("ppt/slides/slide1.xml")?.async("string");
    expect(slide).toBeTruthy();
    expect(slide).toContain("<a:custGeom>");
    expect(slide).toContain("<a:moveTo>");
    expect(slide).toContain("<a:lnTo>");
    expect(slide).toContain("<a:close/>");
    // even-odd fill rule
    expect(slide).toMatch(/<a:path\b[^>]*fill="darken"/);
  });

  it("PR 2: emits <a:gradFill> for shapes with linear-gradient fill", async () => {
    const deck = makeDeck([
      {
        id: "s",
        background: "#FFFFFF",
        elements: [
          {
            ...base,
            id: "g",
            type: "shape",
            x: 100,
            y: 100,
            w: 400,
            h: 400,
            shape: "rect",
            fill: "linear-gradient(45deg, #FF0000 0%, #0000FF 100%)",
          },
        ],
      },
    ]);
    const zip = await generate(deck);
    const slide = await zip.file("ppt/slides/slide1.xml")?.async("string");
    expect(slide).toContain("<a:gradFill");
    expect(slide).toMatch(/<a:gs pos="0"/);
    expect(slide).toMatch(/<a:gs pos="100000"/);
    expect(slide).toMatch(/srgbClr val="FF0000"/);
    expect(slide).toMatch(/srgbClr val="0000FF"/);
    expect(slide).toContain("<a:lin");
  });

  it("PR 2: emits <a:blipFill> + media for url(data:image/...) fills", async () => {
    // 1x1 transparent PNG.
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const deck = makeDeck([
      {
        id: "s",
        background: "#FFFFFF",
        elements: [
          {
            ...base,
            id: "img",
            type: "shape",
            x: 0,
            y: 0,
            w: 200,
            h: 200,
            shape: "rect",
            fill: `url(${dataUrl})`,
          },
        ],
      },
    ]);
    const zip = await generate(deck);
    const slide = await zip.file("ppt/slides/slide1.xml")?.async("string");
    expect(slide).toContain("<a:blipFill>");
    const rels = await zip
      .file("ppt/slides/_rels/slide1.xml.rels")
      ?.async("string");
    expect(rels).toMatch(/Target="\.\.\/media\/imageSlidewise_img_img\./);
    const media = Object.keys(zip.files).filter((p) =>
      p.startsWith("ppt/media/imageSlidewise_")
    );
    expect(media.length).toBe(1);
  });

  it("PR 3: writes a <p:bg> gradient for slide.background = linear-gradient(...)", async () => {
    const deck = makeDeck([
      {
        id: "s",
        background: "linear-gradient(180deg, #FF0066 0%, #5500AA 100%)",
        elements: [],
      },
    ]);
    const zip = await generate(deck);
    const slide = await zip.file("ppt/slides/slide1.xml")?.async("string");
    expect(slide).toMatch(/<p:bg>[\s\S]*<a:gradFill/);
    expect(slide).toMatch(/srgbClr val="FF0066"/);
  });

  it("PR 4: writes a chartN.xml part + Content_Types override for in-app charts", async () => {
    const deck = makeDeck([
      {
        id: "s",
        background: "#FFFFFF",
        elements: [
          {
            ...base,
            id: "c1",
            type: "chart",
            x: 100,
            y: 100,
            w: 800,
            h: 400,
            kind: "column",
            categories: ["A", "B", "C"],
            series: [
              { name: "Sales", values: [10, 20, 30], color: "#4F5BD5" },
            ],
          },
        ],
      },
    ]);
    const zip = await generate(deck);
    const chartPart = Object.keys(zip.files).find((p) =>
      p.startsWith("ppt/charts/chartSW_")
    );
    expect(chartPart).toBeTruthy();
    const chartXml = await zip.file(chartPart!)?.async("string");
    expect(chartXml).toContain("<c:barChart>");
    expect(chartXml).toMatch(/<c:v>Sales<\/c:v>/);
    expect(chartXml).toMatch(/<c:v>10<\/c:v>/);
    const ct = await zip.file("[Content_Types].xml")?.async("string");
    expect(ct).toMatch(/chartSW_[^"]+"\s+ContentType="[^"]*chart\+xml/);
    const slide = await zip.file("ppt/slides/slide1.xml")?.async("string");
    expect(slide).toContain("<p:graphicFrame>");
    const rels = await zip
      .file("ppt/slides/_rels/slide1.xml.rels")
      ?.async("string");
    expect(rels).toMatch(/Type="[^"]*relationships\/chart"/);
  });

  it("PR 5: emits <p:grpSp> with nested children for group elements", async () => {
    const deck = makeDeck([
      {
        id: "s",
        background: "#FFFFFF",
        elements: [
          {
            ...base,
            id: "grp",
            type: "group",
            x: 0,
            y: 0,
            w: 800,
            h: 400,
            children: [
              {
                ...base,
                id: "child1",
                type: "shape",
                x: 0,
                y: 0,
                w: 200,
                h: 200,
                shape: "rect",
                fill: "#FF0000",
              },
              {
                ...base,
                id: "child2",
                type: "shape",
                x: 400,
                y: 0,
                w: 200,
                h: 200,
                shape: "circle",
                fill: "#00FF00",
              },
            ],
          },
        ],
      },
    ]);
    const zip = await generate(deck);
    const slide = await zip.file("ppt/slides/slide1.xml")?.async("string");
    expect(slide).toContain("<p:grpSp>");
    expect(slide).toContain("<p:grpSpPr>");
    expect(slide).toMatch(/<a:prstGeom prst="rect"/);
    expect(slide).toMatch(/<a:prstGeom prst="ellipse"/);
  });

  it("PR 6: writes ppt/fonts/*.fntdata + <p:embeddedFontLst> from Deck.fonts", async () => {
    // 4-byte dummy "font" payload. PowerPoint won't recognise it as a real
    // font, but the writer still has to copy bytes + declare the entry.
    const bytes = Buffer.from([0x00, 0x01, 0x00, 0x00]).toString("base64");
    const deck: Deck = {
      version: CURRENT_DECK_VERSION,
      title: "Embedded",
      slides: [{ id: "s", background: "#FFF", elements: [] }],
      fonts: [
        {
          family: "Brand Sans",
          data: `data:font/ttf;base64,${bytes}`,
          weight: 400,
        },
      ],
    };
    const zip = await generate(deck);
    const fontPath = Object.keys(zip.files).find(
      (p) => p.startsWith("ppt/fonts/") && p.endsWith(".fntdata")
    );
    expect(fontPath).toBeTruthy();
    const pres = await zip.file("ppt/presentation.xml")?.async("string");
    expect(pres).toContain("<p:embeddedFontLst>");
    expect(pres).toMatch(/typeface="Brand Sans"/);
    const ct = await zip.file("[Content_Types].xml")?.async("string");
    expect(ct).toMatch(/Extension="fntdata"/);
    const presRels = await zip
      .file("ppt/_rels/presentation.xml.rels")
      ?.async("string");
    expect(presRels).toMatch(/Type="[^"]*relationships\/font"/);
  });

  it("PR 7: splices <a:effectLst><a:outerShdw> into shapes with shadow", async () => {
    const deck = makeDeck([
      {
        id: "s",
        background: "#FFFFFF",
        elements: [
          {
            ...base,
            id: "sh",
            type: "shape",
            x: 100,
            y: 100,
            w: 400,
            h: 400,
            shape: "rect",
            fill: "#3366FF",
            shadow: { color: "#000000", blur: 8, offsetX: 4, offsetY: 4 },
          },
        ],
      },
    ]);
    const zip = await generate(deck);
    const slide = await zip.file("ppt/slides/slide1.xml")?.async("string");
    expect(slide).toContain("<a:effectLst>");
    expect(slide).toContain("<a:outerShdw");
  });

  it("PR 7: emits <a:glow> when glow is set, and <a:prstDash> for dashType", async () => {
    const deck = makeDeck([
      {
        id: "s",
        background: "#FFFFFF",
        elements: [
          {
            ...base,
            id: "g",
            type: "shape",
            x: 0,
            y: 0,
            w: 200,
            h: 200,
            shape: "rect",
            // Use a gradient fill so this shape takes the synth path and
            // emits prstDash through the synth line writer (the
            // pptxgenjs path supports dashType too but writes via a
            // different attribute).
            fill: "linear-gradient(0deg, #fff 0%, #000 100%)",
            stroke: "#222222",
            strokeWidth: 2,
            dashType: "dashDot",
            glow: { color: "#FFAA00", radius: 10 },
          },
        ],
      },
    ]);
    const zip = await generate(deck);
    const slide = await zip.file("ppt/slides/slide1.xml")?.async("string");
    expect(slide).toContain("<a:glow");
    expect(slide).toMatch(/<a:prstDash val="dashDot"/);
  });
});
