// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ElementView } from "../ElementView";
import type { ShapeElement } from "@/lib/types";

const base = { rotation: 0, z: 1 };
const DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";

afterEach(cleanup);

describe("ShapeView picture/SVG fills (PPTX <a:blipFill>)", () => {
  it("paints a custGeom path image fill via a clipped <image>, not an SVG path fill", () => {
    const el: ShapeElement = {
      ...base,
      id: "icon",
      type: "shape",
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      shape: "rect",
      fill: `url("${DATA_URL}")`,
      path: { d: "M 0 0 L 100 0 L 100 100 Z", viewW: 100, viewH: 100 },
    };
    const { container } = render(<ElementView el={el} />);

    // The art renders as an <image> clipped to the silhouette.
    const image = container.querySelector("image");
    expect(image).toBeTruthy();
    expect(image?.getAttribute("href")).toBe(DATA_URL);
    expect(image?.getAttribute("clip-path") ?? "").toMatch(/^url\(#/);

    const clip = container.querySelector("clipPath path");
    expect(clip?.getAttribute("d")).toBe("M 0 0 L 100 0 L 100 100 Z");

    // The url() must never be handed to an SVG path fill (invalid → blank).
    const fillPath = container.querySelector("path[fill^='url(\"']");
    expect(fillPath).toBeNull();
  });

  it("draws the silhouette stroke on top of the image when the shape is stroked", () => {
    const el: ShapeElement = {
      ...base,
      id: "icon-stroked",
      type: "shape",
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      shape: "rect",
      fill: `url("${DATA_URL}")`,
      stroke: "#FF0000",
      strokeWidth: 3,
      path: { d: "M 0 0 L 100 0 L 100 100 Z", viewW: 100, viewH: 100 },
    };
    const { container } = render(<ElementView el={el} />);
    const strokePath = container.querySelector("path[stroke='#FF0000']");
    expect(strokePath).toBeTruthy();
    expect(strokePath?.getAttribute("fill")).toBe("none");
  });

  it("fills a rect shape edge-to-edge via a non-repeating background image", () => {
    const el: ShapeElement = {
      ...base,
      id: "panel",
      type: "shape",
      x: 0,
      y: 0,
      w: 300,
      h: 100,
      shape: "rect",
      fill: `url("${DATA_URL}")`,
    };
    const { container } = render(<ElementView el={el} />);
    const div = container.querySelector("div");
    const style = div?.getAttribute("style") ?? "";
    expect(style).toContain(DATA_URL);
    expect(style).toMatch(/background-size:\s*100%\s+100%/);
    expect(style).toMatch(/background-repeat:\s*no-repeat/);
  });
});
