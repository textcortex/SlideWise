import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { XMLValidator } from "fast-xml-parser";
import {
  renderDeckToSvg,
  renderDeckToImages,
  renderSlideToImage,
} from "../renderDeck";
import type { Deck, SlideElement } from "../../types";

/**
 * Headless render tests. The renderer draws WHAT THE EDITOR DRAWS (native chart
 * via ECharts SSR, diagram via layoutDiagram, text/shape/image), browser-free.
 * We assert on the composed SVG (deterministic, no rasteriser needed) and drive
 * `renderDeckToImages` through an injected rasterise hook.
 */

const ONE_PX_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);

const IMG_SRC = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";

function base(type: SlideElement["type"], x: number, y: number, w: number, h: number) {
  return { id: `${type}-${x}-${y}`, type, x, y, w, h, rotation: 0, z: 1 };
}

function buildDeck(): Deck {
  const text: SlideElement = {
    ...base("text", 100, 100, 800, 200),
    text: "Quarterly Review",
    fontFamily: "Arial",
    fontSize: 48,
    fontWeight: 700,
    italic: false,
    underline: false,
    strike: false,
    color: "#0E1330",
    align: "left",
    vAlign: "top",
    lineHeight: 1.2,
    letterSpacing: 0,
  } as SlideElement;
  const shape: SlideElement = {
    ...base("shape", 100, 400, 300, 200),
    shape: "rounded",
    fill: "#EEEEEE",
  } as SlideElement;
  const chart: SlideElement = {
    ...base("chart", 200, 150, 1200, 700),
    kind: "column",
    categories: ["Q1", "Q2", "Q3"],
    series: [{ name: "Revenue", values: [10, 20, 30], color: "#EA1B0A" }],
  } as SlideElement;
  const image: SlideElement = {
    ...base("image", 100, 100, 500, 400),
    src: IMG_SRC,
    fit: "cover",
  } as SlideElement;
  const diagram: SlideElement = {
    ...base("diagram", 700, 200, 1000, 400),
    kind: "process",
    nodes: [
      { id: "n1", text: "Discover" },
      { id: "n2", text: "Design" },
      { id: "n3", text: "Deliver" },
    ],
  } as SlideElement;

  return {
    version: 1,
    title: "Test",
    slides: [
      { id: "s1", background: "#FFFFFF", elements: [text, shape] },
      { id: "s2", background: "#FFFFFF", elements: [chart] },
      { id: "s3", background: "#FFFFFF", elements: [image, diagram] },
    ],
  } as Deck;
}

describe("renderDeckToSvg / renderDeckToImages", () => {
  it("renders one SVG per slide drawing what the editor draws", async () => {
    const svgs = await renderDeckToSvg(buildDeck());
    expect(svgs).toHaveLength(3);
    for (const s of svgs) expect(s.startsWith("<svg")).toBe(true);

    // Slide 1: text content present.
    expect(svgs[0]).toContain("Quarterly Review");

    // Slide 2: the NATIVE chart, plotted in its series colour (not a fallback).
    expect(svgs[1]).toContain("EA1B0A");
    expect(svgs[1].length).toBeGreaterThan(500);

    // Slide 3: the diagram nodes + the real image, not a raster fallback.
    expect(svgs[2]).toContain("Discover");
    expect(svgs[2]).toContain("Deliver");
    expect(svgs[2]).toContain(IMG_SRC);
  });

  it("honours the 1-based slides subset", async () => {
    const svgs = await renderDeckToSvg(buildDeck(), { slides: [2] });
    expect(svgs).toHaveLength(1);
    expect(svgs[0]).toContain("EA1B0A"); // the chart slide
  });

  it("rasterises each slide through the injected hook, in order", async () => {
    const seen: { svg: string; w: number; h: number }[] = [];
    const imgs = await renderDeckToImages(buildDeck(), {
      dpi: 150,
      rasterizeSvg: (svg, w, h) => {
        seen.push({ svg, w, h });
        return ONE_PX_PNG;
      },
    });
    expect(imgs).toHaveLength(3);
    expect(imgs.every((b) => b instanceof Uint8Array)).toBe(true);
    // dpi 150 → 1920 * 150/96 = 3000 px wide.
    expect(seen[0].w).toBe(3000);
    // The chart slide handed to the rasteriser carries the real chart colour.
    expect(seen[1].svg).toContain("EA1B0A");
  });

  it("renderSlideToImage returns a single slide's bytes", async () => {
    const img = await renderSlideToImage(buildDeck(), 1, {
      rasterizeSvg: () => ONE_PX_PNG,
    });
    expect(img).toEqual(ONE_PX_PNG);
  });

  it("caps width with maxWidth for thumbnails", async () => {
    let w = 0;
    await renderDeckToImages(buildDeck(), {
      slides: [1],
      maxWidth: 480,
      rasterizeSvg: (_svg, width) => {
        w = width;
        return ONE_PX_PNG;
      },
    });
    expect(w).toBe(480);
  });

  it("emits a real <image> for an image-fill background, not a CSS-shorthand fill", async () => {
    // The pptx importer stores image backgrounds as a CSS `background`
    // shorthand: `center / cover no-repeat url("data:image…")`. The renderer
    // must turn that into a valid SVG <image>, never `fill="…url(data:…)…"`
    // (nested quotes + a non-paint value that strict rasterisers reject).
    const bg = `center / cover no-repeat url("${IMG_SRC}")`;
    const deck = {
      version: 1,
      title: "ImageBg",
      slides: [{ id: "s1", background: bg, elements: [] }],
    } as Deck;

    const [svg] = await renderDeckToSvg(deck);
    expect(svg).toContain(`<image`);
    expect(svg).toContain(`xlink:href="${IMG_SRC}"`);
    expect(svg).toContain(`preserveAspectRatio="xMidYMid slice"`); // cover
    // The malformed shorthand-as-fill must NOT appear.
    expect(svg).not.toContain("no-repeat");
    expect(svg).not.toMatch(/fill="[^"]*url\(/);
  });

  it("renders `contain` image backgrounds with preserveAspectRatio=meet", async () => {
    const bg = `center / contain no-repeat url("${IMG_SRC}")`;
    const deck = {
      version: 1,
      title: "ContainBg",
      slides: [{ id: "s1", background: bg, elements: [] }],
    } as Deck;
    const [svg] = await renderDeckToSvg(deck);
    expect(svg).toContain(`preserveAspectRatio="xMidYMid meet"`);
  });

  it("every rendered slide is valid SVG a strict XML parser accepts", async () => {
    // Lock-in for the resvg/librsvg path: a strict (non-browser) parser must
    // accept every slide. An image-background slide is the regression case.
    const deck = {
      version: 1,
      title: "Strict",
      slides: [
        { id: "s1", background: `center / cover no-repeat url("${IMG_SRC}")`, elements: [] },
        ...buildDeck().slides,
      ],
    } as Deck;
    const svgs = await renderDeckToSvg(deck);
    for (const svg of svgs) {
      const result = XMLValidator.validate(svg);
      expect(result, typeof result === "object" ? JSON.stringify(result.err) : "")
        .toBe(true);
    }
  });

  it("rasterises an image-background slide through real @resvg/resvg-js (the actual consumer)", async () => {
    // The XMLValidator lock-in proves well-formedness; this proves the slide
    // actually *renders* through resvg — the real point of the valid-SVG fix.
    // No `rasterizeSvg` hook, so this drives the package's own default
    // dynamic-`@resvg/resvg-js` path end-to-end. resvg threw on the old
    // `fill="…url(data:…)…"` output ("expected space not 'd'").
    const deck = {
      version: 1,
      title: "ImageBgResvg",
      slides: [{ id: "s1", background: `center / cover no-repeat url("${IMG_SRC}")`, elements: [] }],
    } as Deck;

    const [png] = await renderDeckToImages(deck, { maxWidth: 320 });
    expect(png).toBeInstanceOf(Uint8Array);
    expect(Array.from(png.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]); // ‰PNG
    // Decode the IHDR (bytes 16–23) and assert resvg produced a correctly
    // *sized* raster of the 16:9 canvas — proof of a real render, not an empty
    // buffer. 1920×1080 capped at width 320 → 320×180.
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16)).toBe(320); // width
    expect(view.getUint32(20)).toBe(180); // height
  });

  it("stays browser-free (no Playwright/Puppeteer/jsdom in the source)", () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.resolve(__dirname, "../renderDeck.ts"), "utf8");
    // No import of a headless-browser stack (a doc comment may name them).
    expect(/from\s+["'](?:playwright|puppeteer|jsdom)/i.test(src)).toBe(false);
    expect(/import\(["'](?:playwright|puppeteer|jsdom)/i.test(src)).toBe(false);
  });
});
