import { describe, it, expect } from "vitest";
import { migrate, CURRENT_DECK_VERSION } from "../migrate";

describe("schema/migrate", () => {
  it("stamps the current version on an unversioned (v0) deck", () => {
    const v0 = {
      title: "Pre-versioning deck",
      slides: [{ id: "s1", background: "#FFFFFF", elements: [] }],
    };
    const out = migrate(v0);
    expect(out.version).toBe(CURRENT_DECK_VERSION);
    expect(out.title).toBe("Pre-versioning deck");
    expect(out.slides).toHaveLength(1);
  });

  it("passes a current-version deck through unchanged in shape", () => {
    const current = {
      version: CURRENT_DECK_VERSION,
      title: "Current",
      slides: [{ id: "s1", background: "#FFFFFF", elements: [] }],
    };
    const out = migrate(current);
    expect(out.version).toBe(CURRENT_DECK_VERSION);
    expect(out.title).toBe("Current");
    expect(out.slides[0].id).toBe("s1");
  });

  it("throws on a deck written by a newer Slidewise", () => {
    const future = {
      version: CURRENT_DECK_VERSION + 5,
      title: "From the future",
      slides: [],
    };
    expect(() => migrate(future)).toThrow(/newer than this build/);
  });

  it("rejects non-object input", () => {
    expect(() => migrate(null)).toThrow();
    expect(() => migrate("not a deck")).toThrow();
    expect(() => migrate(42)).toThrow();
  });

  it("rejects a deck whose slides is not an array", () => {
    expect(() => migrate({ title: "x", slides: "nope" })).toThrow(
      /slides is not an array/
    );
  });

  it("rejects a deck with an invalid version field", () => {
    expect(() =>
      migrate({ version: -1, title: "x", slides: [] })
    ).toThrow(/non-negative integer/);
    expect(() =>
      migrate({ version: 1.5, title: "x", slides: [] })
    ).toThrow(/non-negative integer/);
    expect(() =>
      migrate({ version: "1", title: "x", slides: [] })
    ).toThrow(/non-negative integer/);
  });

  it("does not mutate the input deck", () => {
    const v0 = {
      title: "Original",
      slides: [{ id: "s1", background: "#FFFFFF", elements: [] }],
    };
    const before = JSON.stringify(v0);
    migrate(v0);
    expect(JSON.stringify(v0)).toBe(before);
  });
});
