// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ElementView } from "../ElementView";
import type { ShapeElement } from "@/lib/types";

const base = { rotation: 0, z: 1 };

afterEach(cleanup);

describe("ShapeView gradient fills on vector shapes", () => {
  it("renders a custGeom path with a radial fill via an SVG paint server", () => {
    const el: ShapeElement = {
      ...base,
      id: "logo",
      type: "shape",
      x: 0,
      y: 0,
      w: 200,
      h: 200,
      shape: "rect",
      fill: "radial-gradient(circle at 50.00% 50.00%, #FF0000 0.00%, #0000FF 100.00%)",
      path: { d: "M 0 0 L 100 0 L 100 100 Z", viewW: 100, viewH: 100 },
    };
    const { container } = render(<ElementView el={el} />);
    // The path must NOT carry the raw CSS gradient string (invalid SVG fill →
    // blank). It must reference a generated <radialGradient> paint server.
    const path = container.querySelector("path");
    expect(path).toBeTruthy();
    const fill = path?.getAttribute("fill") ?? "";
    expect(fill.startsWith("url(#")).toBe(true);
    const radial = container.querySelector("radialGradient");
    expect(radial).toBeTruthy();
    // Two stops, with the 8-digit-free colours.
    const stops = container.querySelectorAll("stop");
    expect(stops.length).toBe(2);
    expect(stops[0].getAttribute("stop-color")?.toUpperCase()).toBe("#FF0000");
    expect(stops[1].getAttribute("stop-color")?.toUpperCase()).toBe("#0000FF");
  });

  it("splits #RRGGBBAA stops into colour + opacity", () => {
    const el: ShapeElement = {
      ...base,
      id: "tri",
      type: "shape",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      shape: "triangle",
      fill: "linear-gradient(90deg, #FF000080 0%, #00FF00 100%)",
    };
    const { container } = render(<ElementView el={el} />);
    const poly = container.querySelector("polygon");
    expect(poly?.getAttribute("fill")?.startsWith("url(#")).toBe(true);
    const stops = container.querySelectorAll("stop");
    expect(stops[0].getAttribute("stop-color")?.toUpperCase()).toBe("#FF0000");
    // 0x80 / 255 ≈ 0.502
    expect(Number(stops[0].getAttribute("stop-opacity"))).toBeCloseTo(0.502, 2);
  });

  it("passes a solid fill through unchanged (no paint server)", () => {
    const el: ShapeElement = {
      ...base,
      id: "s",
      type: "shape",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      shape: "rect",
      fill: "#123456",
      path: { d: "M 0 0 L 100 0 L 100 100 Z", viewW: 100, viewH: 100 },
    };
    const { container } = render(<ElementView el={el} />);
    expect(container.querySelector("path")?.getAttribute("fill")).toBe("#123456");
    expect(container.querySelector("radialGradient")).toBeNull();
    expect(container.querySelector("linearGradient")).toBeNull();
  });
});
