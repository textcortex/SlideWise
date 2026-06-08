import { describe, it, expect } from "vitest";
import { collectFontUsage, buildGoogleFontsHref } from "../fonts";
import { CURRENT_DECK_VERSION } from "@/lib/schema/migrate";
import type { Deck, TextElement } from "@/lib/types";

function textEl(
  id: string,
  fontFamily: string,
  fontWeight: number,
  runs?: TextElement["runs"]
): TextElement {
  return {
    id,
    type: "text",
    rotation: 0,
    z: 1,
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    text: "x",
    fontFamily,
    fontSize: 24,
    fontWeight,
    italic: false,
    underline: false,
    strike: false,
    color: "#000000",
    align: "left",
    vAlign: "top",
    lineHeight: 1.2,
    letterSpacing: 0,
    ...(runs ? { runs } : {}),
  };
}

function deckOf(elements: Deck["slides"][number]["elements"]): Deck {
  return {
    version: CURRENT_DECK_VERSION,
    title: "Font fixture",
    slides: [{ id: "s1", background: "#FFFFFF", elements }],
  };
}

describe("font weight loading", () => {
  it("collects the actual weights used per family", () => {
    const usage = collectFontUsage(
      deckOf([
        textEl("a", "Montserrat", 700),
        textEl("b", "Open Sans", 400),
      ])
    );
    expect([...(usage.get("Montserrat") ?? [])].sort()).toEqual([700]);
    expect([...(usage.get("Open Sans") ?? [])].sort()).toEqual([400]);
  });

  it("collects per-run weights and recurses into groups", () => {
    const grouped: Deck["slides"][number]["elements"] = [
      {
        id: "g",
        type: "group",
        rotation: 0,
        z: 1,
        x: 0,
        y: 0,
        w: 100,
        h: 100,
        children: [
          textEl("t", "Montserrat", 400, [
            { text: "GLA", fontFamily: "Montserrat", fontWeight: 700 },
            { text: "NCE", fontFamily: "Montserrat", fontWeight: 700 },
          ]),
        ],
      } as unknown as Deck["slides"][number]["elements"][number],
    ];
    const usage = collectFontUsage(deckOf(grouped));
    expect([...(usage.get("Montserrat") ?? [])].sort((a, b) => a - b)).toEqual([
      400, 700,
    ]);
  });

  it("requests the real bold face from Google Fonts (not just 400)", () => {
    const usage = collectFontUsage(deckOf([textEl("a", "Montserrat", 700)]));
    const href = buildGoogleFontsHref(usage);
    expect(href).toBeTruthy();
    // The bug was a bare `family=Montserrat` (regular only); the fix asks for
    // the bold weight too, with 400 kept as the base.
    expect(href).toContain("family=Montserrat:wght@400;700");
    expect(href).not.toMatch(/family=Montserrat(?![:])/);
  });

  it("skips system families and applies exclusions", () => {
    const usage = collectFontUsage(
      deckOf([textEl("a", "Inter", 400), textEl("b", "Montserrat", 700)])
    );
    const href = buildGoogleFontsHref(usage, new Set(["montserrat"]));
    // Inter is a system family; Montserrat is excluded → nothing to fetch.
    expect(href).toBeNull();
  });
});
