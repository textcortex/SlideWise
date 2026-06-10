/**
 * Synthesised-OOXML writers for element forms pptxgenjs can't emit faithfully:
 *
 *   - `<a:custGeom>` shapes (PR 1) — arbitrary SVG paths.
 *   - `<a:gradFill>` / `<a:blipFill>` shape fills (PR 2) — gradients + image fills.
 *   - Slide `<p:bg>` gradient / image backgrounds (PR 3).
 *   - In-app `<c:chart>` parts (PR 4) — partial: bar/column/line/pie/doughnut/area
 *     with cached values, no embedded xlsx. PowerPoint renders from the cache.
 *   - `<p:grpSp>` group shapes (PR 5) — writer-only.
 *   - `<p:embeddedFontLst>` + `ppt/fonts/` (PR 6).
 *   - `<a:effectLst>` shadow / glow (PR 7) — woven into shape XML; for shapes
 *     pptxgenjs still emits, spliced in via post-process by matching the
 *     `cNvPr.name` we tag on output.
 *
 * The orchestration lives in deckToPptx.ts. This module is intentionally
 * stateless — every function takes its slide / deck inputs and returns XML
 * strings + zip-side-effect descriptors, leaving the actual JSZip writes to
 * the orchestrator. That keeps the OOXML emission unit-testable in isolation.
 */

import type {
  Deck,
  SlideElement,
  ShapeElement,
  GroupElement,
  ChartElement,
  ConnectorElement,
  ArrowheadKind,
  ShadowSpec,
  GlowSpec,
  FontAsset,
  Slide,
} from "@/lib/types";
import { pxToEmu, EMU_PER_POINT } from "./units";

// -- Identifiers ------------------------------------------------------------

/**
 * `cNvPr` name we stamp on synthesised shapes so the post-processor (in
 * `deckToPptx.ts`) can splice effects into pptxgenjs-emitted shapes by name
 * match. Includes the element id so a deck with multiple identical shapes
 * keeps its 1:1 mapping.
 */
export const slidewiseShapeName = (elementId: string): string =>
  `slidewise:${elementId}`;

let nextNvId = 100000;
/** Returns a numeric id unique within one writer pass. PPTX needs `cNvPr/@id`
 *  to be unique per `<p:spTree>`; we bias the counter high to avoid colliding
 *  with whatever pptxgenjs allocated for the same spTree. */
export function freshNvId(): number {
  return nextNvId++;
}

// -- Fill parsing -----------------------------------------------------------

export type ParsedFill =
  | { kind: "solid"; color: string; alpha?: number }
  | { kind: "transparent" }
  | { kind: "linear"; angle: number; stops: GradStop[] }
  | { kind: "radial"; focusX: number; focusY: number; stops: GradStop[]; shape: "circle" | "ellipse" }
  | { kind: "image"; src: string };

export interface GradStop {
  /** Percentage 0..100. */
  pos: number;
  /** `#RRGGBB`. */
  color: string;
  /** 0..1, optional alpha. */
  alpha?: number;
}

/**
 * Classify a CSS-ish fill string. Mirrors the inverse of `extractShapeFill`
 * in pptxToDeck.ts. Returns null when the form isn't one we synthesise (e.g.
 * named colors, oklch(), gradients with unparseable stops). Unknown forms
 * fall back to solid black so the writer never throws.
 */
export function parseFill(fill: string | undefined): ParsedFill | null {
  if (!fill) return null;
  const s = fill.trim();
  if (!s || s === "transparent") return { kind: "transparent" };
  if (s.startsWith("#")) {
    const { color, alpha } = parseHexColor(s);
    return { kind: "solid", color, alpha };
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => p.trim());
    const r = clampByte(parseInt(parts[0], 10));
    const g = clampByte(parseInt(parts[1], 10));
    const b = clampByte(parseInt(parts[2], 10));
    const a = parts[3] != null ? Number(parts[3]) : 1;
    return {
      kind: "solid",
      color: `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase(),
      alpha: Number.isFinite(a) ? a : 1,
    };
  }
  if (s.startsWith("linear-gradient(")) {
    const inner = s.slice("linear-gradient(".length, s.lastIndexOf(")"));
    const parts = splitTopLevelCommas(inner);
    let angle = 90;
    let rest = parts;
    const angMatch = /^(-?\d+(?:\.\d+)?)deg$/.exec(parts[0]);
    if (angMatch) {
      angle = Number(angMatch[1]);
      rest = parts.slice(1);
    }
    const stops = parseStops(rest);
    if (!stops.length) return null;
    return { kind: "linear", angle, stops };
  }
  if (s.startsWith("radial-gradient(")) {
    const inner = s.slice("radial-gradient(".length, s.lastIndexOf(")"));
    const parts = splitTopLevelCommas(inner);
    let focusX = 50;
    let focusY = 50;
    let shape: "circle" | "ellipse" = "ellipse";
    let stopParts = parts;
    // First segment may be `circle at X% Y%` / `ellipse at X% Y%`.
    const head = parts[0]?.trim() ?? "";
    if (/^(circle|ellipse)\b/i.test(head)) {
      if (/^circle\b/i.test(head)) shape = "circle";
      const at = /at\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/.exec(head);
      if (at) {
        focusX = Number(at[1]);
        focusY = Number(at[2]);
      }
      stopParts = parts.slice(1);
    }
    const stops = parseStops(stopParts);
    if (!stops.length) return null;
    return { kind: "radial", focusX, focusY, stops, shape };
  }
  const url = /^url\(\s*['"]?([^'")\s]+)['"]?\s*\)$/.exec(s);
  if (url) {
    return { kind: "image", src: url[1] };
  }
  return null;
}

function parseStops(parts: string[]): GradStop[] {
  const out: GradStop[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    // "#RRGGBB 12.34%" / "rgba(...) 0%" / "#fff" (no pos).
    const posMatch = /\s+(-?\d+(?:\.\d+)?)%\s*$/.exec(t);
    const colorRaw = posMatch ? t.slice(0, posMatch.index).trim() : t;
    const fill = parseFill(colorRaw);
    if (!fill) continue;
    if (fill.kind !== "solid" && fill.kind !== "transparent") continue;
    const color = fill.kind === "transparent" ? "#000000" : fill.color;
    const alpha = fill.kind === "transparent" ? 0 : fill.alpha;
    out.push({
      pos: posMatch ? Number(posMatch[1]) : (out.length === 0 ? 0 : 100),
      color,
      alpha,
    });
  }
  return out.sort((a, b) => a.pos - b.pos);
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

// -- Color helpers (no `#`, uppercase) --------------------------------------

export function hexBare(color: string): string {
  if (!color) return "000000";
  const c = color.trim();
  if (c.startsWith("#")) {
    const body = c.slice(1);
    if (body.length === 3) {
      return body
        .split("")
        .map((ch) => `${ch}${ch}`)
        .join("")
        .toUpperCase();
    }
    return body.toUpperCase().slice(0, 6);
  }
  return c.toUpperCase();
}

/**
 * Parse a hex color, splitting out the alpha channel carried by the 4-digit
 * (`#RGBA`) and 8-digit (`#RRGGBBAA`) forms. `hexBare` deliberately truncates
 * to 6 digits, so colors written as `#RRGGBBAA` would otherwise lose their
 * per-stop transparency before it ever reaches `<a:alpha>`. Returns `#RRGGBB`
 * plus alpha in 0..1, or `undefined` alpha when the source has no alpha channel.
 */
function parseHexColor(s: string): { color: string; alpha?: number } {
  let body = s.trim().replace(/^#/, "");
  // Expand 3/4-digit shorthand (e.g. `#abc`, `#abcd`) to the long form.
  if (body.length === 3 || body.length === 4) {
    body = body
      .split("")
      .map((ch) => `${ch}${ch}`)
      .join("");
  }
  const color = `#${body.slice(0, 6).toUpperCase()}`;
  if (body.length >= 8) {
    const a = parseInt(body.slice(6, 8), 16);
    if (Number.isFinite(a)) return { color, alpha: a / 255 };
  }
  return { color };
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, "0");
}

// -- Gradient angle: CSS → OOXML --------------------------------------------

/**
 * CSS angles measure clockwise from "up"; OOXML `<a:lin ang>` measures
 * clockwise from "right" in 60000ths of a degree. The importer applied
 * `(xmlAng/60000 + 90) % 360`; the inverse is below.
 */
export function cssAngleToOoxml(cssDeg: number): number {
  const norm = ((cssDeg - 90) % 360 + 360) % 360;
  return Math.round(norm * 60000);
}

// -- Path: SVG `d` → OOXML pathLst -----------------------------------------

/**
 * Translate the absolute-coordinate subset of an SVG `d` attribute into
 * `<a:pathLst>`. Supports M, L, H, V, C, Q, A, Z and the relative forms by
 * tracking the pen. Falls back to `null` for anything beyond that (S/T smooth
 * shorthands) so the caller can downgrade to a simple rect rather than emit
 * broken geometry.
 *
 * `targetW`/`targetH` (the shape's bounding box in EMU) rescale the path
 * coordinate space so `<a:path w/h>` matches the shape extent. PowerPoint
 * emits custGeom this way, and — crucially — LibreOffice only scales the path
 * onto the shape correctly when the two spaces line up. Leaving the raw source
 * viewBox here is what made some imported vectors (e.g. the eon bicycle,
 * viewW≠box) render blank while others (logo, viewW≈box) happened to work.
 */
export function svgPathToOoxml(
  d: string,
  viewW: number,
  viewH: number,
  fillRule: "nonzero" | "evenodd" = "nonzero",
  targetW?: number,
  targetH?: number
): string | null {
  const tokens = tokenisePath(d);
  if (!tokens.length) return null;
  // `fillRule` is retained for API compatibility but intentionally unused:
  // OOXML custGeom has no even-odd winding control (see the path emission
  // note below). Holes are carried by subpath direction in `d`.
  void fillRule;
  // Scale source path coords → target (shape EMU) space. Defaults to 1 when no
  // target supplied (callers that just want the raw mapping).
  _ptScaleX = targetW && viewW ? targetW / viewW : 1;
  _ptScaleY = targetH && viewH ? targetH / viewH : 1;
  const outW = Math.max(1, Math.round(targetW || viewW));
  const outH = Math.max(1, Math.round(targetH || viewH));
  let i = 0;
  let penX = 0;
  let penY = 0;
  let startX = 0;
  let startY = 0;
  const cmds: string[] = [];
  while (i < tokens.length) {
    const t = tokens[i];
    if (typeof t !== "string") return null; // expected command letter
    const cmd = t;
    i++;
    if (cmd === "M" || cmd === "m") {
      const rel = cmd === "m";
      let first = true;
      while (typeof tokens[i] === "number") {
        const x = Number(tokens[i++]) + (rel ? penX : 0);
        const y = Number(tokens[i++]) + (rel ? penY : 0);
        if (first) {
          cmds.push(`<a:moveTo>${ptXml(x, y)}</a:moveTo>`);
          startX = x;
          startY = y;
          first = false;
        } else {
          // Subsequent coord pairs after M are implicit L per the SVG spec.
          cmds.push(`<a:lnTo>${ptXml(x, y)}</a:lnTo>`);
        }
        penX = x;
        penY = y;
      }
    } else if (cmd === "L" || cmd === "l") {
      const rel = cmd === "l";
      while (typeof tokens[i] === "number") {
        const x = Number(tokens[i++]) + (rel ? penX : 0);
        const y = Number(tokens[i++]) + (rel ? penY : 0);
        cmds.push(`<a:lnTo>${ptXml(x, y)}</a:lnTo>`);
        penX = x;
        penY = y;
      }
    } else if (cmd === "H" || cmd === "h") {
      const rel = cmd === "h";
      while (typeof tokens[i] === "number") {
        const x = Number(tokens[i++]) + (rel ? penX : 0);
        cmds.push(`<a:lnTo>${ptXml(x, penY)}</a:lnTo>`);
        penX = x;
      }
    } else if (cmd === "V" || cmd === "v") {
      const rel = cmd === "v";
      while (typeof tokens[i] === "number") {
        const y = Number(tokens[i++]) + (rel ? penY : 0);
        cmds.push(`<a:lnTo>${ptXml(penX, y)}</a:lnTo>`);
        penY = y;
      }
    } else if (cmd === "C" || cmd === "c") {
      const rel = cmd === "c";
      while (typeof tokens[i] === "number") {
        const x1 = Number(tokens[i++]) + (rel ? penX : 0);
        const y1 = Number(tokens[i++]) + (rel ? penY : 0);
        const x2 = Number(tokens[i++]) + (rel ? penX : 0);
        const y2 = Number(tokens[i++]) + (rel ? penY : 0);
        const x = Number(tokens[i++]) + (rel ? penX : 0);
        const y = Number(tokens[i++]) + (rel ? penY : 0);
        cmds.push(
          `<a:cubicBezTo>${ptXml(x1, y1)}${ptXml(x2, y2)}${ptXml(x, y)}</a:cubicBezTo>`
        );
        penX = x;
        penY = y;
      }
    } else if (cmd === "Q" || cmd === "q") {
      const rel = cmd === "q";
      while (typeof tokens[i] === "number") {
        const x1 = Number(tokens[i++]) + (rel ? penX : 0);
        const y1 = Number(tokens[i++]) + (rel ? penY : 0);
        const x = Number(tokens[i++]) + (rel ? penX : 0);
        const y = Number(tokens[i++]) + (rel ? penY : 0);
        cmds.push(`<a:quadBezTo>${ptXml(x1, y1)}${ptXml(x, y)}</a:quadBezTo>`);
        penX = x;
        penY = y;
      }
    } else if (cmd === "A" || cmd === "a") {
      // Elliptical arc. OOXML's `<a:arcTo>` is angle-based and awkward to
      // derive from SVG's endpoint form, so we approximate each arc with
      // cubic Béziers (≤90° segments → sub-pixel error) and emit those —
      // reusing the already-correct `<a:cubicBezTo>` path. Without this the
      // caller downgrades the entire custGeom to a rect, so any arc-bearing
      // vector (wheels, rounded brand marks, the bicycle) exports blank.
      const rel = cmd === "a";
      while (typeof tokens[i] === "number") {
        const rx = Number(tokens[i++]);
        const ry = Number(tokens[i++]);
        const phi = Number(tokens[i++]);
        const largeArc = Number(tokens[i++]);
        const sweep = Number(tokens[i++]);
        const x = Number(tokens[i++]) + (rel ? penX : 0);
        const y = Number(tokens[i++]) + (rel ? penY : 0);
        const beziers = arcToCubics(
          penX,
          penY,
          rx,
          ry,
          phi,
          largeArc,
          sweep,
          x,
          y
        );
        for (const b of beziers) {
          cmds.push(
            `<a:cubicBezTo>${ptXml(b[0], b[1])}${ptXml(b[2], b[3])}${ptXml(b[4], b[5])}</a:cubicBezTo>`
          );
        }
        penX = x;
        penY = y;
      }
    } else if (cmd === "Z" || cmd === "z") {
      cmds.push(`<a:close/>`);
      penX = startX;
      penY = startY;
    } else {
      // Unsupported command (S, T smooth shorthands) — bail so caller can
      // downgrade.
      return null;
    }
  }
  if (!cmds.length) return null;
  // NB: OOXML `<a:path>`'s `fill` attribute is a *shading* hint
  // (none/norm/lighten/darken), NOT a winding rule — there is no even-odd flag
  // in custGeom. Earlier code emitted `fill="darken"` for even-odd paths,
  // which silently darkened the shape (and tripped LibreOffice) without
  // achieving the hole. We now leave the default `norm` shading; holes come
  // from the subpath directions encoded in `d`.
  return (
    `<a:pathLst>` +
    `<a:path w="${outW}" h="${outH}">` +
    cmds.join("") +
    `</a:path>` +
    `</a:pathLst>`
  );
}

// Per-call scale applied by `ptXml`, set at the top of `svgPathToOoxml`. The
// module is single-threaded/synchronous so this stays consistent within a call.
let _ptScaleX = 1;
let _ptScaleY = 1;

function ptXml(x: number, y: number): string {
  return `<a:pt x="${Math.round(x * _ptScaleX)}" y="${Math.round(y * _ptScaleY)}"/>`;
}

/**
 * Convert one SVG elliptical-arc segment (endpoint parameterisation) into a
 * series of cubic Béziers (≤90° each). Standard implementation following the
 * SVG spec's "Arc implementation notes" — endpoint → centre parameterisation,
 * then a per-segment cubic approximation. Returns `[c1x,c1y,c2x,c2y,ex,ey]`
 * tuples.
 */
function arcToCubics(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  phiDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number
): number[][] {
  // Degenerate radius → straight line (emit a zero-length-control cubic).
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  let rxs = rx * rx;
  let rys = ry * ry;
  const x1ps = x1p * x1p;
  const y1ps = y1p * y1p;
  const lambda = x1ps / rxs + y1ps / rys;
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
    rxs = rx * rx;
    rys = ry * ry;
  }
  const sign = largeArc !== sweep ? 1 : -1;
  const num = Math.max(0, rxs * rys - rxs * y1ps - rys * x1ps);
  const den = rxs * y1ps + rys * x1ps;
  const co = den === 0 ? 0 : sign * Math.sqrt(num / den);
  const cxp = co * ((rx * y1p) / ry);
  const cyp = co * ((-ry * x1p) / rx);
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let a = Math.acos(Math.min(1, Math.max(-1, len === 0 ? 1 : dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = angle(1, 0, ux, uy);
  let dTheta = angle(ux, uy, vx, vy);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segs;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out: number[][] = [];
  let th = theta1;
  let sx = x1;
  let sy = y1;
  for (let k = 0; k < segs; k++) {
    const th2 = th + delta;
    const cosTh = Math.cos(th);
    const sinTh = Math.sin(th);
    const cosTh2 = Math.cos(th2);
    const sinTh2 = Math.sin(th2);
    const ex = cx + (rx * cosTh2 * cosPhi - ry * sinTh2 * sinPhi);
    const ey = cy + (rx * cosTh2 * sinPhi + ry * sinTh2 * cosPhi);
    const d1x = -rx * sinTh * cosPhi - ry * cosTh * sinPhi;
    const d1y = -rx * sinTh * sinPhi + ry * cosTh * cosPhi;
    const d2x = -rx * sinTh2 * cosPhi - ry * cosTh2 * sinPhi;
    const d2y = -rx * sinTh2 * sinPhi + ry * cosTh2 * cosPhi;
    out.push([
      sx + t * d1x,
      sy + t * d1y,
      ex - t * d2x,
      ey - t * d2y,
      ex,
      ey,
    ]);
    sx = ex;
    sy = ey;
    th = th2;
  }
  return out;
}

function tokenisePath(d: string): Array<string | number> {
  const out: Array<string | number> = [];
  const re = /([MmLlHhVvCcQqZzSsTtAa])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    if (m[1]) out.push(m[1]);
    else out.push(Number(m[2]));
  }
  return out;
}

// -- Shape XML synthesis ----------------------------------------------------

export interface MediaPayload {
  /** Target path under the slide rels dir, e.g. `../media/imageSlidewise1.png`. */
  relTarget: string;
  /** Absolute path inside the zip, e.g. `ppt/media/imageSlidewise1.png`. */
  fullPath: string;
  /** Raw bytes. */
  data: Uint8Array;
  /** OOXML rel type. */
  relType: string;
}

export interface SynthShapeResult {
  xml: string;
  media: MediaPayload[];
  /** Suggested rel id allocation: writer will renumber at injection time. */
}

/**
 * Emit a synthesised `<p:sp>` for one shape. The caller is responsible for
 * splicing rIds and copying media into the output zip — we return the media
 * payload alongside the XML and use marker rIds (`rIdSW_<elementId>_<n>`)
 * that the orchestrator rewrites.
 */
export function synthesiseShape(el: ShapeElement): SynthShapeResult {
  const id = freshNvId();
  const name = slidewiseShapeName(el.id);
  const xfrm = xfrmXml(el.x, el.y, el.w, el.h, el.rotation);
  const geom = geometryXml(el);
  const fill = shapeFillXml(el);
  const stroke = lineXml(el);
  const effects = effectLstXml(el.shadow, el.glow);
  const sp =
    `<p:sp>` +
    `<p:nvSpPr><p:cNvPr id="${id}" name="${escapeAttr(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>${xfrm}${geom}${fill.xml}${stroke}${effects}</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody>` +
    `</p:sp>`;
  return { xml: sp, media: fill.media };
}

function geometryXml(el: ShapeElement): string {
  if (el.path) {
    const pathLst = svgPathToOoxml(
      el.path.d,
      el.path.viewW,
      el.path.viewH,
      el.path.fillRule,
      pxToEmu(el.w),
      pxToEmu(el.h)
    );
    if (pathLst) {
      return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/>${pathLst}</a:custGeom>`;
    }
    // Fall through to prstGeom rect if path is unparseable.
  }
  const preset = (
    {
      rect: "rect",
      rounded: "roundRect",
      circle: "ellipse",
      triangle: "triangle",
      diamond: "diamond",
      star: "star5",
    } as const
  )[el.shape];
  return `<a:prstGeom prst="${preset ?? "rect"}"><a:avLst/></a:prstGeom>`;
}

/** Build `<a:solidFill>` / `<a:gradFill>` / `<a:blipFill>` and accumulate
 *  media payloads when the fill references a data URL. */
function shapeFillXml(el: ShapeElement): { xml: string; media: MediaPayload[] } {
  const parsed = parseFill(el.fill);
  if (!parsed) return { xml: `<a:solidFill><a:srgbClr val="${hexBare(el.fill)}"/></a:solidFill>`, media: [] };
  if (parsed.kind === "transparent") return { xml: `<a:noFill/>`, media: [] };
  if (parsed.kind === "solid") {
    return { xml: solidFillXml(parsed.color, parsed.alpha), media: [] };
  }
  if (parsed.kind === "linear") {
    return { xml: linearGradFillXml(parsed.angle, parsed.stops), media: [] };
  }
  if (parsed.kind === "radial") {
    return {
      xml: radialGradFillXml(parsed.focusX, parsed.focusY, parsed.shape, parsed.stops),
      media: [],
    };
  }
  // image
  const media = mediaFromUrl(parsed.src, `img_${el.id}`);
  if (!media) {
    return { xml: `<a:solidFill><a:srgbClr val="000000"/></a:solidFill>`, media: [] };
  }
  // Marker rId — replaced at injection time.
  const ridMarker = ridMarkerFor(el.id, 0);
  return {
    xml: `<a:blipFill><a:blip r:embed="${ridMarker}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`,
    media: [media],
  };
}

export function solidFillXml(color: string, alpha?: number): string {
  const inner = alpha != null && alpha < 1
    ? `<a:alpha val="${Math.round(alpha * 100000)}"/>`
    : ``;
  return `<a:solidFill><a:srgbClr val="${hexBare(color)}">${inner}</a:srgbClr></a:solidFill>`;
}

function linearGradFillXml(cssAng: number, stops: GradStop[]): string {
  return (
    `<a:gradFill flip="none" rotWithShape="1">` +
    gsLstXml(stops) +
    `<a:lin ang="${cssAngleToOoxml(cssAng)}" scaled="0"/>` +
    `</a:gradFill>`
  );
}

function radialGradFillXml(
  focusX: number,
  focusY: number,
  shape: "circle" | "ellipse",
  stops: GradStop[]
): string {
  // fillToRect insets are in thousandths of a percent (matching `pos` units).
  // Mirror the importer's mapping: focus(X,Y) sits at the centre of the
  // l/r/t/b rectangle. We use a zero-area rect at the focus point — that's
  // the convention PowerPoint emits for "radial centred at point".
  const l = clampInset(focusX);
  const t = clampInset(focusY);
  const r = clampInset(100 - focusX);
  const b = clampInset(100 - focusY);
  const path = shape === "circle" ? "circle" : "shape";
  return (
    `<a:gradFill flip="none" rotWithShape="1">` +
    gsLstXml(stops) +
    `<a:path path="${path}"><a:fillToRect l="${l}" t="${t}" r="${r}" b="${b}"/></a:path>` +
    `</a:gradFill>`
  );
}

function clampInset(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)) * 1000);
}

function gsLstXml(stops: GradStop[]): string {
  return (
    `<a:gsLst>` +
    stops
      .map((s) => {
        const alpha =
          s.alpha != null && s.alpha < 1
            ? `<a:alpha val="${Math.round(s.alpha * 100000)}"/>`
            : ``;
        return `<a:gs pos="${Math.round(Math.max(0, Math.min(100, s.pos)) * 1000)}"><a:srgbClr val="${hexBare(
          s.color
        )}">${alpha}</a:srgbClr></a:gs>`;
      })
      .join("") +
    `</a:gsLst>`
  );
}

function lineXml(el: ShapeElement): string {
  if (!el.stroke && !el.strokeWidth) return ``;
  const color = el.stroke ? hexBare(el.stroke) : `000000`;
  const widthEmu = Math.max(1, Math.round((el.strokeWidth ?? 1) * EMU_PER_POINT));
  const dash = el.dashType ? `<a:prstDash val="${el.dashType}"/>` : ``;
  return `<a:ln w="${widthEmu}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${dash}</a:ln>`;
}

export function effectLstXml(
  shadow?: ShadowSpec,
  glow?: GlowSpec
): string {
  if (!shadow && !glow) return ``;
  const inner: string[] = [];
  if (shadow) {
    // OOXML `<a:outerShdw>` distance/direction: distance is the radial offset
    // length in EMU; direction is the angle clockwise from "right" in
    // 60000ths of a degree. CSS shadow gives an (offsetX, offsetY) vector.
    const dist = Math.round(
      Math.hypot(shadow.offsetX, shadow.offsetY) * 9525 // ~px → EMU at 96dpi
    );
    const ang =
      Math.round(
        ((Math.atan2(shadow.offsetY, shadow.offsetX) * 180) / Math.PI + 360) %
          360 * 60000
      );
    const blur = Math.max(0, Math.round(shadow.blur * 9525));
    inner.push(
      `<a:outerShdw blurRad="${blur}" dist="${dist}" dir="${ang}" algn="ctr" rotWithShape="0">` +
        `<a:srgbClr val="${hexBare(shadow.color)}"/>` +
        `</a:outerShdw>`
    );
  }
  if (glow) {
    const rad = Math.max(0, Math.round(glow.radius * 9525));
    inner.push(
      `<a:glow rad="${rad}"><a:srgbClr val="${hexBare(glow.color)}"/></a:glow>`
    );
  }
  return `<a:effectLst>${inner.join("")}</a:effectLst>`;
}

// -- Frame / xfrm helpers ---------------------------------------------------

export function xfrmXml(
  x: number,
  y: number,
  w: number,
  h: number,
  rotation: number
): string {
  // PowerPoint rotation is in 60000ths of a degree, clockwise.
  const rot = rotation ? ` rot="${Math.round(rotation * 60000)}"` : ``;
  return (
    `<a:xfrm${rot}>` +
    `<a:off x="${pxToEmu(x)}" y="${pxToEmu(y)}"/>` +
    `<a:ext cx="${pxToEmu(Math.max(1, w))}" cy="${pxToEmu(Math.max(1, h))}"/>` +
    `</a:xfrm>`
  );
}

// -- Group shape ------------------------------------------------------------

/**
 * Emit a `<p:grpSp>` wrapping the synthesised XML of each child. Group XML
 * needs a child `<p:nvGrpSpPr>` and a `<p:grpSpPr>` with its own xfrm that
 * declares both the group's external frame (`off/ext`) and the *child*
 * coordinate frame (`chOff/chExt`). We set chOff/chExt equal to off/ext so
 * children's absolute slide coordinates work as-is.
 */
export function synthesiseGroup(
  el: GroupElement,
  renderChild: (child: SlideElement) => { xml: string; media: MediaPayload[] } | null
): { xml: string; media: MediaPayload[] } {
  const id = freshNvId();
  const childMedia: MediaPayload[] = [];
  const childXml: string[] = [];
  for (const child of el.children) {
    const out = renderChild(child);
    if (!out) continue;
    childXml.push(out.xml);
    for (const m of out.media) childMedia.push(m);
  }
  const xfrm =
    `<a:xfrm>` +
    `<a:off x="${pxToEmu(el.x)}" y="${pxToEmu(el.y)}"/>` +
    `<a:ext cx="${pxToEmu(Math.max(1, el.w))}" cy="${pxToEmu(Math.max(1, el.h))}"/>` +
    `<a:chOff x="${pxToEmu(el.x)}" y="${pxToEmu(el.y)}"/>` +
    `<a:chExt cx="${pxToEmu(Math.max(1, el.w))}" cy="${pxToEmu(Math.max(1, el.h))}"/>` +
    `</a:xfrm>`;
  const xml =
    `<p:grpSp>` +
    `<p:nvGrpSpPr><p:cNvPr id="${id}" name="${escapeAttr(slidewiseShapeName(el.id))}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr>${xfrm}</p:grpSpPr>` +
    childXml.join("") +
    `</p:grpSp>`;
  return { xml, media: childMedia };
}

// -- Connector ---------------------------------------------------------------

const CONNECTOR_PRESET: Record<ConnectorElement["kind"], string> = {
  straight: "straightConnector1",
  bent: "bentConnector3",
  curved: "curvedConnector3",
};

/** Map our arrowhead names onto OOXML `<a:headEnd>/<a:tailEnd>` `type` values
 *  (which share the same vocabulary). */
function lineEndXml(tag: "headEnd" | "tailEnd", kind?: ArrowheadKind): string {
  if (!kind || kind === "none") return "";
  // Our names are already the OOXML values (triangle/stealth/arrow/oval/diamond).
  return `<a:${tag} type="${kind}"/>`;
}

/**
 * Emit a `<p:cxnSp>` connector. The bounding box spans the two anchor corners;
 * `flipH`/`flipV` select which diagonal the line runs along (exactly how OOXML
 * encodes connector direction). Straight / bent (elbow) / curved presets map to
 * the `straightConnector1` / `bentConnector3` / `curvedConnector3` geometries.
 */
export function synthesiseConnector(el: ConnectorElement): {
  xml: string;
  media: MediaPayload[];
} {
  const id = freshNvId();
  const name = slidewiseShapeName(el.id);
  const rot = el.rotation ? ` rot="${Math.round(el.rotation * 60000)}"` : "";
  const flip =
    (el.flipH ? ` flipH="1"` : "") + (el.flipV ? ` flipV="1"` : "");
  const xfrm =
    `<a:xfrm${rot}${flip}>` +
    `<a:off x="${pxToEmu(el.x)}" y="${pxToEmu(el.y)}"/>` +
    `<a:ext cx="${pxToEmu(Math.max(1, el.w))}" cy="${pxToEmu(Math.max(1, el.h))}"/>` +
    `</a:xfrm>`;
  const preset = CONNECTOR_PRESET[el.kind] ?? "straightConnector1";
  const widthEmu = Math.max(1, Math.round((el.strokeWidth ?? 1) * EMU_PER_POINT));
  const dash = el.dashType ? `<a:prstDash val="${el.dashType}"/>` : "";
  const ln =
    `<a:ln w="${widthEmu}">` +
    `<a:solidFill><a:srgbClr val="${hexBare(el.stroke)}"/></a:solidFill>` +
    dash +
    lineEndXml("headEnd", el.startArrow) +
    lineEndXml("tailEnd", el.endArrow) +
    `</a:ln>`;
  const effects = effectLstXml(el.shadow, el.glow);
  const xml =
    `<p:cxnSp>` +
    `<p:nvCxnSpPr>` +
    `<p:cNvPr id="${id}" name="${escapeAttr(name)}"/>` +
    `<p:cNvCxnSpPr/>` +
    `<p:nvPr/>` +
    `</p:nvCxnSpPr>` +
    `<p:spPr>${xfrm}<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>${ln}${effects}</p:spPr>` +
    `</p:cxnSp>`;
  return { xml, media: [] };
}

// -- Slide background synthesis (PR 3) --------------------------------------

export function synthesiseSlideBg(
  slide: Slide
): { xml: string | null; media: MediaPayload[] } {
  const parsed = parseFill(slide.background);
  if (!parsed) return { xml: null, media: [] };
  if (parsed.kind === "transparent") {
    return { xml: `<p:bg><p:bgPr><a:noFill/><a:effectLst/></p:bgPr></p:bg>`, media: [] };
  }
  if (parsed.kind === "solid") {
    // Solid is already handled by pptxgenjs — return null to leave its output
    // in place.
    return { xml: null, media: [] };
  }
  if (parsed.kind === "linear") {
    return {
      xml: `<p:bg><p:bgPr>${linearGradFillXml(parsed.angle, parsed.stops)}<a:effectLst/></p:bgPr></p:bg>`,
      media: [],
    };
  }
  if (parsed.kind === "radial") {
    return {
      xml: `<p:bg><p:bgPr>${radialGradFillXml(parsed.focusX, parsed.focusY, parsed.shape, parsed.stops)}<a:effectLst/></p:bgPr></p:bg>`,
      media: [],
    };
  }
  // image
  const media = mediaFromUrl(parsed.src, `bg_${slide.id}`);
  if (!media) return { xml: null, media: [] };
  const ridMarker = ridMarkerFor(`bg_${slide.id}`, 0);
  return {
    xml: `<p:bg><p:bgPr><a:blipFill><a:blip r:embed="${ridMarker}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`,
    media: [media],
  };
}

// -- Chart synthesis (PR 4, partial) ---------------------------------------

export interface SynthChartResult {
  /** OOXML for the `<p:graphicFrame>` to drop into the slide spTree. */
  graphicFrameXml: string;
  /** Chart part XML body (full document). */
  chartXml: string;
  /** Chart part rels XML (empty when no embedded workbook). */
  chartRelsXml: string;
  /** Suggested chart part path, e.g. `ppt/charts/chartSW_<id>.xml`. */
  partPath: string;
  /** Suggested chart part rels path. */
  partRelsPath: string;
}

/**
 * Emit a minimal in-app chart. No embedded xlsx workbook — PowerPoint
 * renders from the cached values declared in `<c:numCache>` / `<c:strCache>`.
 * Right-click → Edit Data won't work in PowerPoint until we generate a real
 * xlsx; that's the followup. The chart renders correctly on open.
 */
export function synthesiseChart(el: ChartElement): SynthChartResult {
  const id = freshNvId();
  const partPath = `ppt/charts/chartSW_${sanitiseId(el.id)}.xml`;
  const partRelsPath = `ppt/charts/_rels/chartSW_${sanitiseId(el.id)}.xml.rels`;
  const ridMarker = ridMarkerFor(el.id, 0);

  const catCount = el.categories.length;
  const grouping = el.grouping ?? "standard";
  const seriesXml = el.series.map((s, idx) => seriesXmlFor(el, s, idx)).join("");

  let plotXml = "";
  if (el.kind === "bar") {
    plotXml = `<c:barChart><c:barDir val="bar"/><c:grouping val="${grouping}"/>${seriesXml}${catAxisRef()}${valAxisRef()}</c:barChart>${axesXml(true)}`;
  } else if (el.kind === "column") {
    plotXml = `<c:barChart><c:barDir val="col"/><c:grouping val="${grouping}"/>${seriesXml}${catAxisRef()}${valAxisRef()}</c:barChart>${axesXml(false)}`;
  } else if (el.kind === "line") {
    plotXml = `<c:lineChart><c:grouping val="${grouping === "stacked" || grouping === "percentStacked" ? grouping : "standard"}"/>${seriesXml}${catAxisRef()}${valAxisRef()}</c:lineChart>${axesXml(false)}`;
  } else if (el.kind === "area") {
    plotXml = `<c:areaChart><c:grouping val="${grouping === "stacked" || grouping === "percentStacked" ? grouping : "standard"}"/>${seriesXml}${catAxisRef()}${valAxisRef()}</c:areaChart>${axesXml(false)}`;
  } else if (el.kind === "pie") {
    plotXml = `<c:pieChart><c:varyColors val="1"/>${seriesXml}</c:pieChart>`;
  } else if (el.kind === "doughnut") {
    plotXml = `<c:doughnutChart><c:varyColors val="1"/>${seriesXml}<c:holeSize val="50"/></c:doughnutChart>`;
  }

  const title = el.title
    ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${escapeText(
        el.title
      )}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`
    : `<c:autoTitleDeleted val="1"/>`;

  const chartXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<c:chart>${title}<c:plotArea><c:layout/>${plotXml}</c:plotArea><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `</c:chartSpace>`;

  const chartRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  const graphicFrameXml =
    `<p:graphicFrame>` +
    `<p:nvGraphicFramePr><p:cNvPr id="${id}" name="${escapeAttr(slidewiseShapeName(el.id))}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="${pxToEmu(el.x)}" y="${pxToEmu(el.y)}"/><a:ext cx="${pxToEmu(Math.max(1, el.w))}" cy="${pxToEmu(Math.max(1, el.h))}"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${ridMarker}"/></a:graphicData></a:graphic>` +
    `</p:graphicFrame>`;

  return { graphicFrameXml, chartXml, chartRelsXml, partPath, partRelsPath };

  function seriesXmlFor(
    chart: ChartElement,
    s: { name: string; values: (number | null)[]; color?: string },
    idx: number
  ): string {
    const ptValsXml = s.values
      .map((v, i) =>
        v == null ? `` : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`
      )
      .join("");
    const ptCatsXml = chart.categories
      .map(
        (c, i) =>
          `<c:pt idx="${i}"><c:v>${escapeText(String(c))}</c:v></c:pt>`
      )
      .join("");
    const colorXml = s.color
      ? `<c:spPr><a:solidFill><a:srgbClr val="${hexBare(s.color)}"/></a:solidFill></c:spPr>`
      : ``;
    return (
      `<c:ser>` +
      `<c:idx val="${idx}"/><c:order val="${idx}"/>` +
      `<c:tx><c:v>${escapeText(s.name || `Series ${idx + 1}`)}</c:v></c:tx>` +
      colorXml +
      `<c:cat><c:strRef><c:f>cat</c:f><c:strCache><c:ptCount val="${catCount}"/>${ptCatsXml}</c:strCache></c:strRef></c:cat>` +
      `<c:val><c:numRef><c:f>val${idx}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${s.values.length}"/>${ptValsXml}</c:numCache></c:numRef></c:val>` +
      `</c:ser>`
    );
  }
  function catAxisRef(): string {
    return `<c:axId val="111111111"/><c:axId val="222222222"/>`;
  }
  function valAxisRef(): string {
    return ``;
  }
  function axesXml(barIsHoriz: boolean): string {
    const catAxOrient = barIsHoriz ? "minMax" : "minMax";
    return (
      `<c:catAx><c:axId val="111111111"/><c:scaling><c:orientation val="${catAxOrient}"/></c:scaling><c:delete val="0"/><c:axPos val="${barIsHoriz ? "l" : "b"}"/><c:crossAx val="222222222"/></c:catAx>` +
      `<c:valAx><c:axId val="222222222"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${barIsHoriz ? "b" : "l"}"/><c:crossAx val="111111111"/></c:valAx>`
    );
  }
}

// -- Embedded fonts (PR 6) --------------------------------------------------

export interface EmbeddedFontDescriptor {
  family: string;
  /** `<p:embeddedFont>` typeface XML — slotted into `<p:embeddedFontLst>`. */
  embeddedFontXml: string;
  /** Bytes to write into ppt/fonts/. */
  payloads: { fullPath: string; data: Uint8Array }[];
  /** `<Relationship>` entries to add to presentation.xml.rels for each
   *  payload, with marker rIds that the orchestrator rewrites. */
  rels: { ridMarker: string; relType: string; target: string }[];
}

export async function synthesiseEmbeddedFonts(
  fonts: FontAsset[]
): Promise<EmbeddedFontDescriptor[]> {
  const out: EmbeddedFontDescriptor[] = [];
  for (let i = 0; i < fonts.length; i++) {
    const font = fonts[i];
    const bytes = await fetchFontBytes(font.data);
    if (!bytes) continue;
    const fullPath = `ppt/fonts/slidewiseFont${i + 1}.fntdata`;
    const ridMarker = ridMarkerFor(`font${i}`, 0);
    const variant = font.italic
      ? font.weight && font.weight >= 600
        ? `boldItalic`
        : `italic`
      : font.weight && font.weight >= 600
        ? `bold`
        : `regular`;
    const embeddedFontXml =
      `<p:embeddedFont>` +
      `<p:font typeface="${escapeAttr(font.family)}" panose="00000000000000000000" pitchFamily="0" charset="0"/>` +
      `<p:${variant} r:id="${ridMarker}"/>` +
      `</p:embeddedFont>`;
    out.push({
      family: font.family,
      embeddedFontXml,
      payloads: [{ fullPath, data: bytes }],
      rels: [
        {
          ridMarker,
          relType:
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/font",
          target: `fonts/slidewiseFont${i + 1}.fntdata`,
        },
      ],
    });
  }
  return out;
}

async function fetchFontBytes(src: string): Promise<Uint8Array | null> {
  if (src.startsWith("data:")) {
    const comma = src.indexOf(",");
    if (comma < 0) return null;
    const header = src.slice(0, comma);
    const body = src.slice(comma + 1);
    if (header.includes(";base64")) {
      return decodeBase64(body);
    }
    return new TextEncoder().encode(decodeURIComponent(body));
  }
  if (/^https?:/i.test(src)) {
    try {
      const res = await fetch(src);
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  }
  return null;
}

// -- Misc helpers ----------------------------------------------------------

/**
 * Produce a "marker" rId that won't conflict with real rIds — the orchestrator
 * scans for these markers and rewrites them to fresh rIds in the appropriate
 * rels namespace.
 */
export function ridMarkerFor(scope: string, n: number): string {
  return `rIdSW_${sanitiseId(scope)}_${n}`;
}

/**
 * Allocate media path + zip-write descriptor for a `url(...)` reference.
 * Returns null when the URL isn't a data URL we can decode synchronously.
 * Remote http(s) URLs are NOT inlined here (synchronous-only) — those keep
 * their `url(...)` and won't round-trip; that's the limit for v1.
 */
export function mediaFromUrl(src: string, scope: string): MediaPayload | null {
  if (!src.startsWith("data:")) return null;
  const comma = src.indexOf(",");
  if (comma < 0) return null;
  const header = src.slice(0, comma);
  const body = src.slice(comma + 1);
  const mimeMatch = /^data:([^;,]+)/.exec(header);
  const mime = mimeMatch ? mimeMatch[1] : "image/png";
  const ext = mime.split("/")[1]?.split("+")[0] ?? "png";
  const bytes = header.includes(";base64")
    ? decodeBase64(body)
    : new TextEncoder().encode(decodeURIComponent(body));
  const fullPath = `ppt/media/imageSlidewise_${sanitiseId(scope)}.${ext}`;
  // Slide rels live in ppt/slides/_rels — targets are relative to ppt/slides.
  const relTarget = `../media/imageSlidewise_${sanitiseId(scope)}.${ext}`;
  return {
    fullPath,
    relTarget,
    data: bytes,
    relType:
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  };
}

function decodeBase64(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64.replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node fallback. Buffer is global in Node; cast through unknown so this
  // module type-checks in browser-only configs without dom-buffer typings.
  const B = (globalThis as unknown as { Buffer?: { from(b: string, e: string): Uint8Array } }).Buffer;
  if (B) return B.from(b64, "base64");
  throw new Error("[slidewise] no base64 decoder available");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sanitiseId(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "_");
}

// Re-export a marker matcher so the orchestrator can swap markers without
// duplicating the regex.
export const RID_MARKER_RE = /rIdSW_[A-Za-z0-9_]+/g;

// Tests reach into these — keep them on the module namespace.
export const __internals = {
  parseStops,
  splitTopLevelCommas,
  cssAngleToOoxml,
  tokenisePath,
};

// Re-exports used in deckToPptx — explicit so TS sees them.
export type { Deck };
