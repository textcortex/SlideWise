import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
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

  it("stays browser-free (no Playwright/Puppeteer/jsdom in the source)", () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.resolve(__dirname, "../renderDeck.ts"), "utf8");
    // No import of a headless-browser stack (a doc comment may name them).
    expect(/from\s+["'](?:playwright|puppeteer|jsdom)/i.test(src)).toBe(false);
    expect(/import\(["'](?:playwright|puppeteer|jsdom)/i.test(src)).toBe(false);
  });
});
