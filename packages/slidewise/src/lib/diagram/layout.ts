import type { DiagramElement, DiagramNode } from "@/lib/types";

/**
 * Diagram layout — the single source of truth shared by the renderer
 * (`DiagramView`) and the PPTX writer (`synthesiseDiagram`). Given a
 * `DiagramElement`, `layoutDiagram` returns positioned primitives in the
 * diagram's LOCAL coordinate space (`0..w` × `0..h`, origin at the element's
 * top-left). The renderer draws them inside the element container as-is; the
 * writer wraps them in a `<p:grpSp>` whose child frame is `chOff=0,0`
 * `chExt=w×h`, so the same local coordinates serialise unchanged.
 *
 * Keeping one layout function means the on-canvas preview and the saved
 * grouped shape can never drift.
 */

/** A labelled box (one node) in local diagram coordinates. */
export interface DiagramBoxPrimitive {
  kind: "box";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  /** Fill (CSS hex). */
  fill: string;
  /** Label color (CSS hex). */
  textColor: string;
  /** Preset geometry the box renders/serialises with. */
  shape: "rect" | "roundRect" | "ellipse";
}

/** A straight arrow from one anchor to another, in local diagram coordinates. */
export interface DiagramArrowPrimitive {
  kind: "arrow";
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Whether the arrow carries a head at its end point. */
  arrow: boolean;
  /** Stroke (CSS hex). */
  stroke: string;
}

export type DiagramPrimitive = DiagramBoxPrimitive | DiagramArrowPrimitive;

/** Built-in accent palette, cycled when a node/diagram sets no fill. */
export const DEFAULT_DIAGRAM_PALETTE = [
  "#4472C4",
  "#ED7D31",
  "#A5A5A5",
  "#FFC000",
  "#5B9BD5",
  "#70AD47",
];

const DEFAULT_TEXT = "#FFFFFF";

interface LayoutCtx {
  el: DiagramElement;
  w: number;
  h: number;
  palette: string[];
}

function fillFor(ctx: LayoutCtx, node: DiagramNode, i: number): string {
  return node.fill ?? ctx.palette[i % ctx.palette.length];
}

function textFor(ctx: LayoutCtx, node: DiagramNode): string {
  return node.color ?? ctx.el.color ?? DEFAULT_TEXT;
}

/**
 * Compute the laid-out primitives for a diagram. Pure and deterministic — no
 * randomness, no time — so renderer and writer agree byte-for-byte.
 */
export function layoutDiagram(el: DiagramElement): DiagramPrimitive[] {
  const w = Math.max(1, el.w);
  const h = Math.max(1, el.h);
  const palette =
    el.palette && el.palette.length ? el.palette : DEFAULT_DIAGRAM_PALETTE;
  const ctx: LayoutCtx = { el, w, h, palette };
  const nodes = el.nodes ?? [];
  if (!nodes.length) return [];

  switch (el.kind) {
    case "process":
      return rowLayout(ctx, nodes, true);
    case "timeline":
      return timelineLayout(ctx, nodes);
    case "list":
      return listLayout(ctx, nodes);
    case "funnel":
      return funnelLayout(ctx, nodes);
    case "matrix":
      return matrixLayout(ctx, nodes);
    case "cycle":
      return cycleLayout(ctx, nodes);
    default:
      return rowLayout(ctx, nodes, true);
  }
}

/** Horizontal row of boxes; `withArrows` connects consecutive boxes. */
function rowLayout(
  ctx: LayoutCtx,
  nodes: DiagramNode[],
  withArrows: boolean
): DiagramPrimitive[] {
  const n = nodes.length;
  const gap = ctx.w * 0.04;
  const boxW = (ctx.w - gap * (n - 1)) / n;
  const boxH = Math.min(ctx.h, boxW * 0.7);
  const top = (ctx.h - boxH) / 2;
  const out: DiagramPrimitive[] = [];
  for (let i = 0; i < n; i++) {
    const x = i * (boxW + gap);
    out.push(box(ctx, nodes[i], i, x, top, boxW, boxH, "roundRect"));
  }
  if (withArrows) {
    const cy = top + boxH / 2;
    for (let i = 0; i < n - 1; i++) {
      const x1 = (i + 1) * boxW + i * gap;
      const x2 = x1 + gap;
      out.push(arrow(ctx, `${ctx.el.id}-a${i}`, x1, cy, x2, cy));
    }
  }
  return out;
}

/** Row of boxes sitting on a horizontal spine line (no per-step arrows). */
function timelineLayout(
  ctx: LayoutCtx,
  nodes: DiagramNode[]
): DiagramPrimitive[] {
  const cy = ctx.h / 2;
  const spine: DiagramArrowPrimitive = {
    kind: "arrow",
    id: `${ctx.el.id}-spine`,
    x1: 0,
    y1: cy,
    x2: ctx.w,
    y2: cy,
    arrow: false,
    stroke: ctx.palette[0],
  };
  const n = nodes.length;
  const gap = ctx.w * 0.04;
  const boxW = (ctx.w - gap * (n - 1)) / n;
  const boxH = Math.min(ctx.h * 0.6, boxW * 0.6);
  const top = (ctx.h - boxH) / 2;
  const boxes: DiagramPrimitive[] = [];
  for (let i = 0; i < n; i++) {
    const x = i * (boxW + gap);
    boxes.push(box(ctx, nodes[i], i, x, top, boxW, boxH, "roundRect"));
  }
  // Spine first so the boxes paint on top of it.
  return [spine, ...boxes];
}

/** Vertical stack of full-width boxes. */
function listLayout(ctx: LayoutCtx, nodes: DiagramNode[]): DiagramPrimitive[] {
  const n = nodes.length;
  const gap = ctx.h * 0.04;
  const boxH = (ctx.h - gap * (n - 1)) / n;
  const out: DiagramPrimitive[] = [];
  for (let i = 0; i < n; i++) {
    const y = i * (boxH + gap);
    out.push(box(ctx, nodes[i], i, 0, y, ctx.w, boxH, "roundRect"));
  }
  return out;
}

/** Stacked horizontal bars narrowing toward the bottom (centered). */
function funnelLayout(ctx: LayoutCtx, nodes: DiagramNode[]): DiagramPrimitive[] {
  const n = nodes.length;
  const gap = ctx.h * 0.03;
  const barH = (ctx.h - gap * (n - 1)) / n;
  const out: DiagramPrimitive[] = [];
  for (let i = 0; i < n; i++) {
    // Top bar full width; each subsequent bar narrower, down to 40%.
    const frac = n > 1 ? 1 - (0.6 * i) / (n - 1) : 1;
    const barW = ctx.w * frac;
    const x = (ctx.w - barW) / 2;
    const y = i * (barH + gap);
    out.push(box(ctx, nodes[i], i, x, y, barW, barH, "rect"));
  }
  return out;
}

/** Grid of boxes (≈ square). */
function matrixLayout(ctx: LayoutCtx, nodes: DiagramNode[]): DiagramPrimitive[] {
  const n = nodes.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const gap = Math.min(ctx.w, ctx.h) * 0.04;
  const cellW = (ctx.w - gap * (cols - 1)) / cols;
  const cellH = (ctx.h - gap * (rows - 1)) / rows;
  const out: DiagramPrimitive[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * (cellW + gap);
    const y = row * (cellH + gap);
    out.push(box(ctx, nodes[i], i, x, y, cellW, cellH, "rect"));
  }
  return out;
}

/** Boxes arranged around a circle with arrows between consecutive nodes. */
function cycleLayout(ctx: LayoutCtx, nodes: DiagramNode[]): DiagramPrimitive[] {
  const n = nodes.length;
  const cx = ctx.w / 2;
  const cy = ctx.h / 2;
  const ring = Math.min(ctx.w, ctx.h) * 0.35;
  const boxW = ctx.w * 0.24;
  const boxH = ctx.h * 0.18;
  const centers: { x: number; y: number }[] = [];
  const boxes: DiagramPrimitive[] = [];
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const px = cx + ring * Math.cos(ang);
    const py = cy + ring * Math.sin(ang);
    centers.push({ x: px, y: py });
    boxes.push(
      box(ctx, nodes[i], i, px - boxW / 2, py - boxH / 2, boxW, boxH, "ellipse")
    );
  }
  const arrows: DiagramPrimitive[] = [];
  if (n > 1) {
    for (let i = 0; i < n; i++) {
      const a = centers[i];
      const b = centers[(i + 1) % n];
      arrows.push(arrow(ctx, `${ctx.el.id}-a${i}`, a.x, a.y, b.x, b.y));
    }
  }
  // Arrows under the boxes.
  return [...arrows, ...boxes];
}

function box(
  ctx: LayoutCtx,
  node: DiagramNode,
  i: number,
  x: number,
  y: number,
  w: number,
  h: number,
  shape: DiagramBoxPrimitive["shape"]
): DiagramBoxPrimitive {
  return {
    kind: "box",
    id: node.id || `${ctx.el.id}-n${i}`,
    x: Math.round(x),
    y: Math.round(y),
    w: Math.max(1, Math.round(w)),
    h: Math.max(1, Math.round(h)),
    text: node.text ?? "",
    fill: fillFor(ctx, node, i),
    textColor: textFor(ctx, node),
    shape,
  };
}

function arrow(
  ctx: LayoutCtx,
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): DiagramArrowPrimitive {
  return {
    kind: "arrow",
    id,
    x1: Math.round(x1),
    y1: Math.round(y1),
    x2: Math.round(x2),
    y2: Math.round(y2),
    arrow: true,
    stroke: ctx.el.color ?? "#595959",
  };
}
