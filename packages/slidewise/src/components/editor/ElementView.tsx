import { useEffect, useRef, useState } from "react";
import type {
  SlideElement,
  TextElement,
  TextRun,
  ShapeElement,
  ImageElement,
  LineElement,
  TableElement,
  IconElement,
  EmbedElement,
  ChartElement,
  UnknownElement,
} from "@/lib/types";

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
    case "unknown":
      return <UnknownView el={el} />;
  }
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
    padding: el.padding
      ? `${el.padding.t}px ${el.padding.r}px ${el.padding.b}px ${el.padding.l}px`
      : undefined,
    boxSizing: el.padding ? "border-box" : undefined,
    cursor: editing ? "text" : "inherit",
  };
  const inner: React.CSSProperties = {
    width: "100%",
    color: el.color,
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
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    outline: "none",
  };

  const backingPath = el.backingPath;
  const positionedOuter: React.CSSProperties = backingPath
    ? { ...outer, position: "relative" }
    : outer;
  const innerStacked: React.CSSProperties = backingPath
    ? { ...inner, position: "relative", zIndex: 1 }
    : inner;
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
      <path
        d={backingPath.d}
        fill={backingPath.fill}
        fillRule={backingPath.fillRule ?? "nonzero"}
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

function runCssStyle(r: TextRun): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (r.fontFamily) s.fontFamily = withGenericFallback(r.fontFamily);
  if (r.fontSize) s.fontSize = r.fontSize;
  if (r.fontWeight) s.fontWeight = r.fontWeight;
  if (r.color) s.color = r.color;
  if (r.italic) s.fontStyle = "italic";
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
    a.letterSpacing === b.letterSpacing
  );
}

function ShapeView({ el }: { el: ShapeElement }) {
  const stroke = el.stroke ?? "transparent";
  const sw = el.strokeWidth ?? 0;
  // Custom vector path (PPTX <a:custGeom>) takes precedence over the preset
  // kind — the path coordinates already encode the actual silhouette.
  if (el.path) {
    return (
      <svg
        viewBox={`0 0 ${el.path.viewW} ${el.path.viewH}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
      >
        <path
          d={el.path.d}
          fill={el.fill}
          fillRule={el.path.fillRule ?? "nonzero"}
          stroke={stroke}
          strokeWidth={sw || undefined}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }
  if (el.shape === "rect" || el.shape === "rounded") {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: el.fill,
          borderRadius: el.shape === "rounded" ? (el.radius ?? 16) : 0,
          border: sw ? `${sw}px solid ${stroke}` : undefined,
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
          background: el.fill,
          borderRadius: "50%",
          border: sw ? `${sw}px solid ${stroke}` : undefined,
        }}
      />
    );
  }
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
      {el.shape === "triangle" && (
        <polygon
          points="50,3 97,97 3,97"
          fill={el.fill}
          stroke={stroke}
          strokeWidth={sw}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {el.shape === "diamond" && (
        <polygon
          points="50,3 97,50 50,97 3,50"
          fill={el.fill}
          stroke={stroke}
          strokeWidth={sw}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {el.shape === "star" && (
        <polygon
          points="50,5 61,38 96,38 67,59 78,93 50,72 22,93 33,59 4,38 39,38"
          fill={el.fill}
          stroke={stroke}
          strokeWidth={sw}
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
      style={{ overflow: "visible" }}
    >
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={el.stroke}
        strokeWidth={el.strokeWidth}
        strokeDasharray={el.dashed ? "12 8" : undefined}
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
    if (hasHeader && ri === 0 && el.headerTextColor) return el.headerTextColor;
    if (el.firstColTextColor && ci === 0 && !(hasHeader && ri === 0)) {
      return el.firstColTextColor;
    }
    return el.textColor;
  };
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridAutoRows: "1fr",
        width: "100%",
        height: "100%",
        gap: 0,
        background: "transparent",
        boxShadow: `inset 0 0 0 1px ${stroke}`,
      }}
    >
      {el.rows.flatMap((row, ri) =>
        row.map((cell, ci) => (
          <div
            key={`${ri}-${ci}`}
            style={{
              background: cellFill(ri, ci),
              color: cellColor(ri, ci),
              fontSize: el.fontSize,
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              fontWeight:
                (hasHeader && ri === 0) || (el.firstColFill && ci === 0)
                  ? 600
                  : 400,
              boxSizing: "border-box",
              minWidth: 0,
              minHeight: 0,
              overflow: "hidden",
              wordBreak: "break-word",
              borderRight:
                ci < cols - 1 ? `1px solid ${stroke}` : undefined,
              borderBottom:
                ri < rowCount - 1 ? `1px solid ${stroke}` : undefined,
            }}
          >
            {cell}
          </div>
        ))
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

/**
 * Translate a Slidewise ChartElement into an ECharts option object. Handles
 * bar / column / line / area / pie / doughnut, including stacked + percent
 * stacked variants. Value labels are surfaced when the source deck had
 * `<c:showVal val="1"/>` on at least one series.
 */
function buildChartOption(el: ChartElement) {
  const palette = el.series.map((s, i) => s.color ?? defaultPaletteColor(i));
  const isPercent = el.grouping === "percentStacked";
  const valueFormatter = makeValueFormatter(el.valueFormat, isPercent);

  if (el.kind === "pie" || el.kind === "doughnut") {
    const data = el.categories.map((cat, i) => ({
      name: cat || `Slice ${i + 1}`,
      value: el.series[0]?.values[i] ?? 0,
    }));
    return {
      color: palette,
      title: el.title ? { text: el.title, left: "center", top: 4 } : undefined,
      tooltip: { trigger: "item", valueFormatter },
      legend: { bottom: 4 },
      series: [
        {
          type: "pie",
          radius: el.kind === "doughnut" ? ["45%", "75%"] : "70%",
          data,
          label: el.showDataLabels
            ? { formatter: (p: { value: number }) => valueFormatter(p.value) }
            : { show: false },
        },
      ],
    };
  }

  const isHorizontal = el.kind === "bar"; // "column" + everything else: vertical
  const xAxis = isHorizontal
    ? { type: "value", axisLabel: { formatter: valueFormatter } }
    : { type: "category", data: el.categories };
  const yAxis = isHorizontal
    ? { type: "category", data: el.categories }
    : { type: "value", axisLabel: { formatter: valueFormatter } };

  const stackKey =
    el.grouping === "stacked" || el.grouping === "percentStacked"
      ? "total"
      : undefined;

  const series = el.series.map((s, i) => {
    const color = s.color ?? defaultPaletteColor(i);
    const base = {
      name: s.name,
      type: el.kind === "line" ? "line" : el.kind === "area" ? "line" : "bar",
      data: s.values.map((v) => (v === null ? 0 : v)),
      // Pin the colour explicitly so ECharts can't reassign via palette
      // cycling when multiple series share the same `name` (PowerPoint
      // decks routinely do this — same label, distinct colour fills).
      itemStyle: { color },
      ...(el.kind === "area" ? { areaStyle: { color } } : {}),
      ...(el.kind === "line"
        ? { lineStyle: { color }, symbol: "circle", symbolSize: 6 }
        : {}),
      ...(stackKey ? { stack: stackKey } : {}),
      label: el.showDataLabels
        ? {
            show: true,
            position: stackKey ? "inside" : "top",
            formatter: (p: { value: number }) => valueFormatter(p.value),
            fontSize: 11,
            color: stackKey ? "#FFFFFF" : "#111111",
          }
        : { show: false },
    };
    return base;
  });

  return {
    color: palette,
    title: el.title ? { text: el.title, left: "center", top: 4 } : undefined,
    tooltip: { trigger: "axis", valueFormatter },
    legend: { bottom: 4, type: "scroll" },
    grid: { left: 56, right: 24, top: el.title ? 36 : 16, bottom: 56 },
    xAxis,
    yAxis,
    series,
  };
}

function defaultPaletteColor(i: number): string {
  // Office-ish accent rotation, used when a series omits explicit fill.
  const palette = ["#4F81BD", "#C0504D", "#9BBB59", "#8064A2", "#4BACC6", "#F79646"];
  return palette[i % palette.length];
}

function makeValueFormatter(formatCode: string | undefined, percent: boolean) {
  return (value: number) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "";
    if (percent) return `${Math.round(value * 100)}%`;
    if (formatCode && formatCode.includes("$")) {
      const decimals = (formatCode.match(/0\.(0+)/)?.[1] ?? "").length;
      return `$${value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}`;
    }
    return value.toLocaleString();
  };
}
