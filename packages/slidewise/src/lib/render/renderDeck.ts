/**
 * Headless deck → image rendering for a server-side visual-QA loop.
 *
 * `renderDeckToSvg` composes a deterministic SVG per slide that draws **what
 * the editor draws** — native charts (`buildChartOption` + ECharts SSR),
 * diagrams (`layoutDiagram`), text with the deck's runs/fonts, shapes, images,
 * backgrounds, in z-order — NOT the OOXML raster fallbacks. `renderDeckToImages`
 * rasterises those SVGs to PNG/JPEG.
 *
 * Browser-free: no Playwright / Chromium, no DOM. ECharts runs in SSR mode.
 * Rasterisation is an injected hook (`opts.rasterizeSvg`) — pass
 * `@resvg/resvg-js` (or any SVG→PNG) so the module stays isomorphic and free of
 * a hard native dependency; when omitted the default tries a dynamic
 * `@resvg/resvg-js` import and throws a clear error if it isn't installed.
 */
import type { Deck, Slide, SlideElement, TextRun } from "../types";
import { SLIDE_W, SLIDE_H } from "../types";
import { buildChartOption } from "../chart/chartOption";
import { layoutDiagram } from "../diagram/layout";
import { parsePptx } from "../pptx/pptxToDeck";

export interface RenderOptions {
  /** 1-based slide subset to render; default all. */
  slides?: number[];
  /** Output resolution; the slide's 1920×1080 canvas scales by `dpi/96`. */
  dpi?: number;
  /** Output image format. Default "png". */
  format?: "png" | "jpeg";
  /** Optional width cap (px) for thumbnails; preserves aspect ratio. */
  maxWidth?: number;
  /**
   * SVG → raster hook. `(svg, width, height, format) => bytes`. Injected so the
   * module needs no native dep; pass e.g. a `@resvg/resvg-js` wrapper. The hook
   * owns the output encoding (the built-in default emits PNG regardless of
   * `format`; pass a custom hook for JPEG).
   */
  rasterizeSvg?: (
    svg: string,
    width: number,
    height: number,
    format: "png" | "jpeg"
  ) => Promise<Uint8Array> | Uint8Array;
}

const DEFAULT_DPI = 96;

/**
 * Compose one SVG string per requested slide — drawing what the editor draws.
 * Async because ECharts is loaded on demand (dynamic import, so it never bloats
 * the editor bundle); the SVG composition itself is synchronous. Usable on its
 * own when the host rasterises the SVGs itself.
 */
export async function renderDeckToSvg(deck: Deck, opts: RenderOptions = {}): Promise<string[]> {
  const slides = pickSlides(deck, opts.slides);
  const charts = await renderCharts(slides);
  return slides.map((s) => renderSlideToSvg(s, charts));
}

/** Render requested slides to raster image bytes (one per slide, in order). */
export async function renderDeckToImages(
  deck: Deck,
  opts: RenderOptions = {}
): Promise<Uint8Array[]> {
  const svgs = await renderDeckToSvg(deck, opts);
  const { width, height } = outputSize(opts);
  const rasterize = opts.rasterizeSvg ?? defaultRasterize;
  const format = opts.format ?? "png";
  const out: Uint8Array[] = [];
  for (const svg of svgs) out.push(await rasterize(svg, width, height, format));
  return out;
}

/** Convenience: render a single 1-based slide index to image bytes. */
export async function renderSlideToImage(
  deck: Deck,
  slideIndex: number,
  opts: RenderOptions = {}
): Promise<Uint8Array> {
  const [img] = await renderDeckToImages(deck, { ...opts, slides: [slideIndex] });
  if (!img) throw new Error(`renderSlideToImage: slide ${slideIndex} out of range`);
  return img;
}

/** Parse a `.pptx` and render it — for rendering a final `applyEdits` output. */
export async function renderPptxToImages(
  bytes: Uint8Array | ArrayBuffer | Blob,
  opts: RenderOptions = {}
): Promise<Uint8Array[]> {
  const deck = await parsePptx(bytes);
  return renderDeckToImages(deck, opts);
}

// ----------------------------------------------------------------------------

function pickSlides(deck: Deck, subset: number[] | undefined): Slide[] {
  if (!subset) return deck.slides;
  return subset
    .map((n) => deck.slides[n - 1])
    .filter((s): s is Slide => Boolean(s));
}

function outputSize(opts: RenderOptions): { width: number; height: number } {
  const scale = (opts.dpi ?? DEFAULT_DPI) / DEFAULT_DPI;
  let width = Math.round(SLIDE_W * scale);
  let height = Math.round(SLIDE_H * scale);
  if (opts.maxWidth && width > opts.maxWidth) {
    height = Math.round((opts.maxWidth / width) * height);
    width = opts.maxWidth;
  }
  return { width, height };
}

/** Pre-render every chart (recursing groups) to an SVG fragment, via a single
 *  on-demand ECharts SSR import — so the SVG composition stays synchronous and
 *  ECharts stays out of the editor bundle. */
async function renderCharts(slides: Slide[]): Promise<ChartCache> {
  const cache: ChartCache = new Map();
  const charts: Extract<SlideElement, { type: "chart" }>[] = [];
  const collect = (el: SlideElement) => {
    if (el.type === "chart") charts.push(el);
    else if (el.type === "group") el.children.forEach(collect);
  };
  for (const s of slides) s.elements.forEach(collect);
  if (!charts.length) return cache;

  const echarts = (await import("echarts")) as typeof import("echarts");
  for (const el of charts) {
    const w = Math.max(1, Math.round(el.w));
    const h = Math.max(1, Math.round(el.h));
    const chart = echarts.init(null as unknown as HTMLElement, null, {
      renderer: "svg",
      ssr: true,
      width: w,
      height: h,
    });
    try {
      chart.setOption({ ...buildChartOption(el), animation: false });
      const svg = chart.renderToSVGString();
      const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
      cache.set(el.id, `<g transform="translate(${round(el.x)} ${round(el.y)})">${inner}</g>`);
    } finally {
      chart.dispose();
    }
  }
  return cache;
}

type ChartCache = Map<string, string>;

function renderSlideToSvg(slide: Slide, charts: ChartCache): string {
  const body: string[] = [renderBackground(slide.background)];
  const ordered = [...slide.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  for (const el of ordered) body.push(renderElement(el, charts));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${SLIDE_W}" height="${SLIDE_H}" viewBox="0 0 ${SLIDE_W} ${SLIDE_H}">` +
    body.join("") +
    `</svg>`
  );
}

function renderBackground(background: string | undefined): string {
  const fill = background ? solidFrom(background) : "#FFFFFF";
  if (isImageRef(background)) {
    const href = imageHref(background!);
    return (
      `<rect x="0" y="0" width="${SLIDE_W}" height="${SLIDE_H}" fill="#FFFFFF"/>` +
      `<image x="0" y="0" width="${SLIDE_W}" height="${SLIDE_H}" preserveAspectRatio="xMidYMid slice" xlink:href="${escAttr(href)}"/>`
    );
  }
  return `<rect x="0" y="0" width="${SLIDE_W}" height="${SLIDE_H}" fill="${fill ?? "#FFFFFF"}"/>`;
}

function renderElement(el: SlideElement, charts: ChartCache): string {
  let inner: string;
  switch (el.type) {
    case "text":
      inner = renderText(el);
      break;
    case "shape":
      inner = renderShape(el);
      break;
    case "image":
      inner = renderImage(el);
      break;
    case "line":
    case "connector":
      inner = renderLine(el);
      break;
    case "table":
      inner = renderTable(el);
      break;
    case "chart":
      inner = charts.get(el.id) ?? "";
      break;
    case "diagram":
      inner = renderDiagram(el);
      break;
    case "group":
      inner = el.children
        .slice()
        .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
        .map((c) => renderElement(c, charts))
        .join("");
      break;
    default:
      inner = ""; // icon / embed / unknown — nothing visual to draw
  }
  if (!inner) return "";
  if (el.rotation) {
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    return `<g transform="rotate(${el.rotation} ${round(cx)} ${round(cy)})">${inner}</g>`;
  }
  return inner;
}

// -- text --------------------------------------------------------------------

function renderText(el: Extract<SlideElement, { type: "text" }>): string {
  const parts: string[] = [];
  if (el.background && solidFrom(el.background)) {
    parts.push(
      `<rect x="${round(el.x)}" y="${round(el.y)}" width="${round(el.w)}" height="${round(el.h)}" ` +
        `fill="${solidFrom(el.background)}"${el.borderRadius ? ` rx="${round(el.borderRadius)}"` : ""}/>`
    );
  }

  const fontSize = el.fontSize || 18;
  const lineH = (el.lineHeight && el.lineHeight > 0 ? el.lineHeight : 1.2) * fontSize;
  const padL = el.padding?.l ?? 8;
  const padR = el.padding?.r ?? 8;
  const padT = el.padding?.t ?? 4;
  const padB = el.padding?.b ?? 4;
  const boxW = Math.max(1, el.w - padL - padR);

  // Build paragraphs → wrapped lines (paragraph-level styling; good enough for
  // QA overflow/overlap detection while keeping all the text).
  const paragraphs = textParagraphs(el);
  const lines: { text: string; color: string; align: string }[] = [];
  for (const p of paragraphs) {
    const align = p.align ?? el.align ?? "left";
    const color = p.color ?? el.color ?? "#000000";
    const text = p.text;
    if (text === "") {
      lines.push({ text: "", color, align });
      continue;
    }
    for (const line of wrap(text, boxW, fontSize)) lines.push({ text: line, color, align });
  }

  const totalH = lines.length * lineH;
  const innerTop = el.y + padT;
  const innerBottom = el.y + el.h - padB;
  let startY: number;
  if (el.vAlign === "middle") startY = (innerTop + innerBottom) / 2 - totalH / 2 + fontSize * 0.8;
  else if (el.vAlign === "bottom") startY = innerBottom - totalH + fontSize * 0.8;
  else startY = innerTop + fontSize * 0.8;

  const weight = el.fontWeight && el.fontWeight >= 600 ? "bold" : "normal";
  const family = el.fontFamily || "sans-serif";
  lines.forEach((ln, i) => {
    if (ln.text === "") return;
    const y = startY + i * lineH;
    let x: number;
    let anchor: string;
    if (ln.align === "center") {
      x = el.x + el.w / 2;
      anchor = "middle";
    } else if (ln.align === "right") {
      x = el.x + el.w - padR;
      anchor = "end";
    } else {
      x = el.x + padL;
      anchor = "start";
    }
    parts.push(
      `<text x="${round(x)}" y="${round(y)}" font-family="${escAttr(family)}" font-size="${round(fontSize)}" ` +
        `font-weight="${weight}"${el.italic ? ` font-style="italic"` : ""} fill="${ln.color}" ` +
        `text-anchor="${anchor}"${el.underline ? ` text-decoration="underline"` : ""}>${escText(ln.text)}</text>`
    );
  });
  return parts.join("");
}

function textParagraphs(
  el: Extract<SlideElement, { type: "text" }>
): { text: string; align?: "left" | "center" | "right"; color?: string }[] {
  if (el.paragraphs && el.paragraphs.length) {
    return el.paragraphs.map((p) => ({
      text: p.runs?.length ? p.runs.map((r) => r.text).join("") : p.text,
      align: p.align,
      color: firstRunColor(p.runs),
    }));
  }
  if (el.runs && el.runs.length) {
    return [{ text: el.runs.map((r) => r.text).join(""), color: firstRunColor(el.runs) }];
  }
  // Plain text may itself contain newlines.
  return (el.text ?? "").split("\n").map((text) => ({ text }));
}

function firstRunColor(runs: TextRun[] | undefined): string | undefined {
  return runs?.find((r) => r.color)?.color;
}

function wrap(text: string, boxW: number, fontSize: number): string[] {
  const charW = fontSize * 0.52; // rough average glyph advance
  const maxChars = Math.max(1, Math.floor(boxW / charW));
  const out: string[] = [];
  for (const hardLine of text.split("\n")) {
    if (hardLine.length <= maxChars) {
      out.push(hardLine);
      continue;
    }
    let cur = "";
    for (const word of hardLine.split(/\s+/)) {
      const candidate = cur ? `${cur} ${word}` : word;
      if (candidate.length > maxChars && cur) {
        out.push(cur);
        cur = word;
      } else {
        cur = candidate;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

// -- shape -------------------------------------------------------------------

function renderShape(el: Extract<SlideElement, { type: "shape" }>): string {
  const fill = solidFrom(el.fill) ?? "none";
  const stroke = el.stroke ? solidFrom(el.stroke) : undefined;
  const strokeAttr = stroke
    ? ` stroke="${stroke}" stroke-width="${round(el.strokeWidth ?? 1)}"`
    : "";

  if (el.path?.d) {
    const sx = el.w / Math.max(1, el.path.viewW);
    const sy = el.h / Math.max(1, el.path.viewH);
    return (
      `<g transform="translate(${round(el.x)} ${round(el.y)}) scale(${sx} ${sy})">` +
      `<path d="${escAttr(el.path.d)}" fill="${fill}" fill-rule="${el.path.fillRule ?? "nonzero"}"${strokeAttr}/>` +
      `</g>`
    );
  }

  const { x, y, w, h } = el;
  switch (el.shape) {
    case "circle":
      return `<ellipse cx="${round(x + w / 2)}" cy="${round(y + h / 2)}" rx="${round(w / 2)}" ry="${round(h / 2)}" fill="${fill}"${strokeAttr}/>`;
    case "triangle":
      return polygon([[x + w / 2, y], [x + w, y + h], [x, y + h]], fill, strokeAttr);
    case "diamond":
      return polygon([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]], fill, strokeAttr);
    case "star":
      return polygon(starPoints(x, y, w, h), fill, strokeAttr);
    case "rounded": {
      const r = el.radius ?? Math.min(w, h) * 0.12;
      return `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" rx="${round(r)}" fill="${fill}"${strokeAttr}/>`;
    }
    default:
      return `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" fill="${fill}"${strokeAttr}/>`;
  }
}

function polygon(pts: number[][], fill: string, strokeAttr: string): string {
  const p = pts.map(([px, py]) => `${round(px)},${round(py)}`).join(" ");
  return `<polygon points="${p}" fill="${fill}"${strokeAttr}/>`;
}

function starPoints(x: number, y: number, w: number, h: number): number[][] {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const outer = Math.min(w, h) / 2;
  const inner = outer * 0.4;
  const pts: number[][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

// -- image -------------------------------------------------------------------

function renderImage(el: Extract<SlideElement, { type: "image" }>): string {
  const preserve =
    el.fit === "contain" ? "xMidYMid meet" : el.fit === "fill" ? "none" : "xMidYMid slice";
  const clip = el.radius
    ? ` clip-path="inset(0 round ${round(el.radius)}px)"`
    : "";
  return (
    `<image x="${round(el.x)}" y="${round(el.y)}" width="${round(el.w)}" height="${round(el.h)}" ` +
    `preserveAspectRatio="${preserve}"${clip} xlink:href="${escAttr(el.src)}"/>`
  );
}

// -- line / connector --------------------------------------------------------

function renderLine(el: Extract<SlideElement, { type: "line" | "connector" }>): string {
  const stroke = solidFrom((el as { stroke?: string }).stroke ?? "#000000") ?? "#000000";
  const w = (el as { strokeWidth?: number }).strokeWidth ?? 2;
  return `<line x1="${round(el.x)}" y1="${round(el.y)}" x2="${round(el.x + el.w)}" y2="${round(el.y + el.h)}" stroke="${stroke}" stroke-width="${round(w)}"/>`;
}

// -- table -------------------------------------------------------------------

function renderTable(el: Extract<SlideElement, { type: "table" }>): string {
  const rows = el.rows ?? [];
  const nRows = rows.length;
  const nCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (!nRows || !nCols) return "";
  const colW = el.w / nCols;
  const rowH = el.h / nRows;
  const fontSize = el.fontSize || 14;
  const parts: string[] = [];
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const cx = el.x + c * colW;
      const cy = el.y + r * rowH;
      const isHeader = el.hasHeader && r === 0;
      const fill = solidFrom(isHeader ? el.headerFill : el.rowFill) ?? "#FFFFFF";
      parts.push(
        `<rect x="${round(cx)}" y="${round(cy)}" width="${round(colW)}" height="${round(rowH)}" ` +
          `fill="${fill}" stroke="${solidFrom(el.borderColor ?? "#CCCCCC") ?? "#CCCCCC"}" stroke-width="1"/>`
      );
      const text = rows[r]?.[c] ?? "";
      if (text) {
        const color = solidFrom(isHeader ? el.headerTextColor ?? el.textColor : el.textColor) ?? "#000000";
        parts.push(
          `<text x="${round(cx + 8)}" y="${round(cy + rowH / 2 + fontSize * 0.35)}" ` +
            `font-size="${round(fontSize)}" fill="${color}">${escText(text)}</text>`
        );
      }
    }
  }
  return parts.join("");
}

// -- diagram -----------------------------------------------------------------

function renderDiagram(el: Extract<SlideElement, { type: "diagram" }>): string {
  const primitives = layoutDiagram(el);
  const fontSize = el.fontSize ?? 18;
  const parts: string[] = [];
  for (const p of primitives) {
    if (p.kind === "box") {
      const rx = p.shape === "roundRect" ? 8 : p.shape === "ellipse" ? Math.min(p.w, p.h) / 2 : 0;
      parts.push(
        `<rect x="${round(el.x + p.x)}" y="${round(el.y + p.y)}" width="${round(p.w)}" height="${round(p.h)}" ` +
          `rx="${round(rx)}" fill="${solidFrom(p.fill) ?? "#888888"}"/>`
      );
      if (p.text) {
        parts.push(
          `<text x="${round(el.x + p.x + p.w / 2)}" y="${round(el.y + p.y + p.h / 2 + fontSize * 0.35)}" ` +
            `font-size="${round(fontSize)}" fill="${solidFrom(p.textColor) ?? "#FFFFFF"}" text-anchor="middle">${escText(p.text)}</text>`
        );
      }
    } else {
      parts.push(
        `<line x1="${round(el.x + p.x1)}" y1="${round(el.y + p.y1)}" x2="${round(el.x + p.x2)}" y2="${round(el.y + p.y2)}" ` +
          `stroke="${solidFrom(p.stroke) ?? "#888888"}" stroke-width="2"/>`
      );
    }
  }
  return parts.join("");
}

// -- rasterisation -----------------------------------------------------------

async function defaultRasterize(
  svg: string,
  width: number,
  _height: number,
  _format: "png" | "jpeg"
): Promise<Uint8Array> {
  try {
    // Non-literal specifier so TS/bundlers don't hard-resolve the optional dep;
    // it's only loaded when the host hasn't injected its own rasteriser.
    const spec = ["@resvg", "resvg-js"].join("/");
    const mod = (await import(/* @vite-ignore */ spec)) as {
      Resvg: new (svg: string, opts?: unknown) => { render(): { asPng(): Uint8Array } };
    };
    const resvg = new mod.Resvg(svg, { fitTo: { mode: "width", value: width } });
    return resvg.render().asPng();
  } catch {
    throw new Error(
      "renderDeckToImages: no SVG rasteriser available. Pass `opts.rasterizeSvg` " +
        "(e.g. a @resvg/resvg-js wrapper), or install @resvg/resvg-js. " +
        "`renderDeckToSvg` returns the SVGs directly if you want to rasterise yourself."
    );
  }
}

// -- colour / string helpers -------------------------------------------------

function isImageRef(s: string | undefined): boolean {
  return !!s && (s.startsWith("data:image") || /^url\(/i.test(s) || /^https?:\/\//i.test(s));
}

function imageHref(s: string): string {
  const m = /^url\(["']?(.*?)["']?\)$/i.exec(s);
  return m ? m[1] : s;
}

/** Best-effort single colour for SVG: pass hex through, pull the first hex out
 *  of a CSS gradient, map `transparent` → none, ignore image refs. */
function solidFrom(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (v === "transparent" || v === "none") return "none";
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return v;
  if (/^rgb/i.test(v)) return v;
  const hex = /#[0-9a-fA-F]{3,8}/.exec(v);
  if (hex) return hex[0];
  if (isImageRef(v)) return undefined;
  return v; // named colour (e.g. "white")
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
