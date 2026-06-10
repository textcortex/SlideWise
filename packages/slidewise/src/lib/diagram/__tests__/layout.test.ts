import { describe, it, expect } from "vitest";
import { layoutDiagram } from "../layout";
import type { DiagramElement, DiagramKind } from "@/lib/types";

function diagram(kind: DiagramKind, count: number): DiagramElement {
  return {
    id: "d1",
    type: "diagram",
    x: 100,
    y: 80,
    w: 1000,
    h: 400,
    rotation: 0,
    z: 1,
    kind,
    nodes: Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      text: `Step ${i + 1}`,
    })),
  };
}

function boxes(kind: DiagramKind, count: number) {
  return layoutDiagram(diagram(kind, count)).filter((p) => p.kind === "box");
}
function arrows(kind: DiagramKind, count: number) {
  return layoutDiagram(diagram(kind, count)).filter((p) => p.kind === "arrow");
}

describe("layoutDiagram", () => {
  it("returns [] for a diagram with no nodes", () => {
    expect(layoutDiagram(diagram("process", 0))).toEqual([]);
  });

  it("process: one box per node + connecting arrows between them", () => {
    expect(boxes("process", 4)).toHaveLength(4);
    expect(arrows("process", 4)).toHaveLength(3);
  });

  it("keeps every box inside the element's local bounds", () => {
    for (const p of boxes("process", 5)) {
      if (p.kind !== "box") continue;
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(1000 + 1);
      expect(p.y + p.h).toBeLessThanOrEqual(400 + 1);
    }
  });

  it("is deterministic (renderer and writer must agree)", () => {
    const a = layoutDiagram(diagram("cycle", 5));
    const b = layoutDiagram(diagram("cycle", 5));
    expect(a).toEqual(b);
  });

  it("funnel: bars narrow toward the bottom", () => {
    const bs = boxes("funnel", 4);
    const widths = bs.map((p) => (p.kind === "box" ? p.w : 0));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThan(widths[i - 1]);
    }
  });

  it("matrix: lays N nodes into a near-square grid within bounds", () => {
    const bs = boxes("matrix", 4);
    expect(bs).toHaveLength(4);
    // 4 → 2×2; two distinct columns, two distinct rows.
    const xs = new Set(bs.map((p) => (p.kind === "box" ? p.x : 0)));
    const ys = new Set(bs.map((p) => (p.kind === "box" ? p.y : 0)));
    expect(xs.size).toBe(2);
    expect(ys.size).toBe(2);
  });

  it("cycle: an arrow between every consecutive node (and a closing one)", () => {
    expect(arrows("cycle", 5)).toHaveLength(5);
  });

  it("timeline: a non-arrow spine plus one box per node", () => {
    const prims = layoutDiagram(diagram("timeline", 3));
    expect(prims.filter((p) => p.kind === "box")).toHaveLength(3);
    const spine = prims.find((p) => p.kind === "arrow");
    expect(spine).toBeTruthy();
    expect(spine!.kind === "arrow" && spine!.arrow).toBe(false);
  });

  it("uses per-node fill/color overrides when present", () => {
    const el = diagram("list", 2);
    el.nodes[0].fill = "#123456";
    el.nodes[0].color = "#abcdef";
    const first = layoutDiagram(el).find((p) => p.kind === "box");
    expect(first!.kind === "box" && first!.fill).toBe("#123456");
    expect(first!.kind === "box" && first!.textColor).toBe("#abcdef");
  });
});
