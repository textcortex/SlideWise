import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { serializeDeck } from "../index";
import { CURRENT_DECK_VERSION } from "@/lib/schema/migrate";
import type { Deck, ConnectorElement } from "@/lib/types";

/**
 * F3: a first-class connector element serialises to a real `<p:cxnSp>` with
 * the right preset geometry, arrowheads, dash, and flip — so process / timeline
 * arrows are editable connectors in PowerPoint, not anonymous shapes.
 */

function deckWith(connector: ConnectorElement): Deck {
  return {
    version: CURRENT_DECK_VERSION,
    title: "Connector",
    slides: [{ id: "s1", background: "#FFFFFF", elements: [connector] }],
  };
}

async function slide1(deck: Deck): Promise<string> {
  const blob = await serializeDeck(deck);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
}

const base: ConnectorElement = {
  id: "c1",
  type: "connector",
  x: 100,
  y: 100,
  w: 300,
  h: 200,
  rotation: 0,
  z: 1,
  kind: "bent",
  stroke: "#FF0000",
  strokeWidth: 3,
  dashType: "dash",
  endArrow: "triangle",
  flipH: true,
};

describe("F3: connector primitive", () => {
  it("emits a <p:cxnSp> with preset geometry, arrowhead, dash, and flip", async () => {
    const xml = await slide1(deckWith(base));
    expect(xml).toContain("<p:cxnSp>");
    expect(xml).toContain('prst="bentConnector3"');
    expect(xml).toContain('flipH="1"');
    expect(xml).toContain('<a:tailEnd type="triangle"/>');
    expect(xml).not.toContain("<a:headEnd"); // startArrow unset → no head
    expect(xml).toContain('<a:prstDash val="dash"/>');
    expect(xml).toContain('val="FF0000"');
    // Positioned at 100px,100px → EMU.
    expect(xml).toContain('x="635000"');
  });

  it("maps each connector kind to its OOXML preset", async () => {
    const straight = await slide1(deckWith({ ...base, kind: "straight" }));
    expect(straight).toContain('prst="straightConnector1"');
    const curved = await slide1(deckWith({ ...base, kind: "curved" }));
    expect(curved).toContain('prst="curvedConnector3"');
  });

  it("emits both arrowheads when set", async () => {
    const xml = await slide1(
      deckWith({ ...base, startArrow: "stealth", endArrow: "triangle" })
    );
    expect(xml).toContain('<a:headEnd type="stealth"/>');
    expect(xml).toContain('<a:tailEnd type="triangle"/>');
  });
});
