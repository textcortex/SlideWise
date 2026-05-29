import { describe, it, expect } from "vitest";
import { parsePptx, serializeDeck } from "../index";
import { CURRENT_DECK_VERSION } from "@/lib/schema/migrate";
import type { Deck } from "@/lib/types";

const baseElement = {
  rotation: 0,
  z: 1,
};

function makeDeck(slideElements: Deck["slides"][number]["elements"]): Deck {
  return {
    version: CURRENT_DECK_VERSION,
    title: "Round-trip fixture",
    slides: [
      {
        id: "slide-1",
        background: "#FFFFFF",
        elements: slideElements,
      },
    ],
  };
}

async function roundtrip(deck: Deck): Promise<Deck> {
  const blob = await serializeDeck(deck);
  const buffer = await blob.arrayBuffer();
  return parsePptx(buffer);
}

describe("pptx round-trip", () => {
  it("preserves a deck with a single text element", async () => {
    const deck = makeDeck([
      {
        ...baseElement,
        id: "t1",
        type: "text",
        x: 200,
        y: 240,
        w: 1200,
        h: 200,
        text: "Hello, Slidewise",
        fontFamily: "Inter",
        fontSize: 64,
        fontWeight: 700,
        italic: false,
        underline: false,
        strike: false,
        color: "#0E1330",
        align: "left",
        vAlign: "top",
        lineHeight: 1.2,
        letterSpacing: 0,
      },
    ]);

    const out = await roundtrip(deck);
    expect(out.slides.length).toBe(1);
    expect(out.slides[0].elements.length).toBeGreaterThanOrEqual(1);
    const text = out.slides[0].elements.find((e) => e.type === "text");
    expect(text).toBeTruthy();
    if (text && text.type === "text") {
      expect(text.text).toBe("Hello, Slidewise");
      expect(text.fontWeight).toBeGreaterThanOrEqual(600);
      expect(text.color.toUpperCase()).toBe("#0E1330");
      // Position survives within rounding tolerance (1 px).
      expect(Math.abs(text.x - 200)).toBeLessThanOrEqual(2);
      expect(Math.abs(text.y - 240)).toBeLessThanOrEqual(2);
    }
  });

  it("preserves shape kind, position, and fill", async () => {
    const deck = makeDeck([
      {
        ...baseElement,
        id: "s1",
        type: "shape",
        x: 100,
        y: 100,
        w: 400,
        h: 300,
        shape: "rounded",
        fill: "#4F5BD5",
        radius: 24,
      },
      {
        ...baseElement,
        id: "s2",
        type: "shape",
        x: 600,
        y: 100,
        w: 300,
        h: 300,
        shape: "circle",
        fill: "#F2B544",
      },
    ]);

    const out = await roundtrip(deck);
    const shapes = out.slides[0].elements.filter((e) => e.type === "shape");
    expect(shapes.length).toBe(2);
    const rounded = shapes.find((e) => e.type === "shape" && e.shape === "rounded");
    const circle = shapes.find((e) => e.type === "shape" && e.shape === "circle");
    expect(rounded).toBeTruthy();
    expect(circle).toBeTruthy();
    if (rounded && rounded.type === "shape") {
      expect(rounded.fill.toUpperCase()).toBe("#4F5BD5");
      expect(Math.abs(rounded.w - 400)).toBeLessThanOrEqual(2);
      expect(Math.abs(rounded.h - 300)).toBeLessThanOrEqual(2);
    }
  });

  it("preserves a group (with custGeom + radial-gradient children) as a GroupElement", async () => {
    const deck = makeDeck([
      {
        ...baseElement,
        id: "grp",
        type: "group",
        x: 200,
        y: 150,
        w: 800,
        h: 400,
        children: [
          {
            ...baseElement,
            id: "logo",
            type: "shape",
            x: 200,
            y: 150,
            w: 300,
            h: 300,
            shape: "rect",
            fill: "#222222",
            // Custom vector geometry (a triangle) — must survive grouping.
            path: {
              d: "M 0 100 L 50 0 L 100 100 Z",
              viewW: 100,
              viewH: 100,
            },
          },
          {
            ...baseElement,
            id: "panel",
            type: "shape",
            x: 600,
            y: 150,
            w: 350,
            h: 300,
            shape: "circle",
            fill: "radial-gradient(circle at 50% 50%, #FF0000 0%, #0000FF 100%)",
          },
        ],
      },
    ]);

    const out = await roundtrip(deck);
    const group = out.slides[0].elements.find((e) => e.type === "group");
    expect(group).toBeTruthy();
    if (!group || group.type !== "group") return;
    // The group survived as a group rather than being flattened to loose shapes.
    expect(group.children.length).toBe(2);
    // Group bounding box maps back onto the slide.
    expect(Math.abs(group.x - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(group.y - 150)).toBeLessThanOrEqual(2);

    const logo = group.children.find(
      (c) => c.type === "shape" && c.path
    );
    expect(logo).toBeTruthy();
    if (logo && logo.type === "shape") {
      // custGeom path round-tripped (commands preserved, even if reformatted).
      expect(logo.path?.d).toMatch(/[ML]/);
    }

    const panel = group.children.find(
      (c) => c.type === "shape" && c.fill.startsWith("radial-gradient(")
    );
    expect(panel).toBeTruthy();
    if (panel && panel.type === "shape") {
      expect(panel.fill).toContain("radial-gradient(");
      expect(panel.fill.toUpperCase()).toContain("#FF0000");
      expect(panel.fill.toUpperCase()).toContain("#0000FF");
    }
  });

  it("re-synthesises a group (keeping custGeom + radial) after a child is edited", async () => {
    const deck = makeDeck([
      {
        ...baseElement,
        id: "grp",
        type: "group",
        x: 200,
        y: 150,
        w: 800,
        h: 400,
        children: [
          {
            ...baseElement,
            id: "logo",
            type: "shape",
            x: 200,
            y: 150,
            w: 300,
            h: 300,
            shape: "rect",
            fill: "#222222",
            path: { d: "M 0 100 L 50 0 L 100 100 Z", viewW: 100, viewH: 100 },
          },
          {
            ...baseElement,
            id: "panel",
            type: "shape",
            x: 600,
            y: 150,
            w: 350,
            h: 300,
            shape: "circle",
            fill: "radial-gradient(circle at 50% 50%, #FF0000 0%, #0000FF 100%)",
          },
        ],
      },
    ]);

    // First round-trip registers the imported group's source XML.
    const imported = await roundtrip(deck);
    const group = imported.slides[0].elements.find((e) => e.type === "group");
    expect(group && group.type === "group").toBe(true);
    if (!group || group.type !== "group") return;

    // Edit a child → the group diverges from its snapshot, so the writer must
    // take the synth path rather than replaying the (now stale) source XML.
    const panel = group.children.find((c) => c.id && c.type === "shape" && c.fill.startsWith("radial-gradient("));
    if (panel) panel.x += 40;

    const edited = await roundtrip(imported);
    const group2 = edited.slides[0].elements.find((e) => e.type === "group");
    expect(group2 && group2.type === "group").toBe(true);
    if (!group2 || group2.type !== "group") return;
    expect(group2.children.length).toBe(2);
    expect(
      group2.children.some((c) => c.type === "shape" && c.path)
    ).toBe(true);
    expect(
      group2.children.some(
        (c) => c.type === "shape" && c.fill.startsWith("radial-gradient(")
      )
    ).toBe(true);
  });

  it("preserves slide background colour", async () => {
    const deck: Deck = {
      version: CURRENT_DECK_VERSION,
      title: "Bg",
      slides: [
        { id: "s", background: "#FAEEDC", elements: [] },
        { id: "s2", background: "#0E1330", elements: [] },
      ],
    };
    const out = await roundtrip(deck);
    expect(out.slides.length).toBe(2);
    expect(out.slides[0].background.toUpperCase()).toBe("#FAEEDC");
    expect(out.slides[1].background.toUpperCase()).toBe("#0E1330");
  });

  it("preserves multiple slides with mixed elements", async () => {
    const deck: Deck = {
      version: CURRENT_DECK_VERSION,
      title: "Multi",
      slides: [
        {
          id: "s1",
          background: "#FFFFFF",
          elements: [
            {
              ...baseElement,
              id: "t",
              type: "text",
              x: 80,
              y: 80,
              w: 1200,
              h: 100,
              text: "Slide one",
              fontFamily: "Inter",
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
            },
          ],
        },
        {
          id: "s2",
          background: "#0E1330",
          elements: [
            {
              ...baseElement,
              id: "sh",
              type: "shape",
              x: 200,
              y: 200,
              w: 400,
              h: 400,
              shape: "rect",
              fill: "#FFFFFF",
            },
          ],
        },
      ],
    };
    const out = await roundtrip(deck);
    expect(out.slides.length).toBe(2);
    expect(
      out.slides[0].elements.find((e) => e.type === "text")
    ).toBeTruthy();
    expect(
      out.slides[1].elements.find((e) => e.type === "shape")
    ).toBeTruthy();
  });

  it("preserves the deck title", async () => {
    const deck = makeDeck([]);
    deck.title = "My Wonderful Deck";
    const out = await roundtrip(deck);
    expect(out.title).toBe("My Wonderful Deck");
  });

  it("round-trips multi-color text via runs[]", async () => {
    const deck = makeDeck([
      {
        ...baseElement,
        id: "t1",
        type: "text",
        x: 100,
        y: 100,
        w: 1500,
        h: 220,
        text: "ELDORAUI",
        fontFamily: "Inter",
        fontSize: 120,
        fontWeight: 700,
        italic: false,
        underline: false,
        strike: false,
        color: "#FFFFFF",
        align: "left",
        vAlign: "top",
        lineHeight: 1,
        letterSpacing: 0,
        runs: [
          { text: "ELDORA", color: "#FFFFFF" },
          { text: "UI", color: "#0F1B3D" },
        ],
      },
    ]);

    const out = await roundtrip(deck);
    const text = out.slides[0].elements.find((e) => e.type === "text");
    expect(text?.type).toBe("text");
    if (text?.type !== "text") return;
    // Concatenated text survives
    expect(text.text.replace(/\s+/g, "")).toBe("ELDORAUI");
    // The two distinct colors come back as separate runs
    expect(text.runs).toBeTruthy();
    expect(text.runs!.length).toBeGreaterThanOrEqual(2);
    const colors = (text.runs ?? [])
      .map((r) => (r.color ?? "").toUpperCase())
      .filter(Boolean);
    expect(colors).toContain("#FFFFFF");
    expect(colors).toContain("#0F1B3D");
  });

  it("preserves UnknownElement OOXML and its rels across a round-trip", async () => {
    // Build a deck with a single hand-crafted UnknownElement carrying a raw
    // OOXML fragment that references rId7. parsePptx then attaches a fake
    // source archive providing that rId; serializeDeck has to renumber the
    // rId, write the matching <Relationship>, and copy the referenced
    // media into the output zip so the fragment resolves on re-parse.
    const JSZip = (await import("jszip")).default;
    const sourceZip = new JSZip();
    sourceZip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
    );
    sourceZip.file(
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
    );
    sourceZip.file(
      "ppt/_rels/presentation.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`
    );
    sourceZip.file(
      "ppt/presentation.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`
    );
    sourceZip.file(
      "ppt/slides/slide1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="rId7"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`
    );
    sourceZip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/preserved.png"/></Relationships>`
    );
    // Smallest valid PNG (1×1 transparent) so JSZip + serializer have real
    // bytes to copy.
    const onePxPng = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    sourceZip.file("ppt/media/preserved.png", onePxPng);

    const sourceBuffer = await sourceZip.generateAsync({ type: "arraybuffer" });
    const parsed = await parsePptx(sourceBuffer);
    const unknowns = parsed.slides[0].elements.filter(
      (e) => e.type === "unknown"
    );
    expect(unknowns.length).toBe(1);
    expect((unknowns[0] as { ooxmlXml: string }).ooxmlXml).toContain(
      "diagram"
    );
    expect((unknowns[0] as { ooxmlXml: string }).ooxmlXml).toMatch(
      /r:dm="rId7"/
    );

    const blob = await serializeDeck(parsed);
    const out = await blob.arrayBuffer();
    const reZip = await JSZip.loadAsync(out);
    // The preserved diagram fragment landed in the generated slide1 xml.
    const slide1 = await reZip.file("ppt/slides/slide1.xml")?.async("string");
    expect(slide1).toContain("dgm:relIds");
    // The original rId7 was renumbered; the slide rels now expose the new
    // rId pointing at a preserved-prefixed media path.
    const slide1Rels = await reZip
      .file("ppt/slides/_rels/slide1.xml.rels")
      ?.async("string");
    expect(slide1Rels).toMatch(/slidewise_preserved_\d+_preserved\.png/);
    // The actual PNG bytes were copied into the output archive.
    const preservedFiles = Object.keys(reZip.files).filter((p) =>
      /slidewise_preserved_\d+_preserved\.png$/.test(p)
    );
    expect(preservedFiles.length).toBe(1);
  });
});
