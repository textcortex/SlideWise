import { describe, it, expect } from "vitest";
import { parsePptx, serializeDeck } from "../index";
import type { Deck } from "@/lib/types";

const baseElement = {
  rotation: 0,
  z: 1,
};

function makeDeck(slideElements: Deck["slides"][number]["elements"]): Deck {
  return {
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
        text: "Hello, Caracas",
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
      expect(text.text).toBe("Hello, Caracas");
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

  it("preserves slide background colour", async () => {
    const deck: Deck = {
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
});
