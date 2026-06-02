import { describe, it, expect } from "vitest";
import { splitFamilyWeight } from "../fonts";

describe("splitFamilyWeight", () => {
  it("maps weight-named families to base + numeric weight", () => {
    expect(splitFamilyWeight("Montserrat Bold")).toEqual({ base: "Montserrat", weight: 700 });
    expect(splitFamilyWeight("Montserrat Semi-Bold")).toEqual({ base: "Montserrat", weight: 600 });
    expect(splitFamilyWeight("Montserrat SemiBold")).toEqual({ base: "Montserrat", weight: 600 });
    expect(splitFamilyWeight("Open Sans Light")).toEqual({ base: "Open Sans", weight: 300 });
    expect(splitFamilyWeight("Roboto Medium")).toEqual({ base: "Roboto", weight: 500 });
    expect(splitFamilyWeight("Inter Extra Bold")).toEqual({ base: "Inter", weight: 800 });
    expect(splitFamilyWeight("Inter Black")).toEqual({ base: "Inter", weight: 900 });
    expect(splitFamilyWeight("Lato Thin")).toEqual({ base: "Lato", weight: 100 });
  });

  it("prefers the most specific suffix (Semi/Extra Bold over Bold)", () => {
    // A bare "...Bold" rule must not strip "Semi-Bold" down to "...Semi".
    expect(splitFamilyWeight("Helvetica Neue Semibold")).toEqual({
      base: "Helvetica Neue",
      weight: 600,
    });
  });

  it("returns null when there is no weight suffix", () => {
    expect(splitFamilyWeight("DM Serif Display")).toBeNull();
    expect(splitFamilyWeight("Montserrat")).toBeNull();
    expect(splitFamilyWeight("Arial")).toBeNull();
    // Must not strip a weight word that is the whole name / leaves nothing.
    expect(splitFamilyWeight("Bold")).toBeNull();
  });
});
