import { describe, it, expect } from "vitest";
import { summarizeLayouts } from "../layouts";
import { CURRENT_DECK_VERSION } from "../schema/migrate";
import type { Deck, DeckLayout } from "../types";

/**
 * 1c: `summarizeLayouts` compact + dedupe — what makes an 85-layout template
 * usable inside a host's tight model-context budget.
 */

function ph(type: string, idx?: number) {
  return {
    type,
    ...(idx != null ? { idx } : {}),
    x: 0,
    y: 0,
    w: 100,
    h: 50,
  };
}

function layout(id: string, type: string, placeholders: DeckLayout["placeholders"]): DeckLayout {
  return { id, type, placeholders, sourcePath: `ppt/slideLayouts/${id}.xml` };
}

function deckWith(layouts: DeckLayout[]): Deck {
  return { version: CURRENT_DECK_VERSION, title: "t", slides: [], layouts };
}

describe("summarizeLayouts options", () => {
  const deck = deckWith([
    layout("slideLayout1", "obj", [ph("title"), ph("body", 1)]),
    layout("slideLayout2", "obj", [ph("title"), ph("body", 1)]), // dup of 1
    layout("slideLayout3", "title", [ph("ctrTitle"), ph("subTitle", 1)]),
  ]);

  it("returns full per-placeholder geometry by default", () => {
    const full = summarizeLayouts(deck);
    expect(full).toHaveLength(3);
    expect(full[0].placeholders).toHaveLength(2);
    expect(full[0].placeholders[0]).toMatchObject({ key: "title", x: 0, w: 100 });
    expect(full[0].type).toBe("obj");
    expect(full[0].fillable).toEqual(["title", "body:1"]);
  });

  it("compact drops geometry + type for a budget-friendly menu", () => {
    const compact = summarizeLayouts(deck, { compact: true });
    expect(compact[0].placeholders).toEqual([]);
    expect(compact[0].type).toBeUndefined();
    // Keeps the model-meaningful selectors.
    expect(compact[0]).toMatchObject({
      id: "slideLayout1",
      role: "Title and content",
      fillable: ["title", "body:1"],
    });
  });

  it("dedupe collapses same role + fillable signature, recording aliases", () => {
    const deduped = summarizeLayouts(deck, { dedupe: true });
    // slideLayout1 & slideLayout2 are identical kinds → one representative.
    expect(deduped).toHaveLength(2);
    const obj = deduped.find((l) => l.id === "slideLayout1")!;
    expect(obj.aliases).toEqual(["slideLayout2"]);
    // The distinct "Title slide" layout stays on its own, no aliases.
    const title = deduped.find((l) => l.role === "Title slide")!;
    expect(title.id).toBe("slideLayout3");
    expect(title.aliases).toBeUndefined();
  });

  it("dedupe does NOT collapse layouts that differ in a non-text slot", () => {
    // Same text slots (title + body:1), but one also has a chart placeholder.
    // A host placing a native chart must keep the chart-bearing variant.
    const deck2 = deckWith([
      layout("slideLayout1", "obj", [ph("title"), ph("body", 1)]),
      layout("slideLayout2", "obj", [ph("title"), ph("body", 1), ph("chart", 2)]),
    ]);
    const deduped = summarizeLayouts(deck2, { dedupe: true });
    // Distinct slot inventories → both survive, neither aliases the other.
    expect(deduped).toHaveLength(2);
    expect(deduped.map((l) => l.id)).toEqual(["slideLayout1", "slideLayout2"]);
    expect(deduped.every((l) => l.aliases === undefined)).toBe(true);
    // The chart-bearing variant still exposes its chart slot geometry.
    const chartLayout = deduped.find((l) => l.id === "slideLayout2")!;
    expect(
      chartLayout.placeholders.some((p) => p.category === "chart")
    ).toBe(true);
  });

  it("compact + dedupe compose", () => {
    const out = summarizeLayouts(deck, { compact: true, dedupe: true });
    expect(out).toHaveLength(2);
    expect(out[0].placeholders).toEqual([]);
    expect(out[0].aliases).toEqual(["slideLayout2"]);
  });

  it("returns [] for a deck with no layouts", () => {
    expect(summarizeLayouts(deckWith([]))).toEqual([]);
    expect(summarizeLayouts({ ...deckWith([]), layouts: undefined })).toEqual([]);
  });
});
