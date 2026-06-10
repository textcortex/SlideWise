import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { serializeDeck } from "../index";
import { CURRENT_DECK_VERSION } from "@/lib/schema/migrate";
import type {
  Deck,
  SlideElement,
  ShapeElement,
  ChartElement,
  ConnectorElement,
} from "@/lib/types";

/**
 * Regression: synthesised content (in-app charts, custGeom "svg" shapes,
 * connectors) must honour z-order against pptxgenjs-emitted shapes. The bug was
 * that ALL synth content was forced to the back of the spTree, so a chart with
 * a higher z than its background card got buried behind that card (invisible).
 */

function card(z: number): ShapeElement {
  return {
    id: "card",
    type: "shape",
    shape: "rect",
    x: 100,
    y: 100,
    w: 500,
    h: 400,
    rotation: 0,
    z,
    fill: "#FFCC00",
  };
}

function deckWith(elements: SlideElement[]): Deck {
  return {
    version: CURRENT_DECK_VERSION,
    title: "z",
    slides: [{ id: "s1", background: "#FFFFFF", elements }],
  };
}

async function slide1(deck: Deck): Promise<string> {
  const blob = await serializeDeck(deck);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
}

const chart: ChartElement = {
  id: "chart1",
  type: "chart",
  x: 120,
  y: 120,
  w: 460,
  h: 360,
  rotation: 0,
  z: 5, // ABOVE the card
  kind: "column",
  categories: ["A", "B"],
  series: [{ name: "S", values: [3, 5] }],
};

describe("synth z-order", () => {
  it("places a higher-z synth chart AFTER (on top of) a lower-z card", async () => {
    const xml = await slide1(deckWith([card(1), chart]));
    const cardPos = xml.indexOf('name="slidewise:card"');
    const chartPos = xml.indexOf("<p:graphicFrame");
    expect(cardPos).toBeGreaterThanOrEqual(0);
    expect(chartPos).toBeGreaterThanOrEqual(0);
    expect(chartPos).toBeGreaterThan(cardPos); // chart renders on top
  });

  it("keeps a lower-z synth backdrop BEHIND a higher-z pptxgenjs card", async () => {
    // A custGeom 'svg' backdrop at z=0, card at z=1 on top of it.
    const backdrop: ShapeElement = {
      id: "bg",
      type: "shape",
      shape: "rect",
      x: 0,
      y: 0,
      w: 1920,
      h: 1080,
      rotation: 0,
      z: 0,
      fill: "#102030",
      path: { d: "M0 0 L100 0 L100 100 Z", viewW: 100, viewH: 100 },
    };
    const xml = await slide1(deckWith([backdrop, card(1)]));
    const bgPos = xml.indexOf('name="slidewise:bg"');
    const cardPos = xml.indexOf('name="slidewise:card"');
    expect(bgPos).toBeGreaterThanOrEqual(0);
    expect(cardPos).toBeGreaterThanOrEqual(0);
    expect(bgPos).toBeLessThan(cardPos); // backdrop stays behind
  });

  it("places a higher-z connector AFTER a lower-z card", async () => {
    const connector: ConnectorElement = {
      id: "cxn",
      type: "connector",
      x: 100,
      y: 100,
      w: 300,
      h: 200,
      rotation: 0,
      z: 9,
      kind: "straight",
      stroke: "#000000",
      strokeWidth: 2,
      endArrow: "triangle",
    };
    const xml = await slide1(deckWith([card(1), connector]));
    const cardPos = xml.indexOf('name="slidewise:card"');
    const cxnPos = xml.indexOf("<p:cxnSp");
    expect(cxnPos).toBeGreaterThan(cardPos);
  });
});
