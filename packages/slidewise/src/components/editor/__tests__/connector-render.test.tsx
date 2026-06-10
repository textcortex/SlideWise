import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementView } from "../ElementView";
import type { ConnectorElement } from "@/lib/types";

/**
 * F3 renderer: the connector element renders to an SVG path with arrowhead
 * markers, so it shows up in the editor canvas and the host's static
 * renderToString preview (not as an empty box).
 */

const connector: ConnectorElement = {
  id: "c1",
  type: "connector",
  x: 0,
  y: 0,
  w: 200,
  h: 120,
  rotation: 0,
  z: 1,
  kind: "curved",
  stroke: "#3366CC",
  strokeWidth: 2,
  endArrow: "triangle",
};

describe("F3: connector renderer", () => {
  it("renders an SVG path with an end arrowhead marker", () => {
    const html = renderToStaticMarkup(<ElementView el={connector} />);
    expect(html).toContain("<svg");
    expect(html).toContain("<path");
    // Curved kind → a cubic bezier command in the path data.
    expect(html).toContain(" C ");
    // End arrow → a marker definition + markerEnd reference.
    expect(html).toContain("<marker");
    expect(html).toContain("marker-end");
    expect(html).toContain("#3366CC");
  });

  it("omits arrowheads when none are set", () => {
    const html = renderToStaticMarkup(
      <ElementView el={{ ...connector, kind: "straight", endArrow: "none" }} />
    );
    expect(html).toContain("<path");
    expect(html).not.toContain("<marker");
  });
});
