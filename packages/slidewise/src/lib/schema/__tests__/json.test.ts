import { describe, it, expect } from "vitest";
import { resolveJsonDeck } from "../json";
import { CURRENT_DECK_VERSION } from "../migrate";

describe("schema/json.resolveJsonDeck", () => {
  it("accepts a parsed Deck object and stamps the current version", () => {
    const out = resolveJsonDeck({
      title: "From AI",
      slides: [{ id: "s1", background: "#FFFFFF", elements: [] }],
    } as never);
    expect(out.version).toBe(CURRENT_DECK_VERSION);
    expect(out.title).toBe("From AI");
    expect(out.slides).toHaveLength(1);
  });

  it("accepts a JSON string", () => {
    const json = JSON.stringify({
      version: CURRENT_DECK_VERSION,
      title: "Stringified",
      slides: [{ id: "s1", background: "#000", elements: [] }],
    });
    const out = resolveJsonDeck(json);
    expect(out.title).toBe("Stringified");
    expect(out.slides[0].id).toBe("s1");
  });

  it("throws on malformed JSON strings", () => {
    expect(() => resolveJsonDeck("{ not valid")).toThrow();
  });

  it("rejects decks from a newer schema", () => {
    const json = JSON.stringify({
      version: CURRENT_DECK_VERSION + 1,
      title: "Future",
      slides: [],
    });
    expect(() => resolveJsonDeck(json)).toThrow(/newer than this build/);
  });
});
