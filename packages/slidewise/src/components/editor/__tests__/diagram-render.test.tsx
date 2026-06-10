import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ElementView } from "../ElementView";
import type { DiagramElement } from "@/lib/types";

/**
 * P3 renderer: a diagram renders its node labels as positioned boxes (and
 * arrows as an SVG overlay) using the same `layoutDiagram` the writer uses —
 * so it shows on the canvas / host preview instead of an empty box.
 */

const process: DiagramElement = {
  id: "d1",
  type: "diagram",
  x: 0,
  y: 0,
  w: 900,
  h: 300,
  rotation: 0,
  z: 1,
  kind: "process",
  nodes: [
    { id: "n0", text: "Alpha" },
    { id: "n1", text: "Beta" },
    { id: "n2", text: "Gamma" },
  ],
};

describe("P3: diagram renderer", () => {
  it("renders a labelled box per node and an arrow overlay", () => {
    const html = renderToStaticMarkup(<ElementView el={process} />);
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
    expect(html).toContain("Gamma");
    // Arrows between boxes → an SVG with a marker + lines.
    expect(html).toContain("<svg");
    expect(html).toContain("<line");
    expect(html).toContain("<marker");
  });

  it("renders a matrix without arrows", () => {
    const html = renderToStaticMarkup(
      <ElementView
        el={{
          ...process,
          kind: "matrix",
          nodes: [
            { id: "a", text: "Q1" },
            { id: "b", text: "Q2" },
            { id: "c", text: "Q3" },
            { id: "d", text: "Q4" },
          ],
        }}
      />
    );
    expect(html).toContain("Q1");
    expect(html).toContain("Q4");
    expect(html).not.toContain("<line");
  });
});
