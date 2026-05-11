import { describe, it, expect } from "vitest";
import { createEditorStore } from "../store";
import { CURRENT_DECK_VERSION } from "../schema/migrate";
import type { Deck } from "../types";

function makeDeck(slideCount = 3): Deck {
  return {
    version: CURRENT_DECK_VERSION,
    title: "fixture",
    slides: Array.from({ length: slideCount }, (_, i) => ({
      id: `s${i + 1}`,
      background: "#FFFFFF",
      elements: [],
    })),
  };
}

describe("store: zoom actions", () => {
  it("zoomIn multiplies the current zoom by 1.25 (clamped to 4)", () => {
    const store = createEditorStore(makeDeck());
    store.getState().setZoom(1);
    store.getState().zoomIn();
    expect(store.getState().zoom).toBeCloseTo(1.25);
  });

  it("zoomOut multiplies by 0.8 (clamped to 0.1)", () => {
    const store = createEditorStore(makeDeck());
    store.getState().setZoom(1);
    store.getState().zoomOut();
    expect(store.getState().zoom).toBeCloseTo(0.8);
  });

  it("setZoom clamps the zoom to the valid range", () => {
    const store = createEditorStore(makeDeck());
    store.getState().setZoom(999);
    expect(store.getState().zoom).toBe(4);
    store.getState().setZoom(0);
    expect(store.getState().zoom).toBe(0.1);
  });
});

describe("store: slide CRUD return ids", () => {
  it("addSlide returns the new slide's id and inserts after the target", () => {
    const store = createEditorStore(makeDeck(2));
    const newId = store.getState().addSlide("s1");
    expect(typeof newId).toBe("string");
    const slides = store.getState().deck.slides;
    expect(slides).toHaveLength(3);
    expect(slides[1].id).toBe(newId);
    expect(store.getState().currentSlideId).toBe(newId);
  });

  it("addSlide() with no afterId appends at the end", () => {
    const store = createEditorStore(makeDeck(2));
    const newId = store.getState().addSlide();
    expect(store.getState().deck.slides[2].id).toBe(newId);
  });

  it("duplicateSlide returns the new slide id and inserts after the original", () => {
    const store = createEditorStore(makeDeck(2));
    const copyId = store.getState().duplicateSlide("s1");
    expect(typeof copyId).toBe("string");
    expect(copyId).not.toBe("s1");
    const slides = store.getState().deck.slides;
    expect(slides).toHaveLength(3);
    expect(slides[1].id).toBe(copyId);
  });

  it("duplicateSlide returns null when slide id is not found", () => {
    const store = createEditorStore(makeDeck(2));
    expect(store.getState().duplicateSlide("does-not-exist")).toBeNull();
    expect(store.getState().deck.slides).toHaveLength(2);
  });
});
