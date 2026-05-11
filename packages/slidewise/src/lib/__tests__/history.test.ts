import { describe, it, expect, beforeEach, vi } from "vitest";
import { createEditorStore } from "../store";
import { CURRENT_DECK_VERSION } from "../schema/migrate";
import type { Deck } from "../types";

const baseElement = { rotation: 0, z: 1 } as const;

function fixtureDeck(): Deck {
  return {
    version: CURRENT_DECK_VERSION,
    title: "Hist test",
    slides: [
      {
        id: "s1",
        background: "#FFFFFF",
        elements: [
          {
            ...baseElement,
            id: "t1",
            type: "text",
            x: 100,
            y: 100,
            w: 400,
            h: 80,
            text: "Hello",
            fontFamily: "Inter",
            fontSize: 24,
            fontWeight: 400,
            italic: false,
            underline: false,
            strike: false,
            color: "#000000",
            align: "left",
            vAlign: "top",
            lineHeight: 1.2,
            letterSpacing: 0,
          },
        ],
      },
    ],
  };
}

describe("editor store history", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });

  it("undo reverts an updateElement", () => {
    const store = createEditorStore(fixtureDeck());
    expect(store.getState().canUndo()).toBe(false);

    store.getState().updateElement("t1", { x: 200 });
    expect(store.getState().canUndo()).toBe(true);
    const slide = () => store.getState().deck.slides[0];
    expect((slide().elements[0] as { x: number }).x).toBe(200);

    store.getState().undo();
    expect((slide().elements[0] as { x: number }).x).toBe(100);
    expect(store.getState().canUndo()).toBe(false);
    expect(store.getState().canRedo()).toBe(true);
  });

  it("undo reverts a setTitle", () => {
    const store = createEditorStore(fixtureDeck());
    store.getState().setTitle("Renamed");
    expect(store.getState().deck.title).toBe("Renamed");
    store.getState().undo();
    expect(store.getState().deck.title).toBe("Hist test");
  });

  it("coalesces a typing burst into one undo step", () => {
    const store = createEditorStore(fixtureDeck());
    // simulate keystrokes within the idle window
    store.getState().updateElement("t1", { x: 110 });
    vi.advanceTimersByTime(50);
    store.getState().updateElement("t1", { x: 120 });
    vi.advanceTimersByTime(50);
    store.getState().updateElement("t1", { x: 130 });

    expect(store.getState().history.length).toBe(1);

    store.getState().undo();
    const elX = (store.getState().deck.slides[0].elements[0] as { x: number }).x;
    expect(elX).toBe(100);
  });

  it("starts a new history step after the idle window expires", () => {
    const store = createEditorStore(fixtureDeck());
    store.getState().updateElement("t1", { x: 110 });
    expect(store.getState().history.length).toBe(1);

    // advance past the 500ms idle window
    vi.advanceTimersByTime(600);

    store.getState().updateElement("t1", { x: 120 });
    expect(store.getState().history.length).toBe(2);

    store.getState().undo();
    expect((store.getState().deck.slides[0].elements[0] as { x: number }).x).toBe(110);

    store.getState().undo();
    expect((store.getState().deck.slides[0].elements[0] as { x: number }).x).toBe(100);
  });

  it("endCoalesce starts a fresh step on the next mutation", () => {
    const store = createEditorStore(fixtureDeck());
    store.getState().updateElement("t1", { x: 110 });
    store.getState().updateElement("t1", { x: 120 });
    expect(store.getState().history.length).toBe(1);

    store.getState().endCoalesce();
    store.getState().updateElement("t1", { x: 130 });
    expect(store.getState().history.length).toBe(2);
  });

  it("different patch keys on the same element start a fresh step", () => {
    const store = createEditorStore(fixtureDeck());
    store.getState().updateElement("t1", { x: 110 });
    store.getState().updateElement("t1", { y: 110 });
    // Different keys → different coalesce key → second step pushed.
    expect(store.getState().history.length).toBe(2);
  });

  it("setDeck clears history", () => {
    const store = createEditorStore(fixtureDeck());
    store.getState().updateElement("t1", { x: 200 });
    expect(store.getState().history.length).toBe(1);

    store.getState().setDeck(fixtureDeck());
    expect(store.getState().history.length).toBe(0);
    expect(store.getState().future.length).toBe(0);
    expect(store.getState().canUndo()).toBe(false);
  });

  it("undo/redo update canUndo/canRedo correctly", () => {
    const store = createEditorStore(fixtureDeck());
    store.getState().updateElement("t1", { x: 200 });
    expect(store.getState().canUndo()).toBe(true);
    expect(store.getState().canRedo()).toBe(false);

    store.getState().undo();
    expect(store.getState().canUndo()).toBe(false);
    expect(store.getState().canRedo()).toBe(true);

    store.getState().redo();
    expect(store.getState().canUndo()).toBe(true);
    expect(store.getState().canRedo()).toBe(false);
  });

  it("undo replaces the deck reference (so subscribers see a change)", () => {
    const store = createEditorStore(fixtureDeck());
    const before = store.getState().deck;
    store.getState().updateElement("t1", { x: 200 });
    const afterEdit = store.getState().deck;
    expect(afterEdit).not.toBe(before);

    store.getState().undo();
    const afterUndo = store.getState().deck;
    expect(afterUndo).not.toBe(afterEdit);
    // value matches the pre-edit deck even if the reference is a clone
    expect((afterUndo.slides[0].elements[0] as { x: number }).x).toBe(100);
  });
});
