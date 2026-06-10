import { useEffect, useId, useRef, useState } from "react";
import type {
  SlideElement,
  TextElement,
  TextRun,
  ShapeElement,
  ImageElement,
  LineElement,
  TableElement,
  CellBorderSide,
  IconElement,
  EmbedElement,
  ChartElement,
  ConnectorElement,
  GroupElement,
  UnknownElement,
  ShadowSpec,
  GlowSpec,
} from "@/lib/types";
import { buildChartOption } from "@/lib/chart/chartOption";

export function ElementView({
  el,
  editing,
  onTextCommit,
}: {
  el: SlideElement;
  editing?: boolean;
  onTextCommit?: (text: string, runs?: TextRun[]) => void;
}) {
  switch (el.type) {
    case "text":
      return <TextView el={el} editing={editing} onCommit={onTextCommit} />;
    case "shape":
      return <ShapeView el={el} />;
    case "image":
      return <ImageView el={el} />;
    case "line":
      return <LineView el={el} />;
    case "table":
      return <TableView el={el} />;
    case "icon":
      return <IconView el={el} />;
    case "embed":
      return <EmbedView el={el} />;
    case "chart":
      return <ChartView el={el} />;
    case "connector":
      return <ConnectorView el={el} />;
    case "group":
      return <GroupView el={el} editing={editing} onTextCommit={onTextCommit} />;
    case "unknown":
      return <UnknownView el={el} />;
  }
}

/**
 * Render a group as a transparent wrapper sized by the parent positioner;
 * children carry slide-absolute coordinates so we translate the wrapper to
 * (0,0) and absolutely-position children at (child.x - group.x, child.y - group.y).
 * Child elements remain individually selectable in v1 — group-level
 * drag/selection is the PR-5 follow-up.
 */
function GroupView({
  el,
  editing,
  onTextCommit,
}: {
  el: GroupElement;
  editing?: boolean;
  onTextCommit?: (text: string, runs?: TextRun[]) => void;
}) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {el.children.map((child) => (
        <div
          key={child.id}
          style={{
            position: "absolute",
            left: child.x - el.x,
            top: child.y - el.y,
            width: child.w,
            height: child.h,
            transform: child.rotation ? `rotate(${child.rotation}deg)` : undefined,
          }}
        >
          <ElementView el={child} editing={editing} onTextCommit={onTextCommit} />
        </div>
      ))}
    </div>
  );
}

/** CSS for shadow/glow effects shared by Text / Shape / Line renderers. */
function effectStyle(
  shadow: ShadowSpec | undefined,
  glow: GlowSpec | undefined,
  kind: "box" | "text" | "filter"
): React.CSSProperties {
  const parts: string[] = [];
  if (shadow) {
    parts.push(`${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.color}`);
  }
  if (glow) {
    // CSS has no native "glow" — approximate as a zero-offset shadow with the
    // glow radius as blur, doubled to render visibly without too much falloff.
    parts.push(`0 0 ${glow.radius}px ${glow.color}`);
    parts.push(`0 0 ${glow.radius * 2}px ${glow.color}`);
  }
  if (!parts.length) return {};
  if (kind === "box") return { boxShadow: parts.join(", ") };
  if (kind === "text") return { textShadow: parts.join(", ") };
  return { filter: parts.map((p) => `drop-shadow(${p})`).join(" ") };
}

function TextView({
  el,
  editing,
  onCommit,
}: {
  el: TextElement;
  editing?: boolean;
  onCommit?: (text: string, runs?: TextRun[]) => void;
}) {
  const backingId = useId();
  // Outer wrapper handles vertical alignment via flex; the inner block carries
  // the typographic flow so inline <span> runs lay out correctly. Putting flex
  // on the same node as the spans turns each span into a block-level flex
  // item — that broke multi-color text layout in v1.
  const outer: React.CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    justifyContent:
      el.vAlign === "top"
        ? "flex-start"
        : el.vAlign === "middle"
          ? "center"
          : "flex-end",
    background: el.background,
    // Border / radius for a text-bearing preset shape (e.g. roundRect callout).
    border: el.borderColor
      ? `${el.borderWidth ?? 1}px solid ${el.borderColor}`
      : undefined,
    borderRadius: el.borderRadius ? el.borderRadius : undefined,
    padding: el.padding
      ? `${el.padding.t}px ${el.padding.r}px ${el.padding.b}px ${el.padding.l}px`
      : undefined,
    boxSizing: el.padding || el.borderColor ? "border-box" : undefined,
    cursor: editing ? "text" : "inherit",
  };
  const inner: React.CSSProperties = {
    width: "100%",
    color: el.color,
    ...effectStyle(el.shadow, el.glow, "text"),
    fontFamily: withGenericFallback(el.fontFamily),
    fontSize: el.fontSize,
    fontWeight: el.fontWeight,
    fontStyle: el.italic ? "italic" : "normal",
    textDecoration: [el.underline && "underline", el.strike && "line-through"]
      .filter(Boolean)
      .join(" "),
    textAlign: el.align,
    lineHeight: el.lineHeight,
    letterSpacing: el.letterSpacing,
    whiteSpace: el.noWrap ? "pre" : "pre-wrap",
    wordBreak: el.noWrap ? "normal" : "break-word",
    outline: "none",
  };

  const backingPath = el.backingPath;
  const positionedOuter: React.CSSProperties = backingPath
    ? { ...outer, position: "relative" }
    : outer;
  const innerStacked: React.CSSProperties = backingPath
    ? { ...inner, position: "relative", zIndex: 1 }
    : inner;
  // Backing fill may be a CSS gradient — SVG `fill=` needs a paint server.
  const backingGradId = `sw-grad-${backingId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const backingPaint = svgGradientPaint(backingPath?.fill, backingGradId);
  const backingSvg = backingPath ? (
    <svg
      viewBox={`0 0 ${backingPath.viewW} ${backingPath.viewH}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {backingPaint.def && <defs>{backingPaint.def}</defs>}
      <path
        d={backingPath.d}
        fill={backingPaint.paint}
        fillRule={backingPath.fillRule ?? "nonzero"}
        stroke={backingPath.stroke}
        strokeWidth={backingPath.stroke ? backingPath.strokeWidth ?? 1 : undefined}
        vectorEffect={backingPath.stroke ? "non-scaling-stroke" : undefined}
      />
    </svg>
  ) : null;

  if (editing) {
    return (
      <div style={positionedOuter}>
        {backingSvg}
        <EditableText
          style={innerStacked}
          initialText={el.text}
          initialRuns={el.runs}
          onCommit={(t, r) => onCommit?.(t, r)}
        />
      </div>
    );
  }

  if (el.paragraphs && el.paragraphs.length) {
    // Per-paragraph rendering implements PPTX hanging-indent bullets: each
    // paragraph becomes its own block, with `padding-left = marL` and
    // `text-indent = indent`. A negative indent on top of a positive
    // padding-left pulls the bullet glyph out to the left of the wrapped
    // text below, matching PowerPoint's bulleted-list look.
    return (
      <div style={positionedOuter}>
        {backingSvg}
        <div style={innerStacked}>
          {el.paragraphs.map((pp, pi) => {
            // Indent / spacing live on the per-line blocks below; the wrapper
            // only carries alignment (inherited by its line children).
            const paraStyle: React.CSSProperties = {
              textAlign: pp.align ?? undefined,
            };
            // A hanging-indent paragraph needs each line as its own block —
            // CSS text-indent only affects a block's first line, so a
            // multi-line bulleted paragraph would misalign every bullet after
            // the first. Split on "\n" and render one indented block per line.
            const lineRuns: TextRun[][] =
              pp.runs && pp.runs.length
                ? splitRunsByNewline(pp.runs)
                : (pp.text ?? "").split("\n").map((t) => [{ text: t }]);
            const content = lineRuns.map((line, li) => (
              <div
                key={li}
                style={{
                  paddingLeft: pp.marL ? pp.marL : undefined,
                  textIndent: pp.indent ? pp.indent : undefined,
                  marginTop:
                    li === 0 && pp.spaceBefore ? pp.spaceBefore : undefined,
                }}
              >
                {line.some((r) => r.text.length > 0)
                  ? line.map((r, ri) => (
                      <span key={ri} style={runCssStyle(r)}>
                        {r.text}
                      </span>
                    ))
                  : /* keep an empty paragraph's line height (blank line) */ " "}
              </div>
            ));
            return (
              <div key={pi} style={paraStyle}>
                {content || " "}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (el.runs && el.runs.length) {
    return (
      <div style={positionedOuter}>
        {backingSvg}
        <div style={innerStacked}>
          {el.runs.map((r, i) => (
            <span key={i} style={runCssStyle(r)}>
              {r.text}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={positionedOuter}>
      {backingSvg}
      <div style={innerStacked}>{el.text}</div>
    </div>
  );
}

/**
 * Append a `sans-serif` generic so brand families imported from PPTX
 * (e.g. "EON Office Head") degrade gracefully when the typeface isn't
 * installed locally — without the generic the browser silently picks
 * its default serif. Already-qualified stacks (containing a comma) and
 * plain generics ("serif"/"monospace") pass through untouched.
 */
function withGenericFallback(family: string | undefined): string | undefined {
  if (!family) return family;
  if (family.includes(",")) return family;
  const lower = family.trim().toLowerCase();
  if (
    lower === "serif" ||
    lower === "sans-serif" ||
    lower === "monospace" ||
    lower === "cursive" ||
    lower === "fantasy" ||
    lower === "system-ui"
  ) {
    return family;
  }
  return `${family}, sans-serif`;
}

/**
 * Split a run list into per-line groups at "\n", preserving each run's style.
 * Used so a hanging-indent paragraph can render each line as its own block.
 */
function splitRunsByNewline(runs: TextRun[]): TextRun[][] {
  const lines: TextRun[][] = [[]];
  for (const r of runs) {
    const parts = r.text.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part.length) lines[lines.length - 1].push({ ...r, text: part });
    });
  }
  return lines;
}

function runCssStyle(r: TextRun): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (r.fontFamily) s.fontFamily = withGenericFallback(r.fontFamily);
  if (r.fontSize) s.fontSize = r.fontSize;
  if (r.fontWeight) s.fontWeight = r.fontWeight;
  if (r.color) s.color = r.color;
  if (r.highlight) {
    s.backgroundColor = r.highlight;
    // Keep the highlight painted continuously across wrapped lines.
    s.boxDecorationBreak = "clone";
    s.WebkitBoxDecorationBreak = "clone";
  }
  if (r.italic) s.fontStyle = "italic";
  if (r.cap === "all") s.textTransform = "uppercase";
  else if (r.cap === "small") s.fontVariant = "small-caps";
  if (r.letterSpacing != null) s.letterSpacing = r.letterSpacing;
  const decoration = [r.underline && "underline", r.strike && "line-through"]
    .filter(Boolean)
    .join(" ");
  if (decoration) s.textDecoration = decoration;
  return s;
}

function EditableText({
  style,
  initialText,
  initialRuns,
  onCommit,
}: {
  style: React.CSSProperties;
  initialText: string;
  initialRuns?: TextRun[];
  onCommit: (text: string, runs?: TextRun[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const initialRunsRef = useRef(initialRuns);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (initialRunsRef.current && initialRunsRef.current.length) {
      node.innerHTML = runsToHtml(initialRunsRef.current);
    } else {
      node.innerText = initialText;
    }
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    const node = ref.current;
    if (!node) return;
    const hadRuns = !!initialRunsRef.current?.length;
    if (!hadRuns) {
      onCommit(node.innerText, undefined);
      return;
    }
    const { text, runs } = extractRunsFromDom(node);
    // If extraction collapsed everything to one style, drop runs to keep the
    // store representation clean.
    const isHomogeneous =
      runs.length <= 1 ||
      runs.every((r) => sameStyle(r, runs[0]));
    onCommit(text, isHomogeneous ? undefined : runs);
  };

  return (
    <div
      ref={ref}
      style={style}
      contentEditable
      suppressContentEditableWarning
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          (e.target as HTMLDivElement).blur();
        }
        e.stopPropagation();
      }}
    />
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function runsToHtml(runs: TextRun[]): string {
  return runs
    .map((r) => {
      const props: string[] = [];
      if (r.color) props.push(`color: ${r.color}`);
      if (r.fontFamily) props.push(`font-family: ${r.fontFamily}`);
      if (r.fontSize) props.push(`font-size: ${r.fontSize}px`);
      if (r.fontWeight) props.push(`font-weight: ${r.fontWeight}`);
      if (r.italic) props.push(`font-style: italic`);
      if (r.cap === "all") props.push(`text-transform: uppercase`);
      else if (r.cap === "small") props.push(`font-variant: small-caps`);
      if (r.highlight) props.push(`background-color: ${r.highlight}`);
      if (r.letterSpacing != null) props.push(`letter-spacing: ${r.letterSpacing}px`);
      const decoration = [r.underline && "underline", r.strike && "line-through"]
        .filter(Boolean)
        .join(" ");
      if (decoration) props.push(`text-decoration: ${decoration}`);
      const styleAttr = props.join("; ");
      const html = escapeHtml(r.text).replace(/\n/g, "<br>");
      return `<span data-slidewise-run="1" style="${styleAttr}">${html}</span>`;
    })
    .join("");
}

function styleToRun(el: HTMLElement, text: string): TextRun {
  // Read explicit inline style only (not computed) so we don't capture
  // inherited defaults like the body color.
  const s = el.style;
  const r: TextRun = { text };
  if (s.color) r.color = s.color;
  if (s.fontFamily) r.fontFamily = s.fontFamily.replace(/^["']|["']$/g, "");
  if (s.fontSize) {
    const px = parseFloat(s.fontSize);
    if (Number.isFinite(px)) r.fontSize = px;
  }
  if (s.fontWeight) {
    const w = parseInt(s.fontWeight, 10);
    if (Number.isFinite(w)) r.fontWeight = w;
  }
  if (s.fontStyle === "italic") r.italic = true;
  if (s.textTransform === "uppercase") r.cap = "all";
  else if (s.fontVariant === "small-caps") r.cap = "small";
  if (s.backgroundColor) r.highlight = s.backgroundColor;
  if (s.letterSpacing) {
    const ls = parseFloat(s.letterSpacing);
    if (Number.isFinite(ls)) r.letterSpacing = ls;
  }
  const td = s.textDecoration || s.textDecorationLine;
  if (td?.includes("underline")) r.underline = true;
  if (td?.includes("line-through")) r.strike = true;
  return r;
}

function extractRunsFromDom(root: HTMLElement): { text: string; runs: TextRun[] } {
  const runs: TextRun[] = [];
  const text: string[] = [];

  const walk = (node: Node, parentStyle: HTMLElement | null) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? "";
      if (!t) return;
      runs.push(parentStyle ? styleToRun(parentStyle, t) : { text: t });
      text.push(t);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.tagName === "BR") {
      // Append "\n" to the most recent run so it stays in-style.
      if (runs.length) runs[runs.length - 1].text += "\n";
      else runs.push({ text: "\n" });
      text.push("\n");
      return;
    }
    if (el.tagName === "DIV" || el.tagName === "P") {
      // Browser may wrap new lines in <div>/<p>. Treat as line breaks between
      // children: insert a "\n" before the children of every block past the
      // first one.
      if (runs.length || text.length) {
        if (runs.length) runs[runs.length - 1].text += "\n";
        else runs.push({ text: "\n" });
        text.push("\n");
      }
      el.childNodes.forEach((c) => walk(c, el));
      return;
    }
    // SPAN or any other inline wrapper: pass its style to children.
    el.childNodes.forEach((c) => walk(c, el));
  };

  root.childNodes.forEach((c) => walk(c, null));
  return { text: text.join(""), runs };
}

function sameStyle(a: TextRun, b: TextRun): boolean {
  return (
    a.color === b.color &&
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.fontWeight === b.fontWeight &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.highlight === b.highlight &&
    a.cap === b.cap &&
    a.letterSpacing === b.letterSpacing
  );
}

// Map an OOXML <a:prstDash val="…"/> token to a CSS border-style and SVG
// stroke-dasharray. PowerPoint's dot/dash patterns are sized relative to the
// stroke width; the multipliers below match the visual rhythm of the preset
// dash names (PPTX renders all "dot" variants as small round dots, "dash" as
// medium dashes, "lgDash" as long dashes, etc.).
function dashStyleFor(
  preset: string | undefined,
  sw: number
): { borderStyle: "dotted" | "dashed" | "solid"; dasharray: string | undefined } {
  if (!preset || preset === "solid") {
    return { borderStyle: "solid", dasharray: undefined };
  }
  const w = Math.max(1, sw);
  switch (preset) {
    case "dot":
    case "sysDot":
      return { borderStyle: "dotted", dasharray: `${w} ${w * 2}` };
    case "dash":
    case "sysDash":
      return { borderStyle: "dashed", dasharray: `${w * 4} ${w * 3}` };
    case "lgDash":
      return { borderStyle: "dashed", dasharray: `${w * 8} ${w * 3}` };
    case "dashDot":
    case "sysDashDot":
      return { borderStyle: "dashed", dasharray: `${w * 4} ${w * 3} ${w} ${w * 3}` };
    case "lgDashDot":
      return { borderStyle: "dashed", dasharray: `${w * 8} ${w * 3} ${w} ${w * 3}` };
    case "sysDashDotDot":
    case "lgDashDotDot":
      return {
        borderStyle: "dashed",
        dasharray: `${w * 8} ${w * 3} ${w} ${w * 3} ${w} ${w * 3}`,
      };
    default:
      return { borderStyle: "dashed", dasharray: `${w * 4} ${w * 3}` };
  }
}

interface GradStop {
  pos: number;
  color: string;
  opacity?: number;
}

/**
 * SVG `<path>` / `<polygon>` `fill` attributes cannot take a CSS gradient
 * function (`linear-gradient(...)` / `radial-gradient(...)`) — they only
 * accept a colour or a `url(#paintServer)` reference. So a vector shape (a
 * PPTX `<a:custGeom>` silhouette, or a triangle / diamond / star) that carries
 * a gradient fill renders with NO fill at all (blank) if we hand the raw CSS
 * string straight to `fill=`. This builds the matching SVG paint server and
 * returns `url(#id)` plus the `<defs>` child to render. Solid colours,
 * `transparent`, `rgba(...)`, and `url(...)` pass straight through.
 */
function svgGradientPaint(
  fill: string | undefined,
  id: string
): { paint: string | undefined; def: React.ReactNode } {
  const grad = parseCssGradient(fill);
  if (!grad) return { paint: fill, def: null };
  const stops = grad.stops.map((s, i) => (
    <stop
      key={i}
      offset={`${s.pos}%`}
      stopColor={s.color}
      stopOpacity={s.opacity}
    />
  ));
  if (grad.kind === "linear") {
    const v = linearGradientVector(grad.angle);
    return {
      paint: `url(#${id})`,
      def: (
        <linearGradient id={id} x1={v.x1} y1={v.y1} x2={v.x2} y2={v.y2}>
          {stops}
        </linearGradient>
      ),
    };
  }
  return {
    paint: `url(#${id})`,
    def: (
      <radialGradient
        id={id}
        cx={`${grad.cx}%`}
        cy={`${grad.cy}%`}
        // ~corner-reaching radius so the gradient fills the box rather than
        // stopping short at the bounding circle. Exact for export is handled
        // by the OOXML writer; this is the editor preview approximation.
        r="75%"
        fx={`${grad.cx}%`}
        fy={`${grad.cy}%`}
      >
        {stops}
      </radialGradient>
    ),
  };
}

type ParsedGradient =
  | { kind: "linear"; angle: number; stops: GradStop[] }
  | { kind: "radial"; cx: number; cy: number; stops: GradStop[] };

function parseCssGradient(fill: string | undefined): ParsedGradient | null {
  if (!fill) return null;
  const s = fill.trim();
  if (s.startsWith("linear-gradient(")) {
    const inner = s.slice("linear-gradient(".length, s.lastIndexOf(")"));
    const parts = splitTopLevelCommas(inner);
    let angle = 180;
    let rest = parts;
    if (parts.length && /deg\s*$/.test(parts[0].trim())) {
      angle = parseFloat(parts[0]);
      rest = parts.slice(1);
    }
    const stops = parseGradientStops(rest);
    return stops.length ? { kind: "linear", angle, stops } : null;
  }
  if (s.startsWith("radial-gradient(")) {
    const inner = s.slice("radial-gradient(".length, s.lastIndexOf(")"));
    const parts = splitTopLevelCommas(inner);
    let cx = 50;
    let cy = 50;
    let rest = parts;
    if (parts.length && /\bat\b/.test(parts[0])) {
      const m = /at\s+(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%/.exec(parts[0]);
      if (m) {
        cx = parseFloat(m[1]);
        cy = parseFloat(m[2]);
      }
      rest = parts.slice(1);
    }
    const stops = parseGradientStops(rest);
    return stops.length ? { kind: "radial", cx, cy, stops } : null;
  }
  return null;
}

/** Split on top-level commas only — colours like `rgba(0,0,0,.5)` keep theirs. */
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

function parseGradientStops(parts: string[]): GradStop[] {
  const out: GradStop[] = [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const pm = /\s+(-?\d+(?:\.\d+)?)%$/.exec(p);
    const pos = pm ? parseFloat(pm[1]) : out.length === 0 ? 0 : 100;
    const colorStr = (pm ? p.slice(0, pm.index) : p).trim();
    out.push({ pos, ...splitHexAlpha(colorStr) });
  }
  return out;
}

/** `#RRGGBBAA` → `{ color: "#RRGGBB", opacity }`; everything else unchanged. */
function splitHexAlpha(c: string): { color: string; opacity?: number } {
  const m = /^#([0-9a-fA-F]{8})$/.exec(c);
  if (!m) return { color: c };
  return {
    color: `#${m[1].slice(0, 6)}`,
    opacity: parseInt(m[1].slice(6, 8), 16) / 255,
  };
}

/**
 * CSS gradient angle (0deg = up, clockwise) → SVG `objectBoundingBox`
 * gradient line endpoints in [0,1]. 0deg ⇒ bottom→top, 90deg ⇒ left→right.
 */
function linearGradientVector(deg: number): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const r = (deg * Math.PI) / 180;
  const sin = Math.sin(r);
  const cos = Math.cos(r);
  return {
    x1: 0.5 - 0.5 * sin,
    y1: 0.5 + 0.5 * cos,
    x2: 0.5 + 0.5 * sin,
    y2: 0.5 - 0.5 * cos,
  };
}

/**
 * A shape's `fill` may be a picture/SVG fill the importer captured from a
 * PPTX `<a:blipFill>` (modern Office icons), stored as `url("data:…")` /
 * `url(https://…)`. Pull the bare URL out so it can be painted as an
 * `<image>` (vector shapes) or `background-image` (rect/circle). Gradients
 * and solid colours return undefined — they paint via the normal path.
 */
function imageFillUrlOf(fill: string | undefined): string | undefined {
  if (!fill) return undefined;
  const m = /^\s*url\((['"]?)(.*?)\1\)\s*$/.exec(fill);
  return m ? m[2] : undefined;
}

function ShapeView({ el }: { el: ShapeElement }) {
  const stroke = el.stroke ?? "transparent";
  const sw = el.strokeWidth ?? 0;
  const imageFill = imageFillUrlOf(el.fill);
  // Accept either `strokeDash` (raw OOXML, set by the importer) or
  // `dashType` (typed enum, set by AI-authored / host-supplied decks).
  // Raw wins when both are set — it preserves PPTX intent exactly.
  const dash = dashStyleFor(el.strokeDash ?? el.dashType, sw);
  const effect = effectStyle(el.shadow, el.glow, "filter");
  // SVG `fill=` can't take a CSS gradient string, so vector shapes need a
  // paint server. Build it once and reuse for path + polygon renderers.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gradId = `sw-grad-${uid}`;
  const { paint, def } = svgGradientPaint(el.fill, gradId);
  // Custom vector path (PPTX <a:custGeom>) takes precedence over the preset
  // kind — the path coordinates already encode the actual silhouette.
  if (el.path) {
    // Picture/SVG fill: paint the image clipped to the silhouette rather
    // than handing the renderer an `url(...)` it can't use as an SVG paint.
    if (imageFill) {
      const clipId = `sw-clip-${uid}`;
      return (
        <svg
          viewBox={`0 0 ${el.path.viewW} ${el.path.viewH}`}
          preserveAspectRatio="none"
          width="100%"
          height="100%"
          style={effect}
        >
          <defs>
            <clipPath id={clipId}>
              <path d={el.path.d} fillRule={el.path.fillRule ?? "nonzero"} />
            </clipPath>
          </defs>
          <image
            href={imageFill}
            x={0}
            y={0}
            width={el.path.viewW}
            height={el.path.viewH}
            preserveAspectRatio="none"
            clipPath={`url(#${clipId})`}
          />
          {sw ? (
            <path
              d={el.path.d}
              fill="none"
              fillRule={el.path.fillRule ?? "nonzero"}
              stroke={stroke}
              strokeWidth={sw}
              strokeDasharray={dash.dasharray}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
      );
    }
    return (
      <svg
        viewBox={`0 0 ${el.path.viewW} ${el.path.viewH}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        style={effect}
      >
        {def && <defs>{def}</defs>}
        <path
          d={el.path.d}
          fill={paint}
          fillRule={el.path.fillRule ?? "nonzero"}
          stroke={stroke}
          strokeWidth={sw || undefined}
          strokeDasharray={dash.dasharray}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  // PPTX `<a:stretch><a:fillRect/>` fills the box edge-to-edge; mirror that
  // with a non-repeating, box-sized background image. Use the
  // `background-image` longhand (not the `background` shorthand, which would
  // reset background-size back to its initial value).
  const fillStyle: React.CSSProperties = imageFill
    ? {
        backgroundImage: el.fill,
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center",
      }
    : { background: el.fill };
  if (el.shape === "rect" || el.shape === "rounded") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          ...fillStyle,
          borderRadius: el.shape === "rounded" ? (el.radius ?? 16) : 0,
          border: sw ? `${sw}px ${dash.borderStyle} ${stroke}` : undefined,
          ...effectStyle(el.shadow, el.glow, "box"),
        }}
      />
    );
  }
  if (el.shape === "circle") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          ...fillStyle,
          borderRadius: "50%",
          border: sw ? `${sw}px ${dash.borderStyle} ${stroke}` : undefined,
          ...effectStyle(el.shadow, el.glow, "box"),
        }}
      />
    );
  }
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      style={effect}
    >
      {def && <defs>{def}</defs>}
      {el.shape === "triangle" && (
        <polygon
          points="50,3 97,97 3,97"
          fill={paint}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash.dasharray}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {el.shape === "diamond" && (
        <polygon
          points="50,3 97,50 50,97 3,50"
          fill={paint}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash.dasharray}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {el.shape === "star" && (
        <polygon
          points="50,5 61,38 96,38 67,59 78,93 50,72 22,93 33,59 4,38 39,38"
          fill={paint}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dash.dasharray}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

function ImageView({ el }: { el: ImageElement }) {
  // When the source PPTX defined a crop (<a:srcRect>), render via
  // background-image so we can apply background-size/position to mimic
  // PowerPoint's "crop then fill" behaviour. Otherwise fall back to <img>
  // with object-fit, which keeps a:alt text usable.
  if (el.crop) {
    const { l, r, t, b } = el.crop;
    const remW = Math.max(0.0001, 1 - l - r);
    const remH = Math.max(0.0001, 1 - t - b);
    // Scale the source so its visible (post-crop) area exactly fills the box,
    // then offset so the cropped corner sits at (0,0).
    const sizeX = 100 / remW;
    const sizeY = 100 / remH;
    const posX = remW > 0 ? (l / (l + r || 1)) * 100 : 0;
    const posY = remH > 0 ? (t / (t + b || 1)) * 100 : 0;
    return (
      <div
        role="img"
        aria-label={el.alt ?? ""}
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          borderRadius: el.radius ?? 0,
          backgroundImage: `url(${el.src})`,
          backgroundSize: `${sizeX}% ${sizeY}%`,
          backgroundPosition: `${posX}% ${posY}%`,
          backgroundRepeat: "no-repeat",
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        borderRadius: el.radius ?? 0,
      }}
    >
      <img
        src={el.src}
        alt={el.alt ?? ""}
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: el.fit,
          display: "block",
          userSelect: "none",
        }}
      />
    </div>
  );
}

function LineView({ el }: { el: LineElement }) {
  // A LineElement renders a segment from one corner of its bounding box to
  // the opposite corner — supports horizontal, vertical, and diagonal lines.
  // Negative w/h come from PPTX flipH/flipV: invert the start/end so the
  // visual direction matches the source.
  const aw = Math.abs(el.w) || 1;
  const ah = Math.abs(el.h) || 1;
  const x1 = el.w < 0 ? aw : 0;
  const y1 = el.h < 0 ? ah : 0;
  const x2 = el.w < 0 ? 0 : aw;
  const y2 = el.h < 0 ? 0 : ah;
  return (
    <svg
      viewBox={`0 0 ${aw} ${ah}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      style={{ overflow: "visible", ...effectStyle(el.shadow, el.glow, "filter") }}
    >
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={el.stroke}
        strokeWidth={el.strokeWidth}
        strokeDasharray={
          dashStyleFor(el.dashType, el.strokeWidth).dasharray ??
          (el.dashed ? "12 8" : undefined)
        }
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {el.arrow && (
        <polygon
          points={`${x2},${y2} ${x2 - 18},${y2 - 9} ${x2 - 18},${y2 + 9}`}
          fill={el.stroke}
        />
      )}
    </svg>
  );
}

/**
 * Render a connector — a first-class line between two anchor corners of its
 * bounding box. `flipH`/`flipV` pick the diagonal; `kind` selects straight /
 * bent (elbow) / curved geometry; `startArrow`/`endArrow` add arrowheads.
 * Mirrors the `<p:cxnSp>` the writer emits so the editor preview matches save.
 */
function ConnectorView({ el }: { el: ConnectorElement }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const w = Math.abs(el.w) || 1;
  const h = Math.abs(el.h) || 1;
  const sx = el.flipH ? w : 0;
  const sy = el.flipV ? h : 0;
  const ex = el.flipH ? 0 : w;
  const ey = el.flipV ? 0 : h;

  let d: string;
  if (el.kind === "bent") {
    const mx = (sx + ex) / 2;
    d = `M ${sx} ${sy} L ${mx} ${sy} L ${mx} ${ey} L ${ex} ${ey}`;
  } else if (el.kind === "curved") {
    const mx = (sx + ex) / 2;
    d = `M ${sx} ${sy} C ${mx} ${sy} ${mx} ${ey} ${ex} ${ey}`;
  } else {
    d = `M ${sx} ${sy} L ${ex} ${ey}`;
  }

  const startId = `cxn-s-${uid}`;
  const endId = `cxn-e-${uid}`;
  const hasStart = el.startArrow && el.startArrow !== "none";
  const hasEnd = el.endArrow && el.endArrow !== "none";

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      style={{ overflow: "visible", ...effectStyle(el.shadow, el.glow, "filter") }}
    >
      <defs>
        {hasStart && <ArrowMarker id={startId} color={el.stroke} orient="auto-start-reverse" />}
        {hasEnd && <ArrowMarker id={endId} color={el.stroke} orient="auto" />}
      </defs>
      <path
        d={d}
        fill="none"
        stroke={el.stroke}
        strokeWidth={el.strokeWidth}
        strokeDasharray={dashStyleFor(el.dashType, el.strokeWidth).dasharray}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        markerStart={hasStart ? `url(#${startId})` : undefined}
        markerEnd={hasEnd ? `url(#${endId})` : undefined}
      />
    </svg>
  );
}

/** A reusable triangular arrowhead marker. The PPTX writer encodes the exact
 *  arrowhead family; the preview uses a single triangular glyph. */
function ArrowMarker({
  id,
  color,
  orient,
}: {
  id: string;
  color: string;
  orient: string;
}) {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient={orient}
      markerUnits="strokeWidth"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
    </marker>
  );
}

function TableView({ el }: { el: TableElement }) {
  const cols = el.rows[0]?.length ?? 1;
  const rowCount = el.rows.length;
  // PPTX-faithful: contiguous cells, no inter-cell gap, no rounded corners.
  // Cells share their dividers via inset box-shadows so we draw a single
  // grid line between adjacent cells instead of doubling-up borders.
  const stroke = el.borderColor ?? "rgba(0, 0, 0, 0.12)";
  const hasHeader = el.hasHeader ?? true;
  const bandRows = el.bandRows ?? false;
  const cellFill = (ri: number, ci: number): string => {
    // An explicit per-cell fill (PPTX <a:tcPr> override) wins over every
    // row-class default — this is what paints think-cell Gantt cells.
    const perCell = el.cellFills?.[ri]?.[ci];
    if (perCell) return perCell;
    // In a per-cell-fill table, a cell with no fill of its own is transparent
    // (the slide shows through). It must NOT fall back to headerFill/rowFill —
    // those were derived from some other cell and would flood unfilled cells
    // with that colour (e.g. a stray cream band turning the whole grid cream).
    if (el.cellFills) return "transparent";
    if (hasHeader && ri === 0) return el.headerFill;
    if (el.lastRowFill && ri === rowCount - 1 && rowCount > 1) return el.lastRowFill;
    if (el.firstColFill && ci === 0) return el.firstColFill;
    if (el.lastColFill && ci === cols - 1) return el.lastColFill;
    if (bandRows && el.rowAltFill) {
      // Banding counts body rows only: with a header, body row 0 (slide row 1)
      // is band-1; without one, slide row 0 is band-1.
      const bodyIdx = hasHeader ? ri - 1 : ri;
      return bodyIdx % 2 === 1 ? el.rowAltFill : el.rowFill;
    }
    return el.rowFill;
  };
  const cellColor = (ri: number, ci: number): string => {
    const perCell = el.cellTextColors?.[ri]?.[ci];
    if (perCell) return perCell;
    if (hasHeader && ri === 0 && el.headerTextColor) return el.headerTextColor;
    if (el.firstColTextColor && ci === 0 && !(hasHeader && ri === 0)) {
      return el.firstColTextColor;
    }
    return el.textColor;
  };

  // When the source defined per-cell borders, honour them exactly: most PPTX
  // (think-cell) cells leave sides blank, so a uniform grid is wrong. Each
  // internal edge is drawn once — by the cell above (its bottom) or to the
  // left (its right) — and a coloured side wins over a neighbour's blank one,
  // so shared edges never double up.
  const hasCellBorders = !!el.cellBorders;
  const sideCss = (s: CellBorderSide | null | undefined): string | undefined =>
    s ? `${s.width}px solid ${s.color}` : undefined;
  // Pick the drawn line between two adjacent sides (a colour beats null/absent).
  const mergeSide = (
    a: CellBorderSide | null | undefined,
    b: CellBorderSide | null | undefined
  ): CellBorderSide | null | undefined => a ?? b;
  // Merged cells: a covered continuation cell renders nothing, and a spanning
  // origin cell is placed explicitly so it covers the columns/rows it merges
  // (e.g. a full-width band). Explicit placement (col/row = array index) avoids
  // auto-flow ambiguity once some cells span and others are omitted.
  const hasSpans = !!el.cellSpans;
  const cellPlacement = (ri: number, ci: number): React.CSSProperties => {
    if (!hasSpans) return {};
    const span = el.cellSpans?.[ri]?.[ci];
    return {
      gridColumn: `${ci + 1} / span ${span?.colSpan ?? 1}`,
      gridRow: `${ri + 1} / span ${span?.rowSpan ?? 1}`,
    };
  };
  const cellBorderStyle = (ri: number, ci: number): React.CSSProperties => {
    if (!hasCellBorders) {
      // Legacy default: a single faint grid line shared between cells.
      return {
        borderRight: ci < cols - 1 ? `1px solid ${stroke}` : undefined,
        borderBottom: ri < rowCount - 1 ? `1px solid ${stroke}` : undefined,
      };
    }
    const cb = el.cellBorders?.[ri]?.[ci] ?? undefined;
    const right = mergeSide(cb?.r, el.cellBorders?.[ri]?.[ci + 1]?.l);
    const bottom = mergeSide(cb?.b, el.cellBorders?.[ri + 1]?.[ci]?.t);
    return {
      // Outer top/left edges belong to the first row/column; internal top/left
      // edges are covered by the neighbour's bottom/right so they aren't doubled.
      borderTop: ri === 0 ? sideCss(cb?.t) : undefined,
      borderLeft: ci === 0 ? sideCss(cb?.l) : undefined,
      borderRight: sideCss(right),
      borderBottom: sideCss(bottom),
    };
  };
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          el.colWidths && el.colWidths.length === cols
            ? el.colWidths.map((w) => `${w}fr`).join(" ")
            : `repeat(${cols}, 1fr)`,
        gridTemplateRows:
          el.rowHeights && el.rowHeights.length === rowCount
            ? el.rowHeights.map((h) => `${h}fr`).join(" ")
            : `repeat(${rowCount}, 1fr)`,
        width: "100%",
        height: "100%",
        gap: 0,
        background: "transparent",
        // The legacy frame only applies to tables without explicit cell borders.
        boxShadow: hasCellBorders ? undefined : `inset 0 0 0 1px ${stroke}`,
      }}
    >
      {el.rows.flatMap((row, ri) =>
        row.map((cell, ci) => {
          // Cells merged into a neighbour aren't rendered — the spanning
          // origin covers their grid slot.
          if (el.cellSpans?.[ri]?.[ci]?.covered) return null;
          // Rich runs (highlight / per-run font / bullet line breaks / ✓
          // glyphs) take over from the flat string when present.
          const runs = el.cellRuns?.[ri]?.[ci];
          const content =
            runs && runs.length
              ? runs.map((r, i) => (
                  <span key={i} style={runCssStyle(r)}>
                    {r.text}
                  </span>
                ))
              : cell;
          return (
          <div
            key={`${ri}-${ci}`}
            style={{
              background: cellFill(ri, ci),
              color: cellColor(ri, ci),
              fontSize: el.fontSize,
              padding: "12px 16px",
              display: "flex",
              // Vertical alignment: honour the cell's own anchor when the
              // source set one (<a:tcPr anchor>); otherwise fall back to the
              // header-centred / body-top default. PPTX cells default to top.
              alignItems: (() => {
                const va = el.cellVAligns?.[ri]?.[ci];
                if (va === "middle") return "center";
                if (va === "bottom") return "flex-end";
                if (va === "top") return "flex-start";
                return hasHeader && ri === 0 ? "center" : "flex-start";
              })(),
              fontWeight:
                (hasHeader && ri === 0) || (el.firstColFill && ci === 0)
                  ? 600
                  : 400,
              boxSizing: "border-box",
              minWidth: 0,
              minHeight: 0,
              overflow: "hidden",
              wordBreak: "break-word",
              ...cellPlacement(ri, ci),
              ...cellBorderStyle(ri, ci),
            }}
          >
            {/* Single inline-flow child so run spans wrap as text and the
                "\n" bullet breaks apply (flex children would lay out in a
                row, collapsing every bullet onto one line). */}
            <div style={{ width: "100%", whiteSpace: "pre-wrap" }}>
              {content}
            </div>
          </div>
          );
        })
      )}
    </div>
  );
}

function IconView({ el }: { el: IconElement }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: el.color,
        fontSize: Math.min(el.w, el.h) * 0.7,
      }}
    >
      {el.icon}
    </div>
  );
}

function UnknownView({ el }: { el: UnknownElement }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background:
          "repeating-linear-gradient(45deg, rgba(15,19,48,0.04) 0 8px, transparent 8px 16px)",
        border: "1px dashed var(--border-strong)",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 4,
        color: "var(--ink-muted)",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 12,
        padding: 12,
        textAlign: "center",
      }}
    >
      <div style={{ fontWeight: 600 }}>{el.label ?? "Imported content"}</div>
      <div style={{ opacity: 0.7 }}>{el.ooxmlTag}</div>
    </div>
  );
}

function EmbedView({ el }: { el: EmbedElement }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0E1330",
        color: "#fff",
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        padding: 16,
        gap: 8,
        fontFamily: "Inter",
      }}
    >
      <div style={{ fontSize: 14, opacity: 0.6 }}>Embed</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{el.label}</div>
      <div style={{ fontSize: 12, opacity: 0.5, wordBreak: "break-all" }}>
        {el.url}
      </div>
    </div>
  );
}

/**
 * Render a parsed chart via Apache ECharts, lazy-loaded on mount so the
 * library only ships when a deck actually contains charts. Disposes its
 * instance on unmount / element change so re-imports don't leak. The
 * source `<p:graphicFrame>` XML is preserved on `el.ooxmlXml` for save
 * round-trips — the serializer re-emits it verbatim.
 */
function ChartView({ el }: { el: ChartElement }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let instance: { dispose(): void; resize(): void } | null = null;
    (async () => {
      try {
        const echarts = await import("echarts");
        if (cancelled || !ref.current) return;
        const option = buildChartOption(el);
        instance = echarts.init(ref.current);
        // `notMerge: true` so series/colours never merge with a prior render
        // (ECharts merges by index by default; that masks colour updates).
        (
          instance as unknown as {
            setOption: (o: unknown, notMerge?: boolean) => void;
          }
        ).setOption(option, true);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Chart render failed");
      }
    })();
    return () => {
      cancelled = true;
      instance?.dispose();
    };
  }, [el]);

  if (error) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#FFFFFF",
          border: "1px dashed rgba(0,0,0,0.15)",
          fontSize: 12,
          color: "#6B7280",
        }}
      >
        Chart: {error}
      </div>
    );
  }
  return <div ref={ref} style={{ width: "100%", height: "100%" }} />;
}

// Chart-option construction (buildChartOption / defaultPaletteColor /
// makeValueFormatter) lives in @/lib/chart/chartOption so it can be shared with
// hosts via the public API for server-side previews. ChartView imports it.
