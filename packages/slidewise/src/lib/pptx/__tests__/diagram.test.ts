import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parsePptx, serializeDeck } from "../index";
import { CURRENT_DECK_VERSION } from "@/lib/schema/migrate";
import type { Deck, DiagramElement, GroupElement } from "@/lib/types";

/**
 * P3 / F3: a first-class diagram serialises to a single labelled `<p:grpSp>` of
 * real shapes + connectors — editable & grouped in PowerPoint, not a flat pile
 * of anonymous shapes. On re-import the grouped structure round-trips as a
 * GroupElement (we don't write SmartArt metadata, so it doesn't return as a
 * DiagramElement — but it stays a cohesive, editable group).
 */

function deckWith(el: DiagramElement): Deck {
  return {
    version: CURRENT_DECK_VERSION,
    title: "Diagram",
    slides: [{ id: "s1", background: "#FFFFFF", elements: [el] }],
  };
}

const process: DiagramElement = {
  id: "d1",
  type: "diagram",
  x: 120,
  y: 200,
  w: 1600,
  h: 320,
  rotation: 0,
  z: 1,
  kind: "process",
  nodes: [
    { id: "n0", text: "Plan" },
    { id: "n1", text: "Build" },
    { id: "n2", text: "Ship" },
  ],
};

async function slide1Xml(deck: Deck): Promise<string> {
  const blob = await serializeDeck(deck);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return (await zip.file("ppt/slides/slide1.xml")?.async("string")) ?? "";
}

describe("P3: diagram primitive", () => {
  it("emits one grouped <p:grpSp> with a labelled box per node and arrows", async () => {
    const xml = await slide1Xml(deckWith(process));
    expect(xml).toContain("<p:grpSp>");
    // One labelled shape per node, with the node text.
    expect((xml.match(/<p:sp>/g) ?? []).length).toBe(3);
    expect(xml).toContain("<a:t>Plan</a:t>");
    expect(xml).toContain("<a:t>Build</a:t>");
    expect(xml).toContain("<a:t>Ship</a:t>");
    // Two connectors (between the three boxes), with an arrowhead.
    expect((xml.match(/<p:cxnSp>/g) ?? []).length).toBe(2);
    expect(xml).toContain('prst="straightConnector1"');
    expect(xml).toContain('<a:tailEnd type="triangle"/>');
    // The group frame sits at the element position (120px,200px → EMU).
    expect(xml).toContain(`x="${120 * 6350}"`);
    // Child coordinate frame is local (chOff 0,0).
    expect(xml).toContain('<a:chOff x="0" y="0"/>');
  });

  it("round-trips to an editable group carrying the node labels", async () => {
    const blob = await serializeDeck(deckWith(process));
    const reparsed = await parsePptx(await blob.arrayBuffer());
    const els = reparsed.slides[0].elements;
    const group = els.find((e): e is GroupElement => e.type === "group");
    expect(group).toBeTruthy();
    // The three labelled boxes survive as children with their text.
    const texts = JSON.stringify(group);
    expect(texts).toContain("Plan");
    expect(texts).toContain("Build");
    expect(texts).toContain("Ship");
  });

  it("matrix diagram emits a box per node and no connectors", async () => {
    const xml = await slide1Xml(
      deckWith({
        ...process,
        kind: "matrix",
        nodes: [
          { id: "a", text: "A" },
          { id: "b", text: "B" },
          { id: "c", text: "C" },
          { id: "d", text: "D" },
        ],
      })
    );
    expect((xml.match(/<p:sp>/g) ?? []).length).toBe(4);
    expect(xml).not.toContain("<p:cxnSp>");
  });
});
