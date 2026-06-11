import pptxgen from "pptxgenjs";
import JSZip from "jszip";
import type {
  Deck,
  Slide,
  SlideElement,
  TextElement,
  ShapeElement,
  ShapeKind,
  ImageElement,
  LineElement,
  TableElement,
  CellBorderSide,
  IconElement,
  EmbedElement,
  ChartElement,
  ConnectorElement,
  GroupElement,
  DiagramElement,
  UnknownElement,
} from "@/lib/types";
import { pxToInches, pxToPoints } from "./units";
import {
  EMU_PER_PX,
  EMU_PER_INCH,
  PPTX_SLIDE_W_INCHES,
  PPTX_SLIDE_H_INCHES,
} from "./units";
import { SLIDE_W, SLIDE_H } from "@/lib/types";
import {
  SOURCE_PPTX,
  SOURCE_SLIDE_PATH,
  getCachedSourceBuffer,
  getElementSource,
  snapshotElement,
} from "./pptxToDeck";
import {
  synthesiseShape,
  synthesiseGroup,
  synthesiseChart,
  synthesiseConnector,
  synthesiseImage,
  synthesiseDiagram,
  synthesiseSlideBg,
  synthesiseEmbeddedFonts,
  effectLstXml,
  parseFill,
  freshNvId,
  RID_MARKER_RE,
  slidewiseShapeName,
  type MediaPayload,
  type SynthChartResult,
} from "./pptxWriters";

/**
 * Serialize a Slidewise Deck to a real PPTX blob.
 *
 * Native element types (text, shape, image, line, table, icon, embed)
 * are written through pptxgenjs. UnknownElement (charts, SmartArt,
 * group shapes, OLE, math, anything else the importer couldn't model)
 * is preserved verbatim: we keep the original PPTX bytes on the Deck
 * during parse, and after pptxgenjs finishes, we post-process the
 * generated zip to inject the preserved OOXML — plus any media those
 * fragments referenced — into the matching slides. The fragments
 * inside an UnknownElement keep their original rIds; we copy the
 * corresponding rels entries (and media payloads) from the source
 * zip, renumbering rIds as needed to avoid clashes with what
 * pptxgenjs already wrote.
 */
/**
 * Optional knobs for the serializer.
 *
 * `source` lets the host pass the original PPTX bytes alongside the deck so
 * UnknownElement preservation can run even when the deck object has been
 * cloned, spread, JSON-rehydrated, or otherwise stripped of the
 * non-enumerable attachment that `parsePptx` stamps on. Hosts running an
 * editor (Zustand snapshots, immutable updates, localStorage rehydrate)
 * should pass `source` explicitly.
 */
export interface SerializeOptions {
  source?: Blob | ArrayBuffer | Uint8Array;
  /**
   * Emit a PowerPoint template (`.potx`) instead of a presentation (`.pptx`).
   * The two share an identical OOXML package; the only on-disk difference is
   * the main part's content type in `[Content_Types].xml`
   * (`…presentationml.template.main+xml` vs `…presentation.main+xml`) and the
   * Blob's MIME type. When left `undefined`, template-ness is inferred from the
   * source archive so a `.potx` parsed by `parsePptx` round-trips back to a
   * `.potx`; pass `true`/`false` to force the output kind.
   */
  asTemplate?: boolean;
  /**
   * Machine-readable diagnostics sink. Invoked (zero or more times) during
   * serialization when something degrades the output in a way the host may
   * want to surface — most importantly `"chrome-skipped"`, emitted when a
   * `source` template's chrome (masters / layouts / theme / fonts) could not
   * be carried over because its slide size was unreadable, so the deck falls
   * back to generic pptxgenjs chrome. Lets a host detect the degradation
   * instead of only seeing it in the console.
   */
  onWarning?: (warning: SerializeWarning) => void;
  /**
   * Rasterize an SVG to PNG bytes. pptxgenjs emits SVG images as a dual blip
   * (`<a:blip>` raster + `<asvg:svgBlip>` vector) but writes the SVG *source*
   * into the `.png` raster fallback; the fallback must be a real PNG or strict
   * consumers (Google Slides, LibreOffice, thumbnail/raster renderers, OOXML
   * validators) reject the package.
   *
   * In the browser the fallback is rasterized via canvas automatically. On the
   * headless Node/SSR path there is no canvas, so without this hook the
   * fallback degrades to a 1×1 transparent PNG (valid, but the image is blank
   * outside PowerPoint). Provide a rasterizer to emit a faithful fallback —
   * the library stays dependency-free and the host chooses the engine:
   *
   * ```ts
   * import { Resvg } from "@resvg/resvg-js";
   * serializeDeck(deck, {
   *   source,
   *   rasterizeSvg: (svg) => new Resvg(Buffer.from(svg)).render().asPng(),
   * });
   * ```
   *
   * Return `null`/`undefined` (or throw — it's caught) to defer to the next
   * fallback. Output that isn't valid PNG bytes is ignored. May be sync or async.
   */
  rasterizeSvg?: SvgRasterizer;
}

/**
 * Host-provided SVG→PNG rasterizer (see {@link SerializeOptions.rasterizeSvg}).
 * Receives the SVG bytes, returns PNG bytes (or null to defer to the built-in
 * fallback). Sync or async.
 */
export type SvgRasterizer = (
  svg: Uint8Array
) => Uint8Array | null | undefined | Promise<Uint8Array | null | undefined>;

/** A non-fatal serialization diagnostic delivered to `SerializeOptions.onWarning`. */
export interface SerializeWarning {
  /**
   * - `"chrome-skipped"` — the source template's chrome was not preserved
   *   (slide size unreadable / aspect mismatch); the deck uses generic chrome.
   *   `sourceAspect` / `outputAspect` carry the ratios when known.
   * - `"layout-unresolved"` — a slide's `sourceLayoutId` matched no layout in
   *   `deck.layouts` *and* no `ppt/slideLayouts/<id>.xml` in the source
   *   archive; the slide falls back to the first source layout. `slideIndex`
   *   and `layoutId` identify it.
   * - `"element-write-failed"` — a single element threw while being written
   *   and was skipped; the rest of the slide is intact.
   */
  code: "chrome-skipped" | "layout-unresolved" | "element-write-failed";
  /** Human-readable explanation (also logged to the console). */
  message: string;
  /** Output slide index, when the warning is slide- or element-scoped. */
  slideIndex?: number;
  /** Element id, when the warning is element-scoped. */
  elementId?: string;
  /** Element type, when the warning is element-scoped. */
  elementType?: string;
  /** Unresolved `sourceLayoutId`, for `"layout-unresolved"`. */
  layoutId?: string;
  /** Source deck aspect ratio (cx/cy), for `"chrome-skipped"` when readable. */
  sourceAspect?: number;
  /** Output deck aspect ratio (cx/cy), for `"chrome-skipped"` when readable. */
  outputAspect?: number;
}

/**
 * Per-serialize-call registry of synthesised OOXML the post-processor needs
 * to inject. Populated by `addSlide`, drained by `preserveUnknowns`. Reset
 * at the start of each `serializeDeck` so concurrent calls don't bleed.
 */
/**
 * One synthesised spTree child plus the z-anchor that decides where it lands.
 * `after` is the element id of the pptxgenjs-emitted node this item should sit
 * directly on top of (the highest-z model element below it) — or `null` when
 * the item is below every pptxgenjs node and belongs at the back. Honouring
 * this is what keeps a synth chart / custGeom "svg" / connector from being
 * forced behind the background cards pptxgenjs wrote on top of it.
 */
type SynthItem =
  | { kind: "shape"; xml: string; after: string | null }
  | { kind: "chart"; result: SynthChartResult; after: string | null };

interface SynthSlideEntry {
  /** Synthesised shapes / groups / connectors / charts, in z (emission) order. */
  items: SynthItem[];
  /** Media payloads to drop into `ppt/media/` referenced from the slide. */
  media: MediaPayload[];
  /** Effect XML to splice into pptxgenjs-emitted shapes by `cNvPr.name`. */
  effectsByName: Map<string, string>;
  /**
   * Per-run letter-case (`<a:rPr cap="…">`) to splice into a pptxgenjs-emitted
   * text shape by `cNvPr.name`. pptxgenjs has no `cap` option, so it's applied
   * in post-process. One entry per emitted run (`<a:r>`), in document order;
   * `null` leaves that run untouched.
   */
  capRunsByName: Map<string, (("all" | "small") | null)[]>;
}

const synthBySlide = new Map<number, SynthSlideEntry>();
function synthForSlide(i: number): SynthSlideEntry {
  let e = synthBySlide.get(i);
  if (!e) {
    e = {
      items: [],
      media: [],
      effectsByName: new Map(),
      capRunsByName: new Map(),
    };
    synthBySlide.set(i, e);
  }
  return e;
}

export async function serializeDeck(
  deck: Deck,
  options: SerializeOptions = {}
): Promise<Blob> {
  synthBySlide.clear();

  const pptx = new pptxgen();
  pptx.title = deck.title || "Untitled";

  // Resolve the source once (reused by preserveUnknowns) and derive the output
  // slide size from it. A non-16:9 template (4:3, 16:10, custom) is emitted at
  // its own size with a custom layout, and model-emitted element coordinates
  // are mapped back out of the fixed 1920×1080 authoring canvas into the
  // source's coordinate space (the inverse of the parse-time letterbox fit).
  const sourceBuffer = await resolveSource(deck, options.source);
  const transform = await computeSerializeTransform(sourceBuffer);
  applyLayout(pptx, transform);

  for (let i = 0; i < deck.slides.length; i++) {
    addSlide(pptx, deck.slides[i], i, transform, options.onWarning);
  }

  // Use arraybuffer (universal: works in Node + browser, accepted by JSZip
  // directly) and wrap to Blob only when we're done post-processing.
  const generated = (await pptx.write({
    outputType: "arraybuffer",
  })) as ArrayBuffer;
  return preserveUnknowns(
    generated,
    deck,
    sourceBuffer,
    options.asTemplate,
    options.onWarning,
    options.rasterizeSvg
  );
}

function addSlide(
  pptx: pptxgen,
  slide: Slide,
  slideIndex: number,
  transform: SerializeTransform,
  onWarning?: (warning: SerializeWarning) => void
): void {
  const s = pptx.addSlide();
  // pptxgenjs only understands flat-hex slide backgrounds. For richer forms
  // (gradients / image fills) we leave a sentinel hex here and overwrite the
  // emitted `<p:bg>` in post-process.
  s.background = { color: hexNoHash(extractSolidColor(slide.background)) };

  const synth = synthForSlide(slideIndex);
  const sorted = [...slide.elements].sort((a, b) => a.z - b.z);
  // The id of the most recent element that produced a pptxgenjs spTree node.
  // Synth items anchor after it so they interleave with pptxgenjs content at
  // the right z instead of being forced to the back of the slide.
  let lastNodeId: string | null = null;
  for (const rawEl of sorted) {
    // Skip elements whose imported OOXML survived this far AND haven't
    // been edited — the post-process step replays their source XML
    // verbatim, sidestepping pptxgenjs's lossy translation of
    // gradient / custGeom / backing fields. Done BEFORE the transform so the
    // verbatim-source check sees the untouched element.
    if (isPristineImportedElement(rawEl)) continue;
    // Map model-emitted coordinates back into the source coordinate space
    // (no-op for 16:9 / source-less decks — `untransformElement` returns the
    // same object when the transform is the identity).
    const el = untransformElement(rawEl, transform);
    if (shouldSynthesise(el)) {
      synthesiseInto(synth, el, lastNodeId);
      continue;
    }
    try {
      addElement(s, el, synth);
      // Track the anchor only for elements that actually emit a pptxgenjs
      // node (chart-with-ooxml and unknown are no-ops handled elsewhere).
      if (emitsPptxgenjsNode(el)) lastNodeId = el.id;
    } catch (err) {
      const message = `[slidewise/pptx] failed to write element ${el.id} (${el.type}): ${String(err)}`;
      console.warn(message, err);
      onWarning?.({
        code: "element-write-failed",
        message,
        slideIndex,
        elementId: el.id,
        elementType: el.type,
      });
    }
  }
}

/** Element types `addElement` turns into a real pptxgenjs spTree node (so a
 *  later synth item can anchor on top of it). Charts that carry preserved
 *  OOXML and unknowns are injected elsewhere and emit nothing here. */
function emitsPptxgenjsNode(el: SlideElement): boolean {
  switch (el.type) {
    case "text":
    case "shape":
    case "image":
    case "line":
    case "table":
    case "icon":
    case "embed":
      return true;
    default:
      return false;
  }
}

/**
 * How model-emitted element coordinates map from the fixed 1920×1080 authoring
 * canvas onto the output slide. For a 16:9 (or source-less) deck this is the
 * identity and `LAYOUT_WIDE` is used unchanged. For a non-16:9 source we emit
 * the slide at the source's real size and invert the parse-time fit:
 *   sourcePx = (canvasPx - offset) / scale
 * which is exactly the inverse of `computeFit`'s `canvasPx = sourcePx*scale +
 * offset`. `scale` also un-does the font/stroke scaling the importer applied.
 */
interface SerializeTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** Output slide width / height in inches. */
  widthIn: number;
  heightIn: number;
  /** Whether a custom (non-LAYOUT_WIDE) layout is needed. */
  custom: boolean;
}

const IDENTITY_TRANSFORM: SerializeTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  widthIn: PPTX_SLIDE_W_INCHES,
  heightIn: PPTX_SLIDE_H_INCHES,
  custom: false,
};

const SIXTEEN_NINE = 16 / 9;

async function computeSerializeTransform(
  sourceBuffer?: ArrayBuffer
): Promise<SerializeTransform> {
  if (!sourceBuffer) return IDENTITY_TRANSFORM;
  try {
    const zip = await JSZip.loadAsync(sourceBuffer);
    const pres = await zip.file("ppt/presentation.xml")?.async("string");
    if (!pres) return IDENTITY_TRANSFORM;
    const sz = parseSldSz(pres);
    if (!sz || !sz.cx || !sz.cy) return IDENTITY_TRANSFORM;
    const ratio = sz.cx / sz.cy;
    // Aspect ratio already 16:9 → the existing LAYOUT_WIDE path is correct and
    // proven (any 16:9 size renders proportionally on the 13.333×7.5 slide).
    // Leave it exactly as-is to avoid perturbing the common case.
    if (Math.abs(ratio - SIXTEEN_NINE) / SIXTEEN_NINE < 0.01) {
      return IDENTITY_TRANSFORM;
    }
    // Mirror computeFit (parse-time) so we can invert it.
    const sourceWpx = sz.cx / EMU_PER_PX;
    const sourceHpx = sz.cy / EMU_PER_PX;
    const scale = Math.min(SLIDE_W / sourceWpx, SLIDE_H / sourceHpx);
    const offsetX = Math.round((SLIDE_W - sourceWpx * scale) / 2);
    const offsetY = Math.round((SLIDE_H - sourceHpx * scale) / 2);
    return {
      scale,
      offsetX,
      offsetY,
      widthIn: sz.cx / EMU_PER_INCH,
      heightIn: sz.cy / EMU_PER_INCH,
      custom: true,
    };
  } catch {
    return IDENTITY_TRANSFORM;
  }
}

function applyLayout(pptx: pptxgen, t: SerializeTransform): void {
  if (!t.custom) {
    pptx.layout = "LAYOUT_WIDE"; // 13.333 × 7.5 in
    return;
  }
  // defineLayout takes inches; pptxgenjs writes round(inches*914400) EMU, which
  // is exact here because widthIn/heightIn = integer EMU / 914400.
  pptx.defineLayout({
    name: "SLIDEWISE_SRC",
    width: t.widthIn,
    height: t.heightIn,
  });
  pptx.layout = "SLIDEWISE_SRC";
}

/**
 * Return a shallow copy of `el` with its geometry (and font/stroke sizes)
 * mapped from the authoring canvas into the output slide's coordinate space.
 * Returns the SAME object for the identity transform so 16:9 / source-less
 * decks are byte-for-byte unchanged (and the pristine-snapshot check upstream
 * still matches).
 */
function untransformElement<T extends SlideElement>(
  el: T,
  t: SerializeTransform
): T {
  if (!t.custom) return el;
  const next = {
    ...el,
    x: (el.x - t.offsetX) / t.scale,
    y: (el.y - t.offsetY) / t.scale,
    w: el.w / t.scale,
    h: el.h / t.scale,
  } as T;
  // Un-scale type-specific sizes the importer scaled by `fit.scale`.
  if (t.scale !== 1) {
    if (next.type === "text") {
      const txt = next as TextElement;
      txt.fontSize = txt.fontSize / t.scale;
      if (txt.runs) {
        txt.runs = txt.runs.map((r) =>
          r.fontSize != null ? { ...r, fontSize: r.fontSize / t.scale } : r
        );
      }
    } else if (next.type === "shape" || next.type === "line") {
      const s = next as ShapeElement | LineElement;
      if (s.strokeWidth != null) s.strokeWidth = s.strokeWidth / t.scale;
    } else if (next.type === "connector") {
      const c = next as ConnectorElement;
      c.strokeWidth = c.strokeWidth / t.scale;
    } else if (next.type === "diagram") {
      const d = next as DiagramElement;
      if (d.fontSize != null) d.fontSize = d.fontSize / t.scale;
    }
  }
  return next;
}

/**
 * Does this element need synthesised OOXML rather than pptxgenjs's emitter?
 * The synth path handles gradient/image fills, custGeom paths, in-app charts,
 * groups — everything the public API allows that pptxgenjs would silently
 * collapse to a solid colour or drop entirely.
 */
function shouldSynthesise(el: SlideElement): boolean {
  if (el.type === "shape") {
    if (el.path) return true;
    const parsed = parseFill(el.fill);
    if (parsed && (parsed.kind === "linear" || parsed.kind === "radial" || parsed.kind === "image")) {
      return true;
    }
    return false;
  }
  if (el.type === "group") return true;
  if (el.type === "connector") return true;
  if (el.type === "diagram") return true;
  if (el.type === "chart" && !el.ooxmlXml) return true;
  // A cropped / rounded image needs a hand-written `<p:pic>`: pptxgenjs's
  // sizing emits its own `<a:srcRect>` (fighting a user crop) and can't express
  // a corner radius. Only inlineable data-URL sources take this path; remote
  // URLs keep pptxgenjs's (crop/radius is dropped for those — see addImage).
  if (
    el.type === "image" &&
    (hasCrop(el.crop) || (el.radius ?? 0) > 0) &&
    isDataUrl(el.src)
  ) {
    return true;
  }
  return false;
}

function hasCrop(crop: ImageElement["crop"] | undefined): boolean {
  return (
    !!crop && (crop.l > 0 || crop.r > 0 || crop.t > 0 || crop.b > 0)
  );
}

function synthesiseInto(
  synth: SynthSlideEntry,
  el: SlideElement,
  after: string | null
): void {
  if (el.type === "shape") {
    // Cross-process replay: an unedited custGeom shape carries its verbatim
    // source `<p:sp>` in the deck JSON (see `stampPristineOoxml`). Replaying
    // it preserves the exact source winding/geometry that synthesis can't —
    // this is what un-blanks complex vectors when the import-time source
    // registry isn't available (parse + serialize in different processes).
    const verbatim = pristineShapeXml(el);
    if (verbatim) {
      synth.items.push({ kind: "shape", xml: verbatim, after });
      return;
    }
    const out = synthesiseShape(el);
    synth.items.push({ kind: "shape", xml: out.xml, after });
    for (const m of out.media) synth.media.push(m);
    return;
  }
  if (el.type === "group") {
    const out = synthesiseGroup(el as GroupElement, (child) =>
      renderGroupChild(child)
    );
    synth.items.push({ kind: "shape", xml: out.xml, after });
    for (const m of out.media) synth.media.push(m);
    return;
  }
  if (el.type === "chart") {
    const out = synthesiseChart(el as ChartElement);
    synth.items.push({ kind: "chart", result: out, after });
    return;
  }
  if (el.type === "image") {
    const out = synthesiseImage(el as ImageElement);
    if (out) {
      synth.items.push({ kind: "shape", xml: out.xml, after });
      for (const m of out.media) synth.media.push(m);
    }
    return;
  }
  if (el.type === "diagram") {
    const out = synthesiseDiagram(el as DiagramElement);
    synth.items.push({ kind: "shape", xml: out.xml, after });
    for (const m of out.media) synth.media.push(m);
    return;
  }
  if (el.type === "connector") {
    const out = synthesiseConnector(el as ConnectorElement);
    synth.items.push({ kind: "shape", xml: out.xml, after });
    for (const m of out.media) synth.media.push(m);
    return;
  }
}

/**
 * Verbatim `<p:sp>` for a custGeom shape that carries deck-JSON-persisted
 * source OOXML and hasn't been edited. Returns null when there's no pristine
 * XML or the element diverged from its import snapshot (then the caller
 * synthesises from `path.d`). The source `cNvPr/@id` is rewritten to a fresh
 * high id so it can't collide with whatever pptxgenjs allocated in the spTree.
 *
 * NB: same-process serialize never reaches here for these shapes — they're
 * caught earlier by `isPristineImportedElement` (registry hit) and replayed
 * through the source archive. This path is the cross-process fallback.
 */
function pristineShapeXml(el: SlideElement): string | null {
  if (el.type !== "shape" || !el.pristineOoxml) return null;
  if (snapshotElement(el) !== el.pristineOoxml.snapshot) return null;
  return el.pristineOoxml.xml.replace(
    /(<p:cNvPr\b[^>]*\bid=")\d+(")/,
    `$1${freshNvId()}$2`
  );
}

/**
 * Render a single child for `<p:grpSp>`. We only synthesise shapes/charts
 * inside groups for v1 — text / image / line children remain renderable
 * inside the group at the *renderer* layer, but the PPTX writer emits them
 * as solid-fill rect placeholders so the group has a valid spTree. This is
 * the documented "deferred sub-case" for PR 5.
 */
function renderGroupChild(
  child: SlideElement
): { xml: string; media: MediaPayload[] } | null {
  if (child.type === "shape") {
    return synthesiseShape(child);
  }
  if (child.type === "group") {
    return synthesiseGroup(child as GroupElement, (c) => renderGroupChild(c));
  }
  // Other element types inside a group: fall back to a transparent rect so
  // the group's child list stays valid. The text/image content is lost on
  // round-trip — that's the PR-5 follow-up.
  return null;
}

function isPristineImportedElement(el: SlideElement): boolean {
  const src = getElementSource(el.id);
  if (!src) return false;
  return src.snapshot === snapshotElement(el);
}

function addElement(
  s: pptxgen.Slide,
  el: SlideElement,
  synth: SynthSlideEntry
): void {
  switch (el.type) {
    case "text":
      addText(s, el, synth);
      return;
    case "shape":
      addShape(s, el, synth);
      return;
    case "image":
      addImage(s, el);
      return;
    case "line":
      addLine(s, el, synth);
      return;
    case "table":
      addTable(s, el);
      return;
    case "icon":
      addIcon(s, el);
      return;
    case "embed":
      addEmbed(s, el);
      return;
    case "chart":
      // Charts round-trip via their preserved <p:graphicFrame> OOXML,
      // re-injected by preserveUnknowns(). Editing live chart data inside
      // Slidewise isn't yet wired up to a chart-XML writer; until then we
      // re-emit the source verbatim so the chart and its embedded Excel
      // survive open/save.
      return;
    case "group":
      // Groups are handled by the synth path before reaching here.
      return;
    case "connector":
      // Connectors are handled by the synth path (synthesiseConnector).
      return;
    case "unknown":
      // Preserved by preserveUnknowns() after pptxgenjs writes the zip.
      // The post-process step injects el.ooxmlXml into the matching
      // slide's <p:spTree> and copies any media the fragment referenced.
      return;
  }
}

/** Pull a solid colour out of a fill string if there is one, otherwise
 *  `#FFFFFF` so the synth path's `<p:bg>` replacement has something benign
 *  to overwrite. */
function extractSolidColor(fill: string | undefined): string {
  const parsed = parseFill(fill);
  if (parsed && parsed.kind === "solid") return parsed.color;
  return "#FFFFFF";
}

function geometry(el: SlideElement): {
  x: number;
  y: number;
  w: number;
  h: number;
  rotate?: number;
} {
  return {
    x: pxToInches(el.x),
    y: pxToInches(el.y),
    w: pxToInches(el.w),
    h: pxToInches(el.h),
    rotate: el.rotation || undefined,
  };
}

function addText(
  s: pptxgen.Slide,
  el: TextElement,
  synth: SynthSlideEntry
): void {
  // Tag the shape so the post-processor can splice effect XML by name.
  if (el.shadow || el.glow) {
    synth.effectsByName.set(
      slidewiseShapeName(el.id),
      effectLstXml(el.shadow, el.glow)
    );
  }
  // TextElement.background fills the text box's bounding rect (PPTX
  // importer sets this from layout-placeholder fills, AI-authored decks
  // use it for boxed-bullet / tinted-card layouts). pptxgenjs only
  // accepts solid hex via `fill`. Skip non-hex strings (gradients,
  // url(...)) — those rare cases need a synth shape underlay, which is
  // PR 2 territory and not common on text boxes.
  const bgHex =
    el.background && /^#[0-9a-fA-F]{6}$/.test(el.background)
      ? hexNoHash(el.background)
      : undefined;
  const baseOpts = {
    ...geometry(el),
    fontFace: el.fontFamily,
    objectName: slidewiseShapeName(el.id),
    fontSize: pxToPoints(el.fontSize),
    color: hexNoHash(el.color),
    bold: el.fontWeight >= 600,
    italic: el.italic,
    underline: el.underline ? ({ style: "sng" } as const) : undefined,
    strike: el.strike ? ("sngStrike" as const) : undefined,
    align: el.align,
    valign: el.vAlign,
    fill: bgHex ? { color: bgHex } : undefined,
    charSpacing: el.letterSpacing
      ? Math.round(el.letterSpacing * 100)
      : undefined,
    paraSpaceBefore: 0,
    paraSpaceAfter: 0,
  };

  if (!el.runs || !el.runs.length) {
    s.addText(el.text, baseOpts);
    return;
  }

  // Multi-run: pptxgenjs accepts an array of {text, options} objects and emits
  // them as separate <a:r> within the same <a:p>. A run whose text contains
  // "\n" is split so each piece becomes its own paragraph (we use a per-run
  // `breakLine` flag on the trailing pieces).
  const items: pptxgen.TextProps[] = [];
  // One cap entry per emitted run (pptxgenjs emits one `<a:r>` per item), so
  // the post-process splice can re-apply `<a:rPr cap>` positionally — pptxgenjs
  // drops the case transform otherwise.
  const caps: (("all" | "small") | null)[] = [];
  for (const r of el.runs) {
    const pieces = r.text.split("\n");
    for (let i = 0; i < pieces.length; i++) {
      const isLast = i === pieces.length - 1;
      caps.push(r.cap ?? null);
      items.push({
        text: pieces[i],
        options: {
          fontFace: r.fontFamily ?? el.fontFamily,
          fontSize: pxToPoints(r.fontSize ?? el.fontSize),
          color: hexNoHash(r.color ?? el.color),
          bold: (r.fontWeight ?? el.fontWeight) >= 600,
          italic: r.italic ?? el.italic,
          underline: (r.underline ?? el.underline)
            ? ({ style: "sng" } as const)
            : undefined,
          strike: (r.strike ?? el.strike) ? ("sngStrike" as const) : undefined,
          highlight: r.highlight ? hexNoHash(r.highlight) : undefined,
          charSpacing: r.letterSpacing ?? el.letterSpacing
            ? Math.round((r.letterSpacing ?? el.letterSpacing) * 100)
            : undefined,
          breakLine: !isLast,
        },
      });
    }
  }
  if (caps.some((c) => c != null)) {
    synth.capRunsByName.set(slidewiseShapeName(el.id), caps);
  }
  s.addText(items, baseOpts);
}

const SHAPE_MAP: Record<ShapeKind, string> = {
  rect: "rect",
  rounded: "roundRect",
  circle: "ellipse",
  triangle: "triangle",
  diamond: "diamond",
  star: "star5",
};

function addShape(
  s: pptxgen.Slide,
  el: ShapeElement,
  synth: SynthSlideEntry
): void {
  const shapeName = SHAPE_MAP[el.shape] ?? "rect";
  if (el.shadow || el.glow) {
    synth.effectsByName.set(
      slidewiseShapeName(el.id),
      effectLstXml(el.shadow, el.glow)
    );
  }
  // A solid fill may carry alpha (e.g. `#RRGGBBAA`); map it to pptxgenjs's
  // `transparency` (0 opaque … 100 transparent) so flat translucent fills
  // don't render opaque. Gradient/image fills take the synth path instead.
  const solid = parseFill(el.fill);
  const fillAlpha = solid && solid.kind === "solid" ? solid.alpha : undefined;
  // pptxgenjs accepts shape names as strings; the typed ShapeType enum is
  // also exposed. Pass via `as unknown as` to bypass strict enum typing.
  s.addShape(shapeName as unknown as Parameters<typeof s.addShape>[0], {
    ...geometry(el),
    fill: {
      color: hexNoHash(extractSolidColor(el.fill)),
      ...(fillAlpha != null && fillAlpha < 1
        ? { transparency: Math.round((1 - fillAlpha) * 100) }
        : {}),
    },
    line: el.stroke
      ? {
          color: hexNoHash(el.stroke),
          width: el.strokeWidth ?? 1,
          dashType: shapeDashType(el),
        }
      : { type: "none" },
    rectRadius:
      el.shape === "rounded" && el.radius != null
        ? clamp01(el.radius / Math.min(el.w, el.h))
        : undefined,
    objectName: slidewiseShapeName(el.id),
  });
}

function lineDashType(
  el: LineElement
): "solid" | "dash" | "dashDot" | "lgDash" | "sysDash" | "sysDot" {
  const dt = el.dashType ?? (el.dashed ? "dash" : "solid");
  if (dt === "dot") return "sysDot";
  return dt;
}

function shapeDashType(
  el: ShapeElement
): "solid" | "dash" | "dashDot" | "lgDash" | "sysDash" | "sysDot" | undefined {
  // Our public `DashType` includes plain "dot" (OOXML allows it) but
  // pptxgenjs's enum doesn't; alias dot → sysDot so the legacy enum is happy.
  if (!el.dashType) return undefined;
  if (el.dashType === "dot") return "sysDot";
  return el.dashType;
}

function addImage(s: pptxgen.Slide, el: ImageElement): void {
  const opts: Parameters<typeof s.addImage>[0] = {
    ...geometry(el),
    objectName: slidewiseShapeName(el.id),
    sizing:
      el.fit === "cover"
        ? { type: "cover", w: pxToInches(el.w), h: pxToInches(el.h) }
        : el.fit === "contain"
          ? { type: "contain", w: pxToInches(el.w), h: pxToInches(el.h) }
          : undefined,
  };
  if (isDataUrl(el.src)) {
    opts.data = el.src;
  } else {
    opts.path = el.src;
  }
  s.addImage(opts);
}

function addLine(
  s: pptxgen.Slide,
  el: LineElement,
  synth: SynthSlideEntry
): void {
  if (el.shadow || el.glow) {
    synth.effectsByName.set(
      slidewiseShapeName(el.id),
      effectLstXml(el.shadow, el.glow)
    );
  }
  s.addShape(
    "line" as unknown as Parameters<typeof s.addShape>[0],
    {
      ...geometry(el),
      line: {
        color: hexNoHash(el.stroke),
        width: el.strokeWidth,
        dashType: lineDashType(el),
        endArrowType: el.arrow ? "triangle" : "none",
      },
      objectName: slidewiseShapeName(el.id),
    }
  );
}

function addTable(s: pptxgen.Slide, el: TableElement): void {
  if (!el.rows.length) return;
  const rows = el.rows.map((row, ri) =>
    row.flatMap((cell, ci) => {
      const span = el.cellSpans?.[ri]?.[ci];
      // A cell merged into a neighbour is omitted; pptxgenjs reconstructs the
      // merge from the origin cell's colspan/rowspan.
      if (span?.covered) return [];
      const perCellFill = el.cellFills?.[ri]?.[ci];
      const perCellColor = el.cellTextColors?.[ri]?.[ci];
      // In a per-cell-fill table an unset cell is transparent — fall back to
      // the row/header default only for tables without per-cell fills, so we
      // don't flood blank cells with a colour borrowed from another cell.
      const transparent =
        perCellFill === "transparent" || (el.cellFills && !perCellFill);
      const fill = transparent
        ? { color: "FFFFFF", transparency: 100 }
        : {
            color: hexNoHash(
              perCellFill ?? (ri === 0 ? el.headerFill : el.rowFill)
            ),
          };
      const cb = el.cellBorders?.[ri]?.[ci];
      // pptxgenjs cell border order is [top, right, bottom, left]; a drawn
      // side becomes a solid line, anything else (null / absent) is "none".
      const side = (s: CellBorderSide | null | undefined) =>
        s
          ? { type: "solid" as const, color: hexNoHash(s.color), pt: pxToPoints(s.width) }
          : { type: "none" as const };
      const border = cb
        ? ([side(cb.t), side(cb.r), side(cb.b), side(cb.l)] as [
            pptxgen.BorderProps,
            pptxgen.BorderProps,
            pptxgen.BorderProps,
            pptxgen.BorderProps,
          ])
        : undefined;
      // Rich runs: emit per-run text (highlight/colour/weight), splitting on
      // "\n" so bullet lines break in the exported deck.
      const runs = el.cellRuns?.[ri]?.[ci];
      const text:
        | string
        | { text: string; options?: pptxgen.TextPropsOptions }[] =
        runs && runs.length
          ? runs.flatMap((r) => {
              const pieces = r.text.split("\n");
              return pieces.map((piece, i) => ({
                text: piece,
                options: {
                  fontFace: r.fontFamily,
                  fontSize: r.fontSize ? pxToPoints(r.fontSize) : undefined,
                  bold: r.fontWeight ? r.fontWeight >= 600 : undefined,
                  italic: r.italic,
                  color: hexNoHash(r.color ?? perCellColor ?? el.textColor),
                  highlight: r.highlight ? hexNoHash(r.highlight) : undefined,
                  breakLine: i < pieces.length - 1,
                },
              }));
            })
          : cell;
      return [
        {
          text,
          options: {
            bold: ri === 0,
            fill,
            color: hexNoHash(perCellColor ?? el.textColor),
            fontSize: pxToPoints(el.fontSize),
            valign: "middle" as const,
            ...(border ? { border } : {}),
            ...(span?.colSpan ? { colspan: span.colSpan } : {}),
            ...(span?.rowSpan ? { rowspan: span.rowSpan } : {}),
          },
        },
      ];
    })
  );
  // EMU → inches for pptxgenjs track sizes (preserves uneven Gantt rows/cols).
  const EMU_PER_IN = 914400;
  const colW = el.colWidths?.length
    ? el.colWidths.map((w) => w / EMU_PER_IN)
    : undefined;
  const rowH = el.rowHeights?.length
    ? el.rowHeights.map((h) => h / EMU_PER_IN)
    : undefined;
  s.addTable(rows, {
    ...geometry(el),
    objectName: slidewiseShapeName(el.id),
    border: { type: "none", pt: 0, color: "FFFFFF" },
    fontFace: "Inter",
    ...(colW ? { colW } : {}),
    ...(rowH ? { rowH } : {}),
  });
}

function addIcon(s: pptxgen.Slide, el: IconElement): void {
  // Render the icon as a centered text box with the unicode glyph.
  const fontSize = Math.min(el.w, el.h) * 0.7;
  s.addText(el.icon, {
    ...geometry(el),
    objectName: slidewiseShapeName(el.id),
    fontFace: "Segoe UI Symbol",
    fontSize: pxToPoints(fontSize),
    color: hexNoHash(el.color),
    align: "center",
    valign: "middle",
  });
}

function addEmbed(s: pptxgen.Slide, el: EmbedElement): void {
  // Render embed as a labelled placeholder. PPTX has no first-class equivalent
  // for "an arbitrary URL embed"; we capture intent as text + URL.
  s.addText(
    [
      { text: "Embed\n", options: { fontSize: 10, color: "9CA3AF" } },
      { text: `${el.label}\n`, options: { bold: true, fontSize: 18 } },
      { text: el.url, options: { fontSize: 10, color: "9CA3AF" } },
    ],
    {
      ...geometry(el),
      objectName: slidewiseShapeName(el.id),
      fill: { color: "0E1330" },
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    }
  );
}

// -- UnknownElement preservation -------------------------------------------

/**
 * Post-process the zip pptxgenjs produced: for every slide that carries
 * UnknownElement payloads, inject the preserved OOXML back into the
 * generated `<p:spTree>` and pull along the rels + media those fragments
 * referenced from the original archive.
 *
 * No-ops cleanly when the deck has no UnknownElements, when no source
 * zip is attached (deck wasn't created via parsePptx), or when a slide
 * the editor added doesn't have a source path.
 */
async function preserveUnknowns(
  generated: ArrayBuffer,
  deck: Deck,
  explicitSource?: Blob | ArrayBuffer | Uint8Array,
  asTemplate?: boolean,
  onWarning?: (warning: SerializeWarning) => void,
  rasterizeSvg?: SvgRasterizer
): Promise<Blob> {
  // Prefer the caller-supplied source (survives state cloning / localStorage
  // rehydrate); fall back to the non-enumerable attachment from parsePptx
  // for the "parse → serialize" happy path with no state in between.
  const sourceBuffer = await resolveSource(deck, explicitSource);

  // Synthesised OOXML from the writer always needs post-processing — even
  // when there's no source PPTX, gradients / custGeom / charts / embedded
  // fonts have to be spliced into the generated zip.
  const hasSynth =
    synthBySlide.size > 0 ||
    deck.slides.some(
      (s) => {
        const parsed = parseFill(s.background);
        return parsed && parsed.kind !== "solid";
      }
    ) ||
    (deck.fonts && deck.fonts.length > 0);

  if (!sourceBuffer && !hasSynth) {
    // Still strip dangling Content_Types overrides — pptxgenjs declares
    // slideMaster1..N for every slide but only writes slideMaster1.xml.
    // PowerPoint refuses to open the file when declared parts are missing
    // (Keynote is lenient and just warns). Always sanitise.
    const outZip = await JSZip.loadAsync(generated);
    await fixSvgRasterFallbacks(outZip, rasterizeSvg);
    await pruneDanglingContentTypes(outZip);
    await sanitisePresentationXml(outZip);
    await sanitiseSlideXml(outZip);
    await reconcileDanglingRels(outZip);
    await sanitiseRels(outZip);
    pruneEmptyDirectories(outZip);
    return finalizeOutput(outZip, asTemplate === true);
  }
  if (!sourceBuffer && hasSynth) {
    // No source: still run the synth-only post-process. The chrome / EMF /
    // slide-bg replay paths short-circuit on a null source archive.
    const outZip = await JSZip.loadAsync(generated);
    await applySynth(outZip, deck);
    await applySynthSlideBackgrounds(outZip, deck);
    await applyEmbeddedFontsFromJson(outZip, deck);
    await fixSvgRasterFallbacks(outZip, rasterizeSvg);
    await pruneDanglingContentTypes(outZip);
    await sanitisePresentationXml(outZip);
    await sanitiseSlideXml(outZip);
    await reconcileDanglingRels(outZip);
    await sanitiseRels(outZip);
    pruneEmptyDirectories(outZip);
    return finalizeOutput(outZip, asTemplate === true);
  }

  const unknownsBySlide = collectUnknowns(deck);
  const pristinesBySlide = collectPristineImports(deck);

  const [outZip, srcZip] = await Promise.all([
    JSZip.loadAsync(generated),
    JSZip.loadAsync(sourceBuffer as ArrayBuffer),
  ]);

  // The source's slide-XML paths (in deck order). Used as a fallback when
  // the per-slide non-enumerable attachment has been stripped by state
  // cloning — we then map deck.slides[i] back to source slides[i].
  const sourceSlidePaths = await readSourceSlidePaths(srcZip);

  // One registry for the whole serialize: media/parts shared across slides
  // (icons, logos, backgrounds, chart workbooks) are copied once and reused,
  // instead of duplicating per reference.
  const reg = createPreservedPartRegistry();

  const slideIndices = new Set<number>([
    ...unknownsBySlide.keys(),
    ...pristinesBySlide.keys(),
  ]);
  const sortedIndices = [...slideIndices].sort((a, b) => a - b);
  for (const slideIndex of sortedIndices) {
    const unknownGroup = unknownsBySlide.get(slideIndex);
    const pristineGroup = pristinesBySlide.get(slideIndex);
    const generatedSlidePath = `ppt/slides/slide${slideIndex + 1}.xml`;
    const generatedRelsPath = `ppt/slides/_rels/slide${slideIndex + 1}.xml.rels`;
    if (!outZip.file(generatedSlidePath)) continue;
    // The slide's own source path is the default for UnknownElement
    // fragments; each pristine fragment carries its own (layout / master)
    // source path so the injector can resolve r:id references against
    // the correct rels file.
    const slideSourcePath = resolveSourceSlidePath(
      deck.slides[slideIndex],
      slideIndex,
      sourceSlidePaths
    );
    const unknownFragments: PristineFragment[] =
      unknownGroup && slideSourcePath
        ? unknownGroup.unknowns.map((u) => ({
            xml: u.ooxmlXml,
            sourcePath: slideSourcePath,
          }))
        : [];
    if (
      !unknownFragments.length &&
      !(pristineGroup?.fragments.length ?? 0)
    ) {
      continue;
    }
    await injectIntoSlide(
      outZip,
      srcZip,
      generatedSlidePath,
      generatedRelsPath,
      pristineGroup?.fragments ?? [],
      unknownFragments,
      reg
    );
  }

  // Replace pptxgenjs's regenerated chrome (slide masters, layouts, theme,
  // notes master, embedded fonts) with the source's. Without this, every
  // background, brand bar, gradient, embedded font, and footer that lives
  // on the master/layout disappears on save. Best-effort: bails when source
  // and output slide size don't match so 4:3 sources don't get their
  // masters stretched onto a 16:9 canvas.
  await preserveDeckChrome(outZip, srcZip, deck, sourceSlidePaths, onWarning);

  // Per-slide `<p:bg>` preservation. pptxgenjs's slide.background only
  // emits solid colors, so gradient / image / theme-referenced
  // backgrounds collapse to a flat hex through the model path. Replace
  // each output slide's `<p:bg>` with the source's verbatim XML when
  // available so gradients survive intact.
  await preserveSlideBackgrounds(outZip, srcZip, deck, sourceSlidePaths, reg);

  // Synthesised content (custGeom shapes, gradient fills, in-app charts,
  // groups, effect splices) — applied after source preservation so we never
  // overwrite the source's pristine fragments. JSON gradient backgrounds
  // only fire when the source preserve found nothing (preserveSlideBackgrounds
  // already wrote any source-provided bg).
  await applySynth(outZip, deck);
  await applySynthSlideBackgrounds(outZip, deck);
  // Embedded fonts from deck.fonts only fire when chrome preservation didn't
  // copy any — avoids duplicating font entries when both source + deck.fonts
  // are set.
  await applyEmbeddedFontsFromJson(outZip, deck);
  // Replace pptxgenjs's SVG-bytes-in-.png raster fallbacks with valid PNGs.
  await fixSvgRasterFallbacks(outZip, rasterizeSvg);
  // Strip Content_Types overrides for parts that don't exist. preserveDeckChrome
  // rewrites most, but pptxgenjs's stale slideMaster1..N / notesSlide overrides
  // can survive (and all of them survive when chrome preservation bails on an
  // aspect mismatch) — PowerPoint refuses to open a file that declares a part
  // it can't find, so always sanitise here too.
  await pruneDanglingContentTypes(outZip);
  await sanitisePresentationXml(outZip);
  await sanitiseSlideXml(outZip);
  // Final invariant: every internal rel target must resolve to a shipped part.
  // Repairs renamed-but-clobbered targets (tags) and drops genuinely absent
  // ones (notesMaster with no source part) — must run after every part
  // add/remove above.
  await reconcileDanglingRels(outZip);
  await sanitiseRels(outZip);
  pruneEmptyDirectories(outZip);

  // JSZip's blob output preserves the OOXML mime type set by pptxgenjs.
  // When the caller didn't force the output kind, inherit it from the source
  // so a parsed `.potx` round-trips back to a `.potx`.
  const emitAsTemplate = asTemplate ?? (await isTemplateArchive(srcZip));
  return finalizeOutput(outZip, emitAsTemplate);
}

async function resolveSource(
  deck: Deck,
  explicit?: Blob | ArrayBuffer | Uint8Array
): Promise<ArrayBuffer | undefined> {
  if (explicit) {
    if (explicit instanceof ArrayBuffer) return explicit;
    if (explicit instanceof Uint8Array) {
      const copy = new ArrayBuffer(explicit.byteLength);
      new Uint8Array(copy).set(explicit);
      return copy;
    }
    return explicit.arrayBuffer();
  }
  // 1. Module-level cache keyed by Deck.sourcePptxId — survives spread,
  //    structuredClone, and JSON round-trip within the session, so any
  //    reducer-driven host (Zustand, Redux, useState, etc.) keeps the
  //    chrome / EMF / slide-bg preservation pipeline alive.
  if (deck.sourcePptxId) {
    const cached = getCachedSourceBuffer(deck.sourcePptxId);
    if (cached) return cached;
  }
  // 2. Legacy non-enumerable attachment from parsePptx. Only present when
  //    the deck object hasn't been spread / cloned since import.
  const attached = (deck as unknown as Record<string, unknown>)[SOURCE_PPTX];
  return attached instanceof ArrayBuffer ? attached : undefined;
}

/**
 * Resolve which source slide's chrome (background + layout reference) a given
 * output slide should replay from. Precedence:
 *
 *   1. `slide.sourceSlideIndex` — an explicit, host-declared 0-based index
 *      into the source slide list. Wins because the host is the only party
 *      that knows it reordered / subset / duplicated slides, and the field is
 *      enumerable so it survives the state cloning that strips (2).
 *   2. The non-enumerable `SOURCE_SLIDE_PATH` attachment stamped at parse —
 *      correct for the untouched parse → serialize path with no host state in
 *      between.
 *   3. Positional: output slide `i` ← source slide `i`. The legacy behaviour;
 *      only correct when output order matches source order.
 */
function resolveSourceSlidePath(
  slide: Slide,
  outputIndex: number,
  sourceSlidePaths: string[]
): string | undefined {
  const declared = slide.sourceSlideIndex;
  if (
    typeof declared === "number" &&
    Number.isInteger(declared) &&
    declared >= 0 &&
    declared < sourceSlidePaths.length
  ) {
    return sourceSlidePaths[declared];
  }
  const attached = (slide as unknown as Record<string, unknown>)[
    SOURCE_SLIDE_PATH
  ];
  if (typeof attached === "string") return attached;
  return sourceSlidePaths[outputIndex];
}

/**
 * Both UnknownElement and (post-PR-38) ChartElement preserve their source
 * `<p:graphicFrame>` OOXML for round-trip. We collect them through the
 * same pipeline keyed on a structural `ooxmlXml` field.
 */
type PreservedElement = { ooxmlXml: string };

interface UnknownGroup {
  unknowns: PreservedElement[];
  sourcePath: string | undefined;
}

interface PristineFragment {
  xml: string;
  /** Archive path of the XML's origin (slide / layout / master) — used
   *  to resolve r:id references against the correct rels file. */
  sourcePath: string;
}

interface PristineGroup {
  fragments: PristineFragment[];
}

function collectPristineImports(deck: Deck): Map<number, PristineGroup> {
  const out = new Map<number, PristineGroup>();
  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const fragments: PristineFragment[] = [];
    for (const el of slide.elements) {
      // UnknownElement and ChartElement carry their OOXML directly and go
      // through the separate (high-z, append) injection path — don't
      // double-inject them as pristine fragments too.
      if (el.type === "unknown" || el.type === "chart") continue;
      const src = getElementSource(el.id);
      if (!src) continue;
      if (src.snapshot !== snapshotElement(el)) continue;
      fragments.push({ xml: src.xml, sourcePath: src.slidePath });
    }
    if (!fragments.length) continue;
    out.set(i, { fragments });
  }
  return out;
}

function collectUnknowns(deck: Deck): Map<number, UnknownGroup> {
  const out = new Map<number, UnknownGroup>();
  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const unknowns = slide.elements.filter(
      (e): e is UnknownElement | (ChartElement & { ooxmlXml: string }) =>
        (e.type === "unknown" || e.type === "chart") &&
        typeof (e as { ooxmlXml?: unknown }).ooxmlXml === "string" &&
        (e as { ooxmlXml: string }).ooxmlXml.length > 0
    );
    if (!unknowns.length) continue;
    const sourcePath = (slide as unknown as Record<string, unknown>)[
      SOURCE_SLIDE_PATH
    ];
    out.set(i, {
      unknowns,
      sourcePath: typeof sourcePath === "string" ? sourcePath : undefined,
    });
  }
  return out;
}

/**
 * For one slide: rewrite preserved fragments so their rIds don't collide
 * with whatever pptxgenjs already allocated, copy the referenced rels +
 * media from the source zip, and splice the fragments into the generated
 * `<p:spTree>`. `pristineFragments` (verbatim imported elements that
 * weren't edited) get prepended right after `<p:grpSpPr>` so they sit
 * at the bottom of the z stack — that's where layout-derived backgrounds
 * / gradients / wordmarks belong. `unknownPayloads` (charts / SmartArt /
 * OLE) get appended just before `</p:spTree>` so they sit on top, where
 * authored content typically lives.
 */
async function injectIntoSlide(
  outZip: JSZip,
  srcZip: JSZip,
  generatedSlidePath: string,
  generatedRelsPath: string,
  pristineFragments: PristineFragment[],
  unknownFragments: PristineFragment[],
  reg: PreservedPartRegistry
): Promise<void> {
  const slideXml = await outZip.file(generatedSlidePath)!.async("string");
  const closeIdx = slideXml.lastIndexOf("</p:spTree>");
  if (closeIdx < 0) return;

  const outRelsXml =
    (await outZip.file(generatedRelsPath)?.async("string")) ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  const outRels = parseRels(outRelsXml);
  let nextRid = highestRid(outRels) + 1;
  const newRelLines: string[] = [];
  const outDir = dirOf(generatedSlidePath);

  // Per-fragment rId map: r:* references inside one fragment only reuse
  // earlier rIds when they came from the *same* source rels file. Two
  // fragments sourced from different layouts/masters that happen to use
  // the same rId number ("rId2") refer to completely different rels.
  const srcRelsCache = new Map<string, Map<string, { type: string; target: string }>>();
  const getSrcRels = async (
    sourcePath: string
  ): Promise<Map<string, { type: string; target: string }>> => {
    const relsPath = relsPathFor(sourcePath);
    let cached = srcRelsCache.get(relsPath);
    if (cached) return cached;
    const xml = (await srcZip.file(relsPath)?.async("string")) ?? null;
    cached = parseRels(xml);
    srcRelsCache.set(relsPath, cached);
    return cached;
  };

  /**
   * Rewrite every `r:*="rIdN"` in the fragment to a fresh rId pointing at
   * the source rel's target. Copies the referenced media into the
   * generated zip at a uniquely-prefixed path so it can't collide with
   * media pptxgenjs already wrote. Each fragment carries its own source
   * path so the rels lookup uses the right archive entry
   * (slide / layout / master).
   *
   * Matches `r:id` / `r:embed` / `r:link` (slides + drawings + charts),
   * `r:dm` / `r:cs` / `r:qs` / `r:lo` (SmartArt), and any other
   * `r:NAME="rIdN"` style attribute the schema uses. Restricting to the
   * value pattern `rId\d+` keeps unrelated `r:*` attributes untouched.
   */
  // Parts the fragment directly references (e.g. a chart's `chartN.xml`) get
  // copied inside the synchronous replace below; their OWN dependency trees
  // (a chart's embedded workbook, colors/style parts, and the rels that bind
  // them) are deep-copied afterwards — `.replace` is synchronous so it can't
  // await the recursive rels walk.
  const deepCopyJobs: Array<{ srcFull: string; outFull: string }> = [];

  const rewriteFragment = async (frag: PristineFragment): Promise<string> => {
    const srcRels = await getSrcRels(frag.sourcePath);
    const sourceDir = dirOf(frag.sourcePath);
    const ridMap = new Map<string, string>();
    return frag.xml.replace(
      /\b(r:[a-zA-Z]+)="(rId\d+)"/g,
      (_m, attr, srcRid) => {
        const cached = ridMap.get(srcRid);
        if (cached) return `${attr}="${cached}"`;
        const srcRel = srcRels.get(srcRid);
        if (!srcRel) return `${attr}="${srcRid}"`;
        const newRid = `rId${nextRid++}`;
        ridMap.set(srcRid, newRid);
        let target = srcRel.target;
        const isExternal = /^https?:\/\//i.test(target);
        const isInternalPart = !isExternal && !target.startsWith("/");
        if (isInternalPart) {
          const srcFullTarget = normalisePath(target, sourceDir);
          const copy = preserveSourcePart(
            reg,
            outZip,
            srcZip,
            srcFullTarget,
            target,
            outDir
          );
          if (copy) {
            target = copy.relTarget;
            // Walk the dependency tree only the first time this part is
            // copied — later references reuse the same output part, whose
            // deps (chart workbook, colors/style, nested media) were already
            // brought along on that first copy.
            if (copy.firstCopy) {
              deepCopyJobs.push({
                srcFull: srcFullTarget,
                outFull: copy.outFull,
              });
            }
          }
        }
        newRelLines.push(buildRelXml(newRid, srcRel.type, target));
        return `${attr}="${newRid}"`;
      }
    );
  };

  const rewrittenPristines = await Promise.all(
    pristineFragments.map(rewriteFragment)
  );
  const rewrittenUnknowns = await Promise.all(
    unknownFragments.map(rewriteFragment)
  );

  // Deep-copy each referenced part's dependency tree so e.g. a preserved
  // chart's embedded Excel workbook + colors/style parts (and the content
  // types declaring them) come along. Sequential so the shared
  // `[Content_Types].xml` read/modify/write doesn't race. The registry's
  // `depsWalked` set spans the whole serialize, so a part shared across
  // slides has its tree copied exactly once.
  for (const job of deepCopyJobs) {
    await copyPartDependencies(
      srcZip,
      outZip,
      job.srcFull,
      job.outFull,
      reg
    );
  }

  let updatedSlide = slideXml;
  // Pristine fragments → prepend after `<p:grpSpPr/>` (low z, decoration
  // layer). Unknown payloads → append before `</p:spTree>` (high z,
  // chart / SmartArt / content layer).
  if (rewrittenPristines.length) {
    const insertAfter = findSpTreeContentInsertionPoint(updatedSlide);
    if (insertAfter >= 0) {
      updatedSlide =
        updatedSlide.slice(0, insertAfter) +
        rewrittenPristines.join("") +
        updatedSlide.slice(insertAfter);
    }
  }
  if (rewrittenUnknowns.length) {
    const close = updatedSlide.lastIndexOf("</p:spTree>");
    if (close >= 0) {
      updatedSlide =
        updatedSlide.slice(0, close) +
        rewrittenUnknowns.join("") +
        updatedSlide.slice(close);
    }
  }
  if (updatedSlide !== slideXml) {
    outZip.file(generatedSlidePath, updatedSlide);
  }

  if (newRelLines.length) {
    const insertAt = outRelsXml.lastIndexOf("</Relationships>");
    const updatedRels =
      insertAt >= 0
        ? outRelsXml.slice(0, insertAt) +
          newRelLines.join("") +
          outRelsXml.slice(insertAt)
        : outRelsXml.replace(
            /<Relationships[^>]*>/,
            (m) => `${m}${newRelLines.join("")}`
          );
    outZip.file(generatedRelsPath, updatedRels);
  }
}

/**
 * Recursively copy a part's dependency tree from the source archive into the
 * output zip, registering each copied part's content type. Called for every
 * part a preserved fragment references (charts especially): the directly
 * referenced `chartN.xml` is copied by the caller, then this walks
 * `chartN.xml`'s own rels to bring along the embedded Excel workbook
 * (`ppt/embeddings/*.xlsx`), the `colors*.xml` / `style*.xml` parts, and any
 * media — rewriting the copied part's rels to point at the (renamed) copies.
 *
 * The copied part keeps its ORIGINAL relationship ids, so the rIds embedded in
 * its XML still resolve; only the rel Targets change to the renamed parts.
 *
 * Without this a preserved chart renders from its baked `numCache`/`strCache`
 * but PowerPoint flags a repair (its rels dangle) and "Edit Data" / custom
 * chart colours + styles are lost.
 */
async function copyPartDependencies(
  srcZip: JSZip,
  outZip: JSZip,
  srcPartPath: string,
  outPartPath: string,
  reg: PreservedPartRegistry
): Promise<void> {
  // Guard against cycles and redundant work (two charts sharing one workbook,
  // or the same part referenced from several slides). The set spans the whole
  // serialize, so each source part's tree is walked exactly once.
  if (reg.depsWalked.has(srcPartPath)) return;
  reg.depsWalked.add(srcPartPath);

  await ensureContentType(srcZip, outZip, srcPartPath, outPartPath);

  const srcRelsPath = relsPathFor(srcPartPath);
  const srcRelsXml = await srcZip.file(srcRelsPath)?.async("string");
  if (!srcRelsXml) return;
  const rels = parseRels(srcRelsXml);
  if (!rels.size) return;

  const outDir = dirOf(outPartPath);
  const newRelLines: string[] = [];
  for (const [id, rel] of rels) {
    const isExternal = /^https?:\/\//i.test(rel.target);
    const isInternalPart =
      !isExternal && !rel.target.startsWith("/");
    if (!isInternalPart) {
      newRelLines.push(buildRelXml(id, rel.type, rel.target));
      continue;
    }
    const childSrcFull = normalisePath(rel.target, dirOf(srcPartPath));
    const child = preserveSourcePart(
      reg,
      outZip,
      srcZip,
      childSrcFull,
      rel.target,
      outDir
    );
    if (!child) {
      // Dangling in the source too — keep the rel verbatim rather than drop it.
      newRelLines.push(buildRelXml(id, rel.type, rel.target));
      continue;
    }
    // Recurse only on the first copy; a child shared with another part already
    // had its own tree brought along when it was first preserved.
    if (child.firstCopy) {
      await copyPartDependencies(
        srcZip,
        outZip,
        childSrcFull,
        child.outFull,
        reg
      );
    }
    newRelLines.push(buildRelXml(id, rel.type, child.relTarget));
  }

  const outRelsPath = relsPathFor(outPartPath);
  outZip.file(
    outRelsPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      newRelLines.join("") +
      `</Relationships>`
  );
}

/** Parsed `[Content_Types].xml` of a source archive: part-name Overrides +
 *  extension Defaults. Cached per source zip so we parse it once per save. */
const srcContentTypeCache = new WeakMap<
  JSZip,
  { overrides: Map<string, string>; defaults: Map<string, string> }
>();

async function getSourceContentTypes(
  srcZip: JSZip
): Promise<{ overrides: Map<string, string>; defaults: Map<string, string> }> {
  const cached = srcContentTypeCache.get(srcZip);
  if (cached) return cached;
  const xml = (await srcZip.file("[Content_Types].xml")?.async("string")) ?? "";
  const overrides = new Map<string, string>();
  const defaults = new Map<string, string>();
  for (const m of xml.matchAll(/<Override\b[^>]*\/>/g)) {
    const part = /PartName="([^"]+)"/.exec(m[0])?.[1];
    const ct = /ContentType="([^"]+)"/.exec(m[0])?.[1];
    if (part && ct) overrides.set(part, ct);
  }
  for (const m of xml.matchAll(/<Default\b[^>]*\/>/g)) {
    const ext = /Extension="([^"]+)"/.exec(m[0])?.[1];
    const ct = /ContentType="([^"]+)"/.exec(m[0])?.[1];
    if (ext && ct) defaults.set(ext.toLowerCase(), ct);
  }
  const parsed = { overrides, defaults };
  srcContentTypeCache.set(srcZip, parsed);
  return parsed;
}

/**
 * Ensure the output `[Content_Types].xml` declares a content type for a part
 * we copied from the source, reusing the source's own declaration (Override by
 * part name, else Default by extension). Added as an Override against the new
 * (possibly renamed) part path. No-op when the part is already declared or the
 * source has no type for it.
 */
async function ensureContentType(
  srcZip: JSZip,
  outZip: JSZip,
  srcPartPath: string,
  outPartPath: string
): Promise<void> {
  const { overrides, defaults } = await getSourceContentTypes(srcZip);
  const ext = srcPartPath.slice(srcPartPath.lastIndexOf(".") + 1).toLowerCase();
  const ct = overrides.get(`/${srcPartPath}`) ?? defaults.get(ext);
  if (!ct) return;
  const ctFile = outZip.file("[Content_Types].xml");
  if (!ctFile) return;
  const xml = await ctFile.async("string");
  // Add an Override keyed by the new part name. An Override always supersedes
  // a Default for that part, so we add it even when a `<Default>` for the
  // extension exists — pptxgenjs declares a generic `Default Extension="xml"`,
  // but a chart / chartstyle / chartcolorstyle part needs its specific type.
  if (xml.includes(`PartName="/${outPartPath}"`)) return;
  const override = `<Override PartName="/${outPartPath}" ContentType="${ct}"/>`;
  const close = xml.lastIndexOf("</Types>");
  if (close < 0) return;
  outZip.file(
    "[Content_Types].xml",
    xml.slice(0, close) + override + xml.slice(close)
  );
}

/**
 * Find the position in a slide XML string immediately after the group's
 * own `<p:grpSpPr…/>` / `</p:grpSpPr>` — i.e. just before the first child
 * element of the spTree. Used to prepend pristine fragments at the
 * bottom of the z stack.
 */
function findSpTreeContentInsertionPoint(slideXml: string): number {
  const spTreeOpen = slideXml.indexOf("<p:spTree");
  if (spTreeOpen < 0) return -1;
  // Self-closing grpSpPr (`<p:grpSpPr/>`) is the typical pptxgenjs output.
  const selfCloseRe = /<p:grpSpPr\s*\/>/g;
  selfCloseRe.lastIndex = spTreeOpen;
  const sc = selfCloseRe.exec(slideXml);
  if (sc) return sc.index + sc[0].length;
  // Otherwise look for the explicit close tag.
  const closeIdx = slideXml.indexOf("</p:grpSpPr>", spTreeOpen);
  if (closeIdx >= 0) return closeIdx + "</p:grpSpPr>".length;
  // No grpSpPr → fall back to just after `<p:spTree>`'s opening tag.
  const opTagEnd = slideXml.indexOf(">", spTreeOpen);
  return opTagEnd >= 0 ? opTagEnd + 1 : -1;
}

/**
 * Insert synthesised spTree blobs at their z-anchors. Each blob carries an
 * `after` element id: the blob is spliced immediately after the pptxgenjs node
 * named `slidewise:<after>` (so it stacks on top of that node), or at the back
 * of the spTree when `after` is null (below every pptxgenjs node). Anchor
 * offsets are resolved against the ORIGINAL xml and applied back-to-front so
 * earlier offsets stay valid; blobs sharing one anchor keep emission order.
 */
function insertSynthBlobs(
  slideXml: string,
  blobs: { xml: string; after: string | null }[]
): string {
  if (!blobs.length) return slideXml;
  const backPos = (() => {
    const p = findSpTreeContentInsertionPoint(slideXml);
    if (p >= 0) return p;
    const close = slideXml.lastIndexOf("</p:spTree>");
    return close >= 0 ? close : -1;
  })();
  if (backPos < 0) return slideXml;

  // Group blobs by their resolved insertion offset, preserving emission order.
  const byOffset = new Map<number, string[]>();
  for (const b of blobs) {
    let offset = backPos;
    if (b.after) {
      const e = endOffsetOfNamedNode(slideXml, slidewiseShapeName(b.after));
      if (e >= 0) offset = e;
    }
    const arr = byOffset.get(offset) ?? [];
    arr.push(b.xml);
    byOffset.set(offset, arr);
  }
  // Apply from the highest offset down so each splice leaves lower offsets put.
  let out = slideXml;
  for (const off of [...byOffset.keys()].sort((a, b) => b - a)) {
    const chunk = byOffset.get(off)!.join("");
    out = out.slice(0, off) + chunk + out.slice(off);
  }
  return out;
}

/**
 * Byte offset just past the end of the top-level spTree child whose
 * `cNvPr.name` equals `name` — used to anchor a synth blob right on top of a
 * specific pptxgenjs node. Returns -1 when the name isn't found. Depth-aware so
 * it finds the matching close of the enclosing `<p:sp>` / `<p:pic>` /
 * `<p:graphicFrame>` / `<p:cxnSp>`.
 */
function endOffsetOfNamedNode(xml: string, name: string): number {
  const at = xml.indexOf(`name="${name}"`);
  if (at < 0) return -1;
  // Nearest enclosing element open tag, searching backwards from the name.
  const tags = ["p:sp", "p:pic", "p:graphicFrame", "p:cxnSp"];
  let openIdx = -1;
  let tag = "";
  for (const t of tags) {
    const idx = xml.lastIndexOf(`<${t}`, at);
    if (idx > openIdx) {
      openIdx = idx;
      tag = t;
    }
  }
  if (openIdx < 0) return -1;
  const openMark = `<${tag}`;
  const closeMark = `</${tag}>`;
  let depth = 0;
  let i = openIdx;
  while (i < xml.length) {
    const no = xml.indexOf(openMark, i);
    const nc = xml.indexOf(closeMark, i);
    if (nc < 0) return -1;
    if (no >= 0 && no < nc) {
      const after = xml[no + openMark.length];
      // Only count a genuine element open (`<p:sp ` / `<p:sp>`), not a prefix
      // collision like `<p:spPr>` against `<p:sp`.
      if (after === " " || after === ">" || after === "\t" || after === "\n") {
        const gt = xml.indexOf(">", no);
        if (gt >= 0 && xml[gt - 1] !== "/") depth++;
      }
      i = no + openMark.length;
    } else {
      depth--;
      i = nc + closeMark.length;
      if (depth <= 0) return i;
    }
  }
  return -1;
}

async function readSourceSlidePaths(srcZip: JSZip): Promise<string[]> {
  // Walk the source presentation.xml + its rels to get slide-xml paths in
  // deck order. Best-effort: if anything's missing we return [] and the
  // caller falls back to its own per-slide source attachment.
  const presentation = await srcZip
    .file("ppt/presentation.xml")
    ?.async("string");
  const presentationRels = await srcZip
    .file("ppt/_rels/presentation.xml.rels")
    ?.async("string");
  if (!presentation || !presentationRels) return [];
  const relMap = parseRels(presentationRels);
  const sldIdRe = /<p:sldId\b[^>]*\br:id="([^"]+)"/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = sldIdRe.exec(presentation))) {
    const rel = relMap.get(m[1]);
    if (rel?.target) out.push(normalisePath(rel.target, "ppt"));
  }
  return out;
}

function parseRels(xml: string | null): Map<string, { type: string; target: string }> {
  const map = new Map<string, { type: string; target: string }>();
  if (!xml) return map;
  // Match each <Relationship .../> tag. Use a non-greedy scan up to the
  // self-closing `/>` rather than a `[^/]` class — relationship targets
  // routinely contain `/` (e.g. `Target="../charts/chart1.xml"`).
  const re = /<Relationship\b([\s\S]*?)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const id = /\bId="([^"]+)"/.exec(attrs)?.[1];
    const type = /\bType="([^"]+)"/.exec(attrs)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
    if (id && type && target) map.set(id, { type, target });
  }
  return map;
}

function highestRid(rels: Map<string, unknown>): number {
  let max = 0;
  for (const id of rels.keys()) {
    const m = /^rId(\d+)$/.exec(id);
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return max;
}

function buildRelXml(id: string, type: string, target: string): string {
  return `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
}

function relsPathFor(xmlPath: string): string {
  return xmlPath.replace(/([^/]+)\.xml$/, "_rels/$1.xml.rels");
}

/**
 * Pick a target path that doesn't collide with anything pptxgenjs already
 * wrote into the zip. We keep the original target's directory and
 * extension so the file stays in `ppt/media/`, `ppt/charts/`, etc., but
 * prefix the basename with `slidewise_preserved_N_` until the resolved
 * full path is unique.
 */
function uniqueTarget(originalTarget: string, outZip: JSZip, baseDir: string): string {
  const slash = originalTarget.lastIndexOf("/");
  const dir = slash >= 0 ? originalTarget.slice(0, slash + 1) : "";
  const file = slash >= 0 ? originalTarget.slice(slash + 1) : originalTarget;
  let i = 0;
  let candidate = `${dir}slidewise_preserved_${i}_${file}`;
  while (outZip.file(normalisePath(candidate, baseDir))) {
    i++;
    candidate = `${dir}slidewise_preserved_${i}_${file}`;
  }
  return candidate;
}

/**
 * Per-serialize ledger of source parts already copied into the output package,
 * keyed by the part's immutable source path.
 *
 * The same media is routinely shared — one icon/logo/background is referenced
 * from many slides, and a single slide's fragments can each reference it. The
 * naive path keeps a *separate* copy per reference (`uniqueTarget` only avoids
 * path collisions; it has no idea the bytes were already written), so a 1.5 MB
 * deck ballooned to ~6 MB with one image written nine times as
 * `slidewise_preserved_0..8_imageN`. Keying the copy on the source path
 * collapses those back to a single shared part — exactly as the source authored
 * it — and lets every referencing rel point at that one copy.
 */
interface PreservedPartRegistry {
  /** source full path → output full path of the single copy we made for it. */
  readonly bySource: Map<string, string>;
  /** source full paths whose dependency tree has already been deep-copied. */
  readonly depsWalked: Set<string>;
}

function createPreservedPartRegistry(): PreservedPartRegistry {
  return { bySource: new Map(), depsWalked: new Set() };
}

/**
 * Copy a source part into the output zip at most once per serialize.
 *
 * Returns the rel `Target` the owner should reference (relative to
 * `ownerOutDir`), the part's full output path, and whether THIS call performed
 * the copy — so callers can run the dependency walk only on the first copy.
 * Returns `null` when the source part is missing (caller leaves the rel as-is).
 *
 * On the first sighting we mint a collision-free `slidewise_preserved_N_` name
 * and record it; every later reference — from any slide, layout, or sibling
 * part — resolves the recorded copy and points at it instead of duplicating.
 */
function preserveSourcePart(
  reg: PreservedPartRegistry,
  outZip: JSZip,
  srcZip: JSZip,
  srcFullTarget: string,
  preferredRelTarget: string,
  ownerOutDir: string
): { relTarget: string; outFull: string; firstCopy: boolean } | null {
  const srcFile = srcZip.file(srcFullTarget);
  if (!srcFile) return null;
  const existing = reg.bySource.get(srcFullTarget);
  if (existing) {
    return {
      relTarget: relativeTarget(ownerOutDir, existing),
      outFull: existing,
      firstCopy: false,
    };
  }
  const newTarget = uniqueTarget(preferredRelTarget, outZip, ownerOutDir);
  const outFull = normalisePath(newTarget, ownerOutDir);
  outZip.file(outFull, srcFile.async("uint8array"), { binary: true });
  reg.bySource.set(srcFullTarget, outFull);
  return { relTarget: newTarget, outFull, firstCopy: true };
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

function normalisePath(target: string, base: string): string {
  if (/^https?:\/\//i.test(target)) return target;
  if (target.startsWith("/")) return target.slice(1);
  let t = target;
  const segments = base.split("/").filter(Boolean);
  while (t.startsWith("../")) {
    segments.pop();
    t = t.slice(3);
  }
  return [...segments, t].filter(Boolean).join("/");
}

// -- Deck chrome preservation ----------------------------------------------

/**
 * Replace pptxgenjs's regenerated deck chrome (slide masters, layouts, theme,
 * notes master, embedded fonts, tags, handout masters) with the originals
 * from the source PPTX. Without this, anything that lives on the master or
 * layout — backgrounds, brand bars, gradients, page numbers, embedded
 * brand fonts — disappears the first time the deck is saved.
 *
 * Bails safely when the source's slide size doesn't match the output's
 * (e.g. a 4:3 source written as 16:9): copying masters drawn at one
 * aspect ratio onto slides authored at another would visually misalign
 * the chrome. Future work: drive the output slide size from the source.
 */
const CHROME_PREFIXES = [
  "ppt/slideMasters/",
  "ppt/slideLayouts/",
  "ppt/theme/",
  "ppt/fonts/",
  "ppt/notesMasters/",
  "ppt/handoutMasters/",
  "ppt/tags/",
] as const;

async function preserveDeckChrome(
  outZip: JSZip,
  srcZip: JSZip,
  deck: Deck,
  sourceSlidePaths: string[],
  onWarning?: (warning: SerializeWarning) => void
): Promise<void> {
  const aspects = await readDeckAspects(outZip, srcZip);
  if (!aspectsMatch(aspects)) {
    // We size the output slide from the source (see computeSerializeTransform),
    // so ratios should match for any parseable source. If we still land here
    // the source's <p:sldSz> was unreadable — surface it (with the ratios we
    // could read) rather than silently shipping a generic-looking deck stripped
    // of the template's chrome.
    const fmt = (r?: number) => (r != null ? r.toFixed(3) : "unknown");
    const message =
      "[slidewise/pptx] source slide size could not be matched " +
      `(source aspect ${fmt(aspects.sourceAspect)}, output aspect ${fmt(
        aspects.outputAspect
      )}); skipping master/layout/theme/font preservation (deck will use ` +
      "generic chrome).";
    console.warn(message);
    onWarning?.({
      code: "chrome-skipped",
      message,
      ...(aspects.sourceAspect != null
        ? { sourceAspect: aspects.sourceAspect }
        : {}),
      ...(aspects.outputAspect != null
        ? { outputAspect: aspects.outputAspect }
        : {}),
    });
    return;
  }

  // 1. Find every chrome path that exists in the source.
  const srcChromePaths = listPaths(srcZip, CHROME_PREFIXES);
  if (!srcChromePaths.length) return;

  // 2. Remove pptxgenjs's chrome — we're about to overwrite with the source's,
  //    but pptxgenjs may have left files we don't replace (e.g. its single
  //    slideLayout1.xml when the source has 28 layouts named slideLayout1-28,
  //    or stale slideMaster overrides in [Content_Types].xml).
  const outChromePaths = listPaths(outZip, CHROME_PREFIXES);
  for (const p of outChromePaths) outZip.remove(p);

  // 3. Walk every chrome rels file in srcZip to discover the media payloads
  //    those masters / layouts / themes reference. These need to come along
  //    or the chrome XML will dangle on r:id references after the move.
  const referencedMedia = await collectChromeMediaRefs(srcZip, srcChromePaths);

  // 4. Copy the chrome files themselves verbatim. JSZip lazily defers the
  //    actual byte copy until generateAsync, which is cheap.
  for (const p of srcChromePaths) {
    const f = srcZip.file(p);
    if (!f) continue;
    outZip.file(p, f.async("uint8array"), { binary: true });
  }

  // 5. Copy media payloads. pptxgenjs writes its own `ppt/media/imageN.*`
  //    with an unrelated numbering, so we need to rename on collision and
  //    rewrite the copied chrome rels to point at the renamed target.
  const mediaRenames = new Map<string, string>(); // source full path → out full path
  for (const srcMediaPath of referencedMedia) {
    const srcFile = srcZip.file(srcMediaPath);
    if (!srcFile) continue;
    let outMediaPath = srcMediaPath;
    if (outZip.file(outMediaPath)) {
      const slash = srcMediaPath.lastIndexOf("/");
      const dir = srcMediaPath.slice(0, slash + 1);
      const base = srcMediaPath.slice(slash + 1);
      let i = 0;
      do {
        outMediaPath = `${dir}slidewise_chrome_${i}_${base}`;
        i++;
      } while (outZip.file(outMediaPath));
    }
    outZip.file(outMediaPath, srcFile.async("uint8array"), { binary: true });
    if (outMediaPath !== srcMediaPath) {
      mediaRenames.set(srcMediaPath, outMediaPath);
    }
  }
  if (mediaRenames.size) {
    await rewriteChromeRelsForRenames(outZip, srcChromePaths, mediaRenames);
  }

  // 6. [Content_Types].xml: drop the master/layout/theme/notesMaster overrides
  //    pptxgenjs declared (some of which point at files it never wrote — see
  //    the slideMaster1..9 overrides emitted with only slideMaster1.xml
  //    actually on disk) and add overrides for the files we just copied.
  //    Font extensions need a `<Default>` entry so PowerPoint embeds them.
  await rewriteContentTypes(outZip, srcChromePaths);

  // 7. presentation.xml.rels: replace pptxgenjs's slideMaster / theme /
  //    notesMaster rels with the source's mapping. presentation.xml's
  //    <p:sldMasterIdLst> / <p:notesMasterIdLst> also get spliced from
  //    the source so multi-master decks (rare but real) round-trip.
  await rewritePresentation(outZip, srcZip);

  // 8. Each slide's rels currently points at pptxgenjs's slideLayout1.xml,
  //    which we just deleted. Re-point each slide at the original layout
  //    its source counterpart used. New slides (added in-editor with no
  //    source path) fall back to the first source layout.
  await rewriteSlideLayoutRefs(outZip, srcZip, deck, sourceSlidePaths, onWarning);
}

/**
 * Replace each output slide's `<p:bg>` element with the source slide's
 * `<p:bg>` verbatim. This is what keeps gradient / image-fill / theme-
 * referenced backgrounds intact — pptxgenjs's slide.background only
 * emits flat-hex solid fills, so anything fancier was collapsing on save.
 *
 * Image-fill backgrounds (`<p:bgPr><a:blipFill r:embed="rIdN"/></p:bgPr>`)
 * have their r:id rewritten to a fresh slide-rels-scoped rId, with the
 * referenced media copied across so the fill resolves.
 */
async function preserveSlideBackgrounds(
  outZip: JSZip,
  srcZip: JSZip,
  deck: Deck,
  sourceSlidePaths: string[],
  reg: PreservedPartRegistry
): Promise<void> {
  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const sourceSlidePath = resolveSourceSlidePath(slide, i, sourceSlidePaths);
    if (!sourceSlidePath) {
      // A slide instantiated from a layout (addSlideFromLayout) has no source
      // slide. Drop pptxgenjs's flat bg so the layout/master background shows
      // through, unless the host set an explicit non-transparent background.
      if (slide.sourceLayoutId && isInheritedBackground(slide.background)) {
        await stripOutputBg(outZip, i);
      }
      continue;
    }
    const srcSlideFile = srcZip.file(sourceSlidePath);
    if (!srcSlideFile) continue;
    const srcXml = await srcSlideFile.async("string");
    const bgFragment = extractBgFragment(srcXml);
    if (bgFragment == null) {
      // Source slide had no explicit `<p:bg>` — it's inheriting from
      // layout / master. Drop pptxgenjs's flat-hex bg so the inheritance
      // chain can do its job once the original chrome is back in place.
      await stripOutputBg(outZip, i);
      continue;
    }
    await injectSlideBg(outZip, srcZip, i, sourceSlidePath, bgFragment, reg);
  }
}

function extractBgFragment(slideXml: string): string | null {
  const cSldOpen = slideXml.indexOf("<p:cSld");
  if (cSldOpen < 0) return null;
  const cSldClose = slideXml.indexOf("</p:cSld>", cSldOpen);
  if (cSldClose < 0) return null;
  const scope = slideXml.slice(cSldOpen, cSldClose);
  const bgOpen = scope.indexOf("<p:bg");
  if (bgOpen < 0) return null;
  // Self-closing `<p:bg/>` is legal but expresses "no background"; treat
  // as missing so inheritance kicks back in.
  const selfClose = /<p:bg\b[^>]*\/\s*>/.exec(scope);
  if (selfClose && selfClose.index === bgOpen) return null;
  const bgClose = scope.indexOf("</p:bg>", bgOpen);
  if (bgClose < 0) return null;
  return scope.slice(bgOpen, bgClose + "</p:bg>".length);
}

async function stripOutputBg(outZip: JSZip, slideIndex: number): Promise<void> {
  const outPath = `ppt/slides/slide${slideIndex + 1}.xml`;
  const file = outZip.file(outPath);
  if (!file) return;
  const xml = await file.async("string");
  const updated = xml.replace(/<p:bg\b[\s\S]*?<\/p:bg>|<p:bg\b[^>]*\/\s*>/, "");
  if (updated !== xml) outZip.file(outPath, updated);
}

async function injectSlideBg(
  outZip: JSZip,
  srcZip: JSZip,
  slideIndex: number,
  sourceSlidePath: string,
  bgFragment: string,
  reg: PreservedPartRegistry
): Promise<void> {
  const outSlidePath = `ppt/slides/slide${slideIndex + 1}.xml`;
  const outRelsPath = `ppt/slides/_rels/slide${slideIndex + 1}.xml.rels`;
  const outSlideFile = outZip.file(outSlidePath);
  if (!outSlideFile) return;
  const outXml = await outSlideFile.async("string");

  let outRelsXml =
    (await outZip.file(outRelsPath)?.async("string")) ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  // Rewrite r:embed / r:link references inside the bg fragment so they
  // don't collide with rIds pptxgenjs already wrote into this slide's
  // rels. Mirrors the rId-rewrite logic in injectIntoSlide but scoped
  // to a single fragment + slide rels.
  let rewritten = bgFragment;
  if (/\br:(embed|link|id)="rId\d+"/.test(bgFragment)) {
    const outRels = parseRels(outRelsXml);
    let nextRid =
      [...outRels.keys()].reduce((max, id) => {
        const m = /^rId(\d+)$/.exec(id);
        return m ? Math.max(max, Number(m[1])) : max;
      }, 0) + 1;
    const srcRelsXml =
      (await srcZip
        .file(relsPathFor(sourceSlidePath))
        ?.async("string")) ?? null;
    const srcRels = parseRels(srcRelsXml);
    const sourceDir = dirOf(sourceSlidePath);
    const outDir = dirOf(outSlidePath);
    const newRelLines: string[] = [];
    const ridMap = new Map<string, string>();
    rewritten = bgFragment.replace(
      /\b(r:[a-zA-Z]+)="(rId\d+)"/g,
      (_m, attr: string, srcRid: string) => {
        const cached = ridMap.get(srcRid);
        if (cached) return `${attr}="${cached}"`;
        const srcRel = srcRels.get(srcRid);
        if (!srcRel) return `${attr}="${srcRid}"`;
        const newRid = `rId${nextRid++}`;
        ridMap.set(srcRid, newRid);
        let target = srcRel.target;
        const isExternal = /^https?:\/\//i.test(target);
        const isInternalPart = !isExternal && !target.startsWith("/");
        if (isInternalPart) {
          const srcFullTarget = normalisePath(target, sourceDir);
          const copy = preserveSourcePart(
            reg,
            outZip,
            srcZip,
            srcFullTarget,
            target,
            outDir
          );
          if (copy) target = copy.relTarget;
        }
        newRelLines.push(buildRelXml(newRid, srcRel.type, target));
        return `${attr}="${newRid}"`;
      }
    );
    if (newRelLines.length) {
      const insertAt = outRelsXml.lastIndexOf("</Relationships>");
      outRelsXml =
        insertAt >= 0
          ? outRelsXml.slice(0, insertAt) +
            newRelLines.join("") +
            outRelsXml.slice(insertAt)
          : outRelsXml.replace(
              /<Relationships[^>]*>/,
              (m) => `${m}${newRelLines.join("")}`
            );
      outZip.file(outRelsPath, outRelsXml);
    }
  }

  // Replace pptxgenjs's `<p:bg>...</p:bg>` (or self-closing equivalent) with
  // the source fragment. When the output has no `<p:bg>` yet, insert
  // immediately after `<p:cSld...>` so it precedes `<p:spTree>` per the
  // OOXML schema's ordering.
  let updated = outXml;
  const existingBgRe = /<p:bg\b[\s\S]*?<\/p:bg>|<p:bg\b[^>]*\/\s*>/;
  if (existingBgRe.test(outXml)) {
    updated = outXml.replace(existingBgRe, rewritten);
  } else {
    const cSldOpenMatch = /<p:cSld\b[^>]*>/.exec(outXml);
    if (cSldOpenMatch) {
      const idx = cSldOpenMatch.index + cSldOpenMatch[0].length;
      updated = outXml.slice(0, idx) + rewritten + outXml.slice(idx);
    }
  }
  if (updated !== outXml) outZip.file(outSlidePath, updated);
}

function listPaths(zip: JSZip, prefixes: readonly string[]): string[] {
  const out: string[] = [];
  zip.forEach((relPath) => {
    for (const prefix of prefixes) {
      if (relPath.startsWith(prefix)) {
        out.push(relPath);
        return;
      }
    }
  });
  return out;
}

async function collectChromeMediaRefs(
  srcZip: JSZip,
  chromePaths: string[]
): Promise<Set<string>> {
  const refs = new Set<string>();
  for (const p of chromePaths) {
    if (!p.endsWith(".rels")) continue;
    const xml = await srcZip.file(p)?.async("string");
    if (!xml) continue;
    const rels = parseRels(xml);
    // The owning XML lives at e.g. `ppt/slideMasters/slideMaster1.xml`,
    // its rels at `ppt/slideMasters/_rels/slideMaster1.xml.rels`. Targets
    // are relative to the XML's directory.
    const xmlPath = p.replace("/_rels/", "/").replace(/\.rels$/, "");
    const xmlDir = dirOf(xmlPath);
    for (const { target } of rels.values()) {
      if (/^https?:\/\//i.test(target)) continue;
      const full = normalisePath(target, xmlDir);
      // Pull media but also fonts (sometimes in `ppt/fonts/` already
      // captured by chrome prefixes), embeddings, and any other
      // chrome-adjacent payload — we err on the side of copying so
      // brand-bar logos and embedded font glyphs survive.
      if (
        full.startsWith("ppt/media/") ||
        full.startsWith("ppt/embeddings/") ||
        full.startsWith("ppt/charts/")
      ) {
        refs.add(full);
      }
    }
  }
  return refs;
}

async function rewriteChromeRelsForRenames(
  outZip: JSZip,
  chromePaths: string[],
  renames: Map<string, string>
): Promise<void> {
  for (const p of chromePaths) {
    if (!p.endsWith(".rels")) continue;
    const xml = await outZip.file(p)?.async("string");
    if (!xml) continue;
    const xmlPath = p.replace("/_rels/", "/").replace(/\.rels$/, "");
    const xmlDir = dirOf(xmlPath);
    let changed = false;
    const updated = xml.replace(/Target="([^"]+)"/g, (m, target: string) => {
      if (/^https?:\/\//i.test(target)) return m;
      const full = normalisePath(target, xmlDir);
      const renamed = renames.get(full);
      if (!renamed) return m;
      changed = true;
      return `Target="${relativeTarget(xmlDir, renamed)}"`;
    });
    if (changed) outZip.file(p, updated);
  }
}

function relativeTarget(fromDir: string, toPath: string): string {
  const fromSegs = fromDir.split("/").filter(Boolean);
  const toSegs = toPath.split("/").filter(Boolean);
  let i = 0;
  while (i < fromSegs.length && i < toSegs.length && fromSegs[i] === toSegs[i]) {
    i++;
  }
  const up = fromSegs.length - i;
  const rest = toSegs.slice(i).join("/");
  return up > 0 ? `${"../".repeat(up)}${rest}` : rest;
}

const CONTENT_TYPE_BY_DIR: Record<string, string> = {
  "ppt/slideMasters/":
    "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml",
  "ppt/slideLayouts/":
    "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml",
  "ppt/theme/":
    "application/vnd.openxmlformats-officedocument.theme+xml",
  "ppt/notesMasters/":
    "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml",
  "ppt/handoutMasters/":
    "application/vnd.openxmlformats-officedocument.presentationml.handoutMaster+xml",
  "ppt/tags/":
    "application/vnd.openxmlformats-officedocument.presentationml.tags+xml",
};

async function rewriteContentTypes(
  outZip: JSZip,
  srcChromePaths: string[]
): Promise<void> {
  const file = outZip.file("[Content_Types].xml");
  if (!file) return;
  let xml = await file.async("string");

  // Drop every existing Override under the chrome prefixes — pptxgenjs
  // sometimes declares masters / layouts it never wrote, and we're about
  // to declare the real set from source.
  xml = xml.replace(
    /<Override\b[^/]*PartName="\/(ppt\/(?:slideMasters|slideLayouts|theme|notesMasters|handoutMasters|tags)\/[^"]+)"[^/]*\/>/g,
    ""
  );

  // Build a fresh set of Override entries for chrome XML files we copied.
  const additions: string[] = [];
  const seenParts = new Set<string>();
  // Re-scan existing xml to avoid duplicate part declarations.
  const existingPartRe = /PartName="\/([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = existingPartRe.exec(xml))) seenParts.add(m[1]);

  for (const path of srcChromePaths) {
    if (path.endsWith(".rels")) continue;
    if (!path.endsWith(".xml")) continue;
    const dirMatch = Object.keys(CONTENT_TYPE_BY_DIR).find((d) =>
      path.startsWith(d)
    );
    if (!dirMatch) continue;
    if (seenParts.has(path)) continue;
    additions.push(
      `<Override PartName="/${path}" ContentType="${CONTENT_TYPE_BY_DIR[dirMatch]}"/>`
    );
    seenParts.add(path);
  }

  // Embedded fonts: declare the `.fntdata` extension as a Default once.
  const hasFonts = srcChromePaths.some((p) => p.startsWith("ppt/fonts/"));
  if (hasFonts && !/Extension="fntdata"/i.test(xml)) {
    additions.push(
      `<Default Extension="fntdata" ContentType="application/x-fontdata"/>`
    );
  }

  if (!additions.length) {
    outZip.file("[Content_Types].xml", xml);
    return;
  }

  const closeIdx = xml.lastIndexOf("</Types>");
  if (closeIdx < 0) return;
  const updated =
    xml.slice(0, closeIdx) + additions.join("") + xml.slice(closeIdx);
  outZip.file("[Content_Types].xml", updated);
}

const REL_TYPE_SLIDE_MASTER =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster";
const REL_TYPE_THEME =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
const REL_TYPE_NOTES_MASTER =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster";
const REL_TYPE_HANDOUT_MASTER =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/handoutMaster";

async function rewritePresentation(
  outZip: JSZip,
  srcZip: JSZip
): Promise<void> {
  const outRelsFile = outZip.file("ppt/_rels/presentation.xml.rels");
  const srcRelsFile = srcZip.file("ppt/_rels/presentation.xml.rels");
  const outPresFile = outZip.file("ppt/presentation.xml");
  const srcPresFile = srcZip.file("ppt/presentation.xml");
  if (!outRelsFile || !srcRelsFile || !outPresFile || !srcPresFile) return;

  const [outRelsXml, srcRelsXml, outPresXml, srcPresXml] = await Promise.all([
    outRelsFile.async("string"),
    srcRelsFile.async("string"),
    outPresFile.async("string"),
    srcPresFile.async("string"),
  ]);
  const outRels = parseRels(outRelsXml);
  const srcRels = parseRels(srcRelsXml);

  // 1. Drop pptxgenjs's chrome rels — slideMaster / theme / notesMaster /
  //    handoutMaster — and remember their rIds so we can scrub them out of
  //    `<p:sldMasterIdLst>` etc. in presentation.xml.
  const droppedRids = new Set<string>();
  const keptRels: Array<[string, { type: string; target: string }]> = [];
  for (const [id, rel] of outRels) {
    if (
      rel.type === REL_TYPE_SLIDE_MASTER ||
      rel.type === REL_TYPE_THEME ||
      rel.type === REL_TYPE_NOTES_MASTER ||
      rel.type === REL_TYPE_HANDOUT_MASTER
    ) {
      droppedRids.add(id);
    } else {
      keptRels.push([id, rel]);
    }
  }

  // 2. Allocate fresh rIds for the source's chrome rels in the output's
  //    rId namespace, and remember the mapping so we can rewrite
  //    presentation.xml's <p:sldMasterId r:id="..."/> entries.
  let nextRid =
    [...outRels.keys(), ...srcRels.keys()].reduce((max, id) => {
      const n = /^rId(\d+)$/.exec(id);
      return n ? Math.max(max, Number(n[1])) : max;
    }, 0) + 1;
  const srcToOutRid = new Map<string, string>();
  const newChromeRels: string[] = [];
  for (const [srcId, rel] of srcRels) {
    if (
      rel.type !== REL_TYPE_SLIDE_MASTER &&
      rel.type !== REL_TYPE_THEME &&
      rel.type !== REL_TYPE_NOTES_MASTER &&
      rel.type !== REL_TYPE_HANDOUT_MASTER
    ) {
      continue;
    }
    const outId = `rId${nextRid++}`;
    srcToOutRid.set(srcId, outId);
    newChromeRels.push(buildRelXml(outId, rel.type, rel.target));
  }

  // 3. Rebuild presentation.xml.rels: kept slide / props rels + new chrome rels.
  const rebuiltRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    keptRels.map(([id, r]) => buildRelXml(id, r.type, r.target)).join("") +
    newChromeRels.join("") +
    `</Relationships>`;
  outZip.file("ppt/_rels/presentation.xml.rels", rebuiltRels);

  // 4. Splice <p:sldMasterIdLst> and <p:notesMasterIdLst> from source into
  //    output's presentation.xml, with r:id values remapped to the new
  //    rIds allocated above. Anything else in the output (sldIdLst, sldSz,
  //    defaultTextStyle, etc.) is left alone — those describe the slide
  //    set pptxgenjs just wrote.
  let pres = outPresXml;
  pres = replaceListElement(
    pres,
    "p:sldMasterIdLst",
    extractListElement(srcPresXml, "p:sldMasterIdLst"),
    srcToOutRid
  );
  pres = replaceListElement(
    pres,
    "p:notesMasterIdLst",
    extractListElement(srcPresXml, "p:notesMasterIdLst"),
    srcToOutRid
  );
  // handoutMasterIdLst is rare but cheap to preserve.
  pres = replaceListElement(
    pres,
    "p:handoutMasterIdLst",
    extractListElement(srcPresXml, "p:handoutMasterIdLst"),
    srcToOutRid
  );

  // 5. Carry over `<p:embeddedFontLst>` verbatim so PowerPoint knows which
  //    embedded fonts to install on open. Font payloads under ppt/fonts/
  //    were already copied as part of the chrome sweep.
  const embeddedFonts = extractListElement(srcPresXml, "p:embeddedFontLst");
  if (embeddedFonts) {
    pres = replaceListElement(pres, "p:embeddedFontLst", embeddedFonts, srcToOutRid);
  }
  outZip.file("ppt/presentation.xml", pres);
}

function extractListElement(xml: string, tag: string): string | null {
  const open = xml.indexOf(`<${tag}`);
  if (open < 0) return null;
  // Self-closing form (`<p:sldMasterIdLst/>`) is legal but uninteresting.
  const selfCloseMatch = new RegExp(`<${tag}\\b[^>]*/\\s*>`).exec(xml);
  if (selfCloseMatch && selfCloseMatch.index === open) return null;
  const close = xml.indexOf(`</${tag}>`, open);
  if (close < 0) return null;
  return xml.slice(open, close + tag.length + 3);
}

function replaceListElement(
  xml: string,
  tag: string,
  newFragment: string | null,
  ridRemap: Map<string, string>
): string {
  if (!newFragment) return xml;
  const remapped = newFragment.replace(
    /\br:id="(rId\d+)"/g,
    (_m, srcRid: string) => {
      const out = ridRemap.get(srcRid);
      return out ? `r:id="${out}"` : `r:id="${srcRid}"`;
    }
  );
  const open = xml.indexOf(`<${tag}`);
  if (open < 0) {
    // Tag not in output → insert just before <p:sldIdLst> if possible,
    // otherwise just before </p:presentation>.
    const sldIdLst = xml.indexOf("<p:sldIdLst");
    if (sldIdLst >= 0) {
      return xml.slice(0, sldIdLst) + remapped + xml.slice(sldIdLst);
    }
    const closePres = xml.lastIndexOf("</p:presentation>");
    return closePres >= 0
      ? xml.slice(0, closePres) + remapped + xml.slice(closePres)
      : xml;
  }
  const selfCloseMatch = new RegExp(`<${tag}\\b[^>]*/\\s*>`).exec(xml);
  if (selfCloseMatch && selfCloseMatch.index === open) {
    return (
      xml.slice(0, selfCloseMatch.index) +
      remapped +
      xml.slice(selfCloseMatch.index + selfCloseMatch[0].length)
    );
  }
  const close = xml.indexOf(`</${tag}>`, open);
  if (close < 0) return xml;
  return xml.slice(0, open) + remapped + xml.slice(close + tag.length + 3);
}

async function rewriteSlideLayoutRefs(
  outZip: JSZip,
  srcZip: JSZip,
  deck: Deck,
  sourceSlidePaths: string[],
  onWarning?: (warning: SerializeWarning) => void
): Promise<void> {
  // Pre-compute a default fallback layout target for new slides that have
  // no source counterpart: the first slideLayout the source ships.
  let fallbackLayout: string | undefined;
  srcZip.forEach((relPath) => {
    if (fallbackLayout) return;
    if (
      relPath.startsWith("ppt/slideLayouts/") &&
      relPath.endsWith(".xml") &&
      !relPath.includes("/_rels/")
    ) {
      fallbackLayout = relPath;
    }
  });

  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const slideRelsPath = `ppt/slides/_rels/slide${i + 1}.xml.rels`;
    const outSlideRelsXml = await outZip.file(slideRelsPath)?.async("string");
    if (!outSlideRelsXml) continue;

    let layoutTargetFull: string | undefined;
    // A slide instantiated from a layout (see `addSlideFromLayout`) declares
    // its layout directly — point its rels at that layout's source part,
    // bypassing the source-slide → layout inference below. The id resolves
    // from `deck.layouts` (carried in the deck JSON) OR, when the host didn't
    // ship the layouts array, by the `slideLayoutN` id convention against the
    // source archive — so authoring `{ sourceLayoutId: "slideLayout7" }` works
    // with just the `{ source }` bytes.
    if (slide.sourceLayoutId) {
      const layout = deck.layouts?.find((l) => l.id === slide.sourceLayoutId);
      if (layout?.sourcePath) {
        layoutTargetFull = layout.sourcePath;
      } else {
        const byConvention = `ppt/slideLayouts/${slide.sourceLayoutId}.xml`;
        if (srcZip.file(byConvention)) layoutTargetFull = byConvention;
      }
      if (!layoutTargetFull) {
        const message =
          `[slidewise/pptx] slide ${i + 1}: sourceLayoutId ` +
          `"${slide.sourceLayoutId}" matched no layout in deck.layouts nor ` +
          `ppt/slideLayouts/${slide.sourceLayoutId}.xml in the source; ` +
          "falling back to the first source layout.";
        console.warn(message);
        onWarning?.({
          code: "layout-unresolved",
          message,
          slideIndex: i,
          layoutId: slide.sourceLayoutId,
        });
      }
    }
    const sourceSlidePath = resolveSourceSlidePath(slide, i, sourceSlidePaths);
    if (!layoutTargetFull && sourceSlidePath) {
      const srcSlideRelsPath = relsPathFor(sourceSlidePath);
      const srcSlideRelsXml = await srcZip
        .file(srcSlideRelsPath)
        ?.async("string");
      if (srcSlideRelsXml) {
        const srcRels = parseRels(srcSlideRelsXml);
        for (const rel of srcRels.values()) {
          if (
            rel.type ===
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"
          ) {
            layoutTargetFull = normalisePath(
              rel.target,
              dirOf(sourceSlidePath)
            );
            break;
          }
        }
      }
    }
    if (!layoutTargetFull && fallbackLayout) {
      layoutTargetFull = fallbackLayout;
    }
    if (!layoutTargetFull) continue;

    // Rewrite the layout target in the output's slide rels. The slide XML
    // itself lives at ppt/slides/slideN.xml, so targets there are
    // relative to ppt/slides/.
    const newTarget = relativeTarget("ppt/slides", layoutTargetFull);
    const updated = outSlideRelsXml.replace(
      /(<Relationship\b[^/]*Type="[^"]*slideLayout"[^/]*Target=")([^"]+)("[^/]*\/>)/,
      `$1${newTarget}$3`
    );
    if (updated !== outSlideRelsXml) {
      outZip.file(slideRelsPath, updated);
    }
  }
}

interface DeckAspects {
  outputAspect?: number;
  sourceAspect?: number;
}

async function readDeckAspects(
  outZip: JSZip,
  srcZip: JSZip
): Promise<DeckAspects> {
  const [outPres, srcPres] = await Promise.all([
    outZip.file("ppt/presentation.xml")?.async("string"),
    srcZip.file("ppt/presentation.xml")?.async("string"),
  ]);
  const outSz = outPres ? parseSldSz(outPres) : null;
  const srcSz = srcPres ? parseSldSz(srcPres) : null;
  return {
    ...(outSz ? { outputAspect: outSz.cx / outSz.cy } : {}),
    ...(srcSz ? { sourceAspect: srcSz.cx / srcSz.cy } : {}),
  };
}

function aspectsMatch(a: DeckAspects): boolean {
  if (a.outputAspect == null || a.sourceAspect == null) return false;
  // ~1% tolerance covers floating-point drift; PPTX aspect ratios are
  // exact integer EMU.
  return Math.abs(a.outputAspect - a.sourceAspect) / a.outputAspect < 0.01;
}

function parseSldSz(xml: string): { cx: number; cy: number } | null {
  const m = /<p:sldSz\b[^/]*\bcx="(\d+)"[^/]*\bcy="(\d+)"/.exec(xml);
  if (!m) {
    const m2 = /<p:sldSz\b[^/]*\bcy="(\d+)"[^/]*\bcx="(\d+)"/.exec(xml);
    if (!m2) return null;
    return { cx: Number(m2[2]), cy: Number(m2[1]) };
  }
  return { cx: Number(m[1]), cy: Number(m[2]) };
}

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const POTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.template";

// Main-part content types declared in `[Content_Types].xml`. A presentation
// and a template share an otherwise-identical package; only this override
// distinguishes them.
const PRESENTATION_MAIN_CT =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const TEMPLATE_MAIN_CT =
  "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml";

/** Does this OOXML package declare its main part as a template (`.potx`)? */
async function isTemplateArchive(zip: JSZip): Promise<boolean> {
  const file = zip.file("[Content_Types].xml");
  if (!file) return false;
  const xml = await file.async("string");
  return xml.includes(TEMPLATE_MAIN_CT);
}

/**
 * DEFLATE the package on write. JSZip defaults to `STORE` (no compression), so
 * without this every part — including the slide XML, which routinely runs into
 * the megabytes and compresses ~90% — ships uncompressed. That alone inflated a
 * 1.5 MB source deck to ~6 MB on save. DEFLATE matches what PowerPoint itself
 * (and the original archive) does. Level 6 is the standard speed/ratio balance;
 * already-compressed media (PNG/JPEG) simply doesn't shrink further, at
 * negligible CPU cost.
 */
const ZIP_OUTPUT_OPTIONS = {
  type: "blob",
  compression: "DEFLATE",
  compressionOptions: { level: 6 },
} as const;

/**
 * Generate the final Blob, flipping the main-part content type to the template
 * variant first when emitting a `.potx`. pptxgenjs always writes the
 * presentation content type, so the template path rewrites it in place.
 */
async function finalizeOutput(
  outZip: JSZip,
  asTemplate: boolean
): Promise<Blob> {
  if (!asTemplate) {
    return outZip.generateAsync({ ...ZIP_OUTPUT_OPTIONS, mimeType: PPTX_MIME });
  }
  const file = outZip.file("[Content_Types].xml");
  if (file) {
    const xml = await file.async("string");
    if (xml.includes(PRESENTATION_MAIN_CT)) {
      outZip.file(
        "[Content_Types].xml",
        xml.replace(PRESENTATION_MAIN_CT, TEMPLATE_MAIN_CT)
      );
    }
  }
  return outZip.generateAsync({ ...ZIP_OUTPUT_OPTIONS, mimeType: POTX_MIME });
}

// -- helpers ----------------------------------------------------------------

function hexNoHash(color: string): string {
  if (!color) return "000000";
  const c = color.trim();
  if (c.startsWith("#")) return c.slice(1).toUpperCase();
  // rgba()/rgb() → strip; pptxgenjs only accepts hex.
  const rgb = c.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => parseInt(p.trim(), 10));
    if (parts.length >= 3) {
      return parts
        .slice(0, 3)
        .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    }
  }
  return c.toUpperCase();
}

function isDataUrl(src: string): boolean {
  return /^data:image\//i.test(src);
}

/** A background that means "inherit from layout/master" rather than paint a
 *  fill — used to decide whether to strip a layout-instantiated slide's bg. */
function isInheritedBackground(bg: string | undefined): boolean {
  return !bg || bg === "transparent" || bg === "none";
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// -- Synthesised-OOXML post-process (PRs 1–7) ------------------------------

/**
 * Splice the synthesised shape / group / chart OOXML accumulated in
 * `synthBySlide` into the generated zip. Rewrites marker rIds to fresh
 * per-slide rIds and writes media + chart parts as needed.
 */
async function applySynth(outZip: JSZip, deck: Deck): Promise<void> {
  for (let i = 0; i < deck.slides.length; i++) {
    const synth = synthBySlide.get(i);
    if (!synth) continue;
    const slidePath = `ppt/slides/slide${i + 1}.xml`;
    const relsPath = `ppt/slides/_rels/slide${i + 1}.xml.rels`;
    const slideFile = outZip.file(slidePath);
    if (!slideFile) continue;
    let slideXml = await slideFile.async("string");

    let relsXml =
      (await outZip.file(relsPath)?.async("string")) ??
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

    const rels = parseRels(relsXml);
    let nextRid = highestRid(rels) + 1;
    const newRelLines: string[] = [];

    // Rewrite each synth item's marker rIds (and write chart parts) in
    // emission order, carrying each item's z-anchor through. Marker rIds embed
    // their owning element id, so we walk shapes in emission order and pair
    // each *first-seen* marker with a media payload of the matching scope.
    const mediaQueue = [...synth.media];
    const consumeMedia = (): MediaPayload | undefined => mediaQueue.shift();
    const blobs: { xml: string; after: string | null }[] = [];
    for (const item of synth.items) {
      if (item.kind === "shape") {
        let rewritten = item.xml;
        const markers = unique(item.xml.match(RID_MARKER_RE) ?? []);
        for (const marker of markers) {
          const rid = `rId${nextRid++}`;
          rewritten = rewritten.replaceAll(marker, rid);
          const media = consumeMedia();
          if (media) {
            outZip.file(media.fullPath, media.data, { binary: true });
            newRelLines.push(buildRelXml(rid, media.relType, media.relTarget));
          }
        }
        blobs.push({ xml: rewritten, after: item.after });
        continue;
      }
      // Chart: rewrite marker rIds, write part + rels, register Content_Types.
      const chart = item.result;
      const ridMarkers = unique(chart.graphicFrameXml.match(RID_MARKER_RE) ?? []);
      let frame = chart.graphicFrameXml;
      for (const marker of ridMarkers) {
        const rid = `rId${nextRid++}`;
        frame = frame.replaceAll(marker, rid);
        // Slide rels target is relative to ppt/slides. Chart part lives at
        // ppt/charts/chartSW_X.xml.
        const target = `../charts/${chart.partPath.replace(/^ppt\/charts\//, "")}`;
        newRelLines.push(
          buildRelXml(
            rid,
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
            target
          )
        );
      }
      outZip.file(chart.partPath, chart.chartXml);
      outZip.file(chart.partRelsPath, chart.chartRelsXml);
      await registerChartContentType(outZip, chart.partPath);
      blobs.push({ xml: frame, after: item.after });
    }

    // Insert each synth blob at its z-anchor: directly after the pptxgenjs
    // node it sits on top of (matched by `cNvPr.name`), or at the back of the
    // spTree when it's below every pptxgenjs node. This is what keeps a synth
    // chart / custGeom "svg" / connector from being buried under the
    // background cards pptxgenjs wrote after it.
    slideXml = insertSynthBlobs(slideXml, blobs);

    // PR 7: splice `<a:effectLst>` into pptxgenjs-emitted shapes by name.
    if (synth.effectsByName.size) {
      slideXml = spliceEffectsByName(slideXml, synth.effectsByName);
    }

    // Re-apply per-run letter-case (`<a:rPr cap>`) pptxgenjs can't emit.
    if (synth.capRunsByName.size) {
      slideXml = spliceRunCapsByName(slideXml, synth.capRunsByName);
    }

    if (newRelLines.length) {
      const insertAt = relsXml.lastIndexOf("</Relationships>");
      relsXml =
        insertAt >= 0
          ? relsXml.slice(0, insertAt) +
            newRelLines.join("") +
            relsXml.slice(insertAt)
          : relsXml.replace(
              /<Relationships[^>]*>/,
              (m) => `${m}${newRelLines.join("")}`
            );
      outZip.file(relsPath, relsXml);
    }
    outZip.file(slidePath, slideXml);
  }
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

async function registerChartContentType(
  outZip: JSZip,
  partPath: string
): Promise<void> {
  const ctFile = outZip.file("[Content_Types].xml");
  if (!ctFile) return;
  const xml = await ctFile.async("string");
  if (xml.includes(`PartName="/${partPath}"`)) return;
  const override = `<Override PartName="/${partPath}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
  const close = xml.lastIndexOf("</Types>");
  if (close < 0) return;
  outZip.file(
    "[Content_Types].xml",
    xml.slice(0, close) + override + xml.slice(close)
  );
}

/**
 * Splice an `<a:effectLst>...</a:effectLst>` block into each `<p:sp>` /
 * `<p:cxnSp>` whose `<p:cNvPr name="..."/>` matches one of the keys.
 * Inserts the block just before `</p:spPr>`, replacing any existing
 * effectLst inside the same spPr.
 */
function spliceEffectsByName(
  slideXml: string,
  effectsByName: Map<string, string>
): string {
  // Match whole `<p:sp>…</p:sp>` blocks (so we don't accidentally consume
  // the outer `<p:nvGrpSpPr>` cNvPr's tail into the next shape's spPr).
  return slideXml.replace(
    /<p:sp\b[\s\S]*?<\/p:sp>/g,
    (sp: string) => {
      const nameMatch = /<p:cNvPr\b[^>]*?name="([^"]*)"/.exec(sp);
      if (!nameMatch || !nameMatch[1]) return sp;
      const eff = effectsByName.get(nameMatch[1]);
      if (!eff) return sp;
      // Insert just before the FIRST `</p:spPr>` inside the shape; that's
      // the spPr that owns the visual properties. Strip any existing empty
      // effectLst before splicing.
      const cleaned = sp.replace(/<a:effectLst\s*\/>/, "");
      const at = cleaned.indexOf("</p:spPr>");
      if (at < 0) return sp;
      return cleaned.slice(0, at) + eff + cleaned.slice(at);
    }
  );
}

/**
 * Re-apply per-run letter-case (`<a:rPr cap="all"|"small">`) into each
 * pptxgenjs-emitted text `<p:sp>` whose `<p:cNvPr name>` matches a key. The
 * value is one cap per emitted run (`<a:r>`) in document order — pptxgenjs has
 * no `cap` option, so the importer's `TextRun.cap` would otherwise be lost on
 * export. Runs already carry an `<a:rPr>` (our run items are styled); the cap
 * attribute is inserted into it (one is added if somehow absent).
 */
function spliceRunCapsByName(
  slideXml: string,
  capRunsByName: Map<string, (("all" | "small") | null)[]>
): string {
  return slideXml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (sp: string) => {
    const nameMatch = /<p:cNvPr\b[^>]*?name="([^"]*)"/.exec(sp);
    if (!nameMatch || !nameMatch[1]) return sp;
    const caps = capRunsByName.get(nameMatch[1]);
    if (!caps || !caps.length) return sp;
    let k = 0;
    return sp.replace(/<a:r>[\s\S]*?<\/a:r>/g, (run: string) => {
      const cap = caps[k++];
      if (!cap) return run;
      if (/<a:rPr\b[^>]*\bcap=/.test(run)) return run; // already set
      if (/<a:rPr\b/.test(run)) {
        return run.replace(/<a:rPr\b/, `<a:rPr cap="${cap}"`);
      }
      // No rPr (rare): insert a minimal one before the text.
      return run.replace(/<a:r>/, `<a:r><a:rPr cap="${cap}"/>`);
    });
  });
}

/**
 * Write JSON-defined gradient / image slide backgrounds (PR 3). Only fires
 * when the source-PPTX bg preservation pass left the slide's `<p:bg>` empty
 * — that ensures source bytes always win.
 */
async function applySynthSlideBackgrounds(
  outZip: JSZip,
  deck: Deck
): Promise<void> {
  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const parsed = parseFill(slide.background);
    if (!parsed) continue;
    if (parsed.kind === "solid") continue;
    // A layout-instantiated slide with an inherited (transparent) background
    // must stay `<p:bg>`-less so the layout / master / theme background shows
    // through. `preserveSlideBackgrounds` already stripped pptxgenjs's bg for
    // this slide; synthesising an explicit `<a:noFill/>` here would re-assert
    // an empty background and override the inheritance the host is relying on.
    if (parsed.kind === "transparent" && slide.sourceLayoutId) continue;
    const slidePath = `ppt/slides/slide${i + 1}.xml`;
    const relsPath = `ppt/slides/_rels/slide${i + 1}.xml.rels`;
    const slideFile = outZip.file(slidePath);
    if (!slideFile) continue;
    let slideXml = await slideFile.async("string");

    // If the slide already has a non-solid `<p:bg>` (source preservation
    // wrote one), leave it alone. Solid `<p:bg>` from pptxgenjs gets
    // overwritten below — that's what we want.
    const existing = /<p:bg\b[\s\S]*?<\/p:bg>|<p:bg\b[^>]*\/\s*>/.exec(slideXml);
    if (existing) {
      // Detect "this is a richer bg than solid" by looking for gradFill /
      // blipFill / pattFill — those come from source preservation.
      if (/<a:gradFill|<a:blipFill|<a:pattFill/.test(existing[0])) continue;
    }

    const synth = synthesiseSlideBg(slide);
    if (!synth.xml) continue;
    let bgXml = synth.xml;

    let relsXml =
      (await outZip.file(relsPath)?.async("string")) ??
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    if (synth.media.length) {
      const rels = parseRels(relsXml);
      let nextRid = highestRid(rels) + 1;
      const newRelLines: string[] = [];
      const markers = unique(bgXml.match(RID_MARKER_RE) ?? []);
      for (let mi = 0; mi < markers.length; mi++) {
        const rid = `rId${nextRid++}`;
        bgXml = bgXml.replaceAll(markers[mi], rid);
        const media = synth.media[mi];
        if (!media) break;
        outZip.file(media.fullPath, media.data, { binary: true });
        newRelLines.push(buildRelXml(rid, media.relType, media.relTarget));
      }
      if (newRelLines.length) {
        const at = relsXml.lastIndexOf("</Relationships>");
        relsXml =
          at >= 0
            ? relsXml.slice(0, at) + newRelLines.join("") + relsXml.slice(at)
            : relsXml.replace(
                /<Relationships[^>]*>/,
                (m) => `${m}${newRelLines.join("")}`
              );
        outZip.file(relsPath, relsXml);
      }
    }

    if (existing) {
      slideXml = slideXml.replace(
        /<p:bg\b[\s\S]*?<\/p:bg>|<p:bg\b[^>]*\/\s*>/,
        bgXml
      );
    } else {
      const cSldOpen = /<p:cSld\b[^>]*>/.exec(slideXml);
      if (cSldOpen) {
        const at = cSldOpen.index + cSldOpen[0].length;
        slideXml = slideXml.slice(0, at) + bgXml + slideXml.slice(at);
      }
    }
    outZip.file(slidePath, slideXml);
  }
}

/**
 * Write JSON-defined embedded fonts (PR 6). Only fires when chrome
 * preservation didn't already copy fonts from a source — that's detected
 * by checking whether `ppt/fonts/` is populated.
 */
async function applyEmbeddedFontsFromJson(
  outZip: JSZip,
  deck: Deck
): Promise<void> {
  if (!deck.fonts || !deck.fonts.length) return;
  const existingFonts: string[] = [];
  outZip.forEach((path) => {
    if (path.startsWith("ppt/fonts/") && path.endsWith(".fntdata")) {
      existingFonts.push(path);
    }
  });
  if (existingFonts.length) return;

  const descriptors = await synthesiseEmbeddedFonts(deck.fonts);
  if (!descriptors.length) return;

  // Write font bytes.
  for (const d of descriptors) {
    for (const p of d.payloads) {
      outZip.file(p.fullPath, p.data, { binary: true });
    }
  }

  // Register `.fntdata` Default content type.
  const ctFile = outZip.file("[Content_Types].xml");
  if (ctFile) {
    let ct = await ctFile.async("string");
    if (!/Extension="fntdata"/i.test(ct)) {
      ct = ct.replace(
        /<Types\b[^>]*>/,
        (m) =>
          `${m}<Default Extension="fntdata" ContentType="application/x-fontdata"/>`
      );
      outZip.file("[Content_Types].xml", ct);
    }
  }

  // Add font rels to presentation.xml.rels and rewrite the marker rIds in
  // each `<p:embeddedFont>` to those allocated rIds.
  const presRelsFile = outZip.file("ppt/_rels/presentation.xml.rels");
  if (!presRelsFile) return;
  let presRelsXml = await presRelsFile.async("string");
  const presRels = parseRels(presRelsXml);
  let nextRid = highestRid(presRels) + 1;
  const newRels: string[] = [];
  const embeddedFontXml: string[] = [];
  for (const d of descriptors) {
    let xml = d.embeddedFontXml;
    for (const r of d.rels) {
      const rid = `rId${nextRid++}`;
      xml = xml.replaceAll(r.ridMarker, rid);
      newRels.push(buildRelXml(rid, r.relType, r.target));
    }
    embeddedFontXml.push(xml);
  }
  const insertAt = presRelsXml.lastIndexOf("</Relationships>");
  presRelsXml =
    insertAt >= 0
      ? presRelsXml.slice(0, insertAt) +
        newRels.join("") +
        presRelsXml.slice(insertAt)
      : presRelsXml.replace(
          /<Relationships[^>]*>/,
          (m) => `${m}${newRels.join("")}`
        );
  outZip.file("ppt/_rels/presentation.xml.rels", presRelsXml);

  // Splice `<p:embeddedFontLst>` into presentation.xml (after sldIdLst).
  const presFile = outZip.file("ppt/presentation.xml");
  if (!presFile) return;
  let presXml = await presFile.async("string");
  const fontLst = `<p:embeddedFontLst>${embeddedFontXml.join("")}</p:embeddedFontLst>`;
  if (/<p:embeddedFontLst\b/.test(presXml)) {
    presXml = presXml.replace(
      /<p:embeddedFontLst\b[\s\S]*?<\/p:embeddedFontLst>/,
      fontLst
    );
  } else {
    const after = /<\/p:sldIdLst>/.exec(presXml);
    if (after) {
      const at = after.index + after[0].length;
      presXml = presXml.slice(0, at) + fontLst + presXml.slice(at);
    }
  }
  outZip.file("ppt/presentation.xml", presXml);
}

/**
 * Strip `<Override>` entries from `[Content_Types].xml` whose `PartName`
 * doesn't correspond to a file actually present in the output zip.
 *
 * pptxgenjs has a long-standing quirk: it declares `slideMaster1.xml`
 * through `slideMasterN.xml` (one per slide) even though it only ever
 * writes `slideMaster1.xml`. PowerPoint enforces the manifest strictly
 * and refuses to open the file when declared parts are missing
 * ("PowerPoint found a problem with content"). Keynote is lenient and
 * just emits the "may look different" warning. Removing the stale
 * overrides makes the file legal for both apps.
 */
async function pruneDanglingContentTypes(outZip: JSZip): Promise<void> {
  const ctFile = outZip.file("[Content_Types].xml");
  if (!ctFile) return;
  const xml = await ctFile.async("string");
  // Collect every actual file path in the zip so we can answer "does
  // /foo/bar.xml exist?" in O(1).
  const existing = new Set<string>();
  outZip.forEach((path, entry) => {
    if (!entry.dir) existing.add("/" + path);
  });
  // `[^>]*` (not `[^/]*`) so ContentType values containing slashes —
  // every PPTX MIME type does — don't break the match.
  const pruned = xml.replace(
    /<Override\b[^>]*PartName="([^"]+)"[^>]*\/>/g,
    (match, partName: string) => (existing.has(partName) ? match : "")
  );
  if (pruned !== xml) outZip.file("[Content_Types].xml", pruned);
}

/**
 * Reorder top-level children of `<p:presentation>` to match the OOXML
 * schema's required sequence. pptxgenjs emits
 *   sldMasterIdLst → sldIdLst → notesMasterIdLst → sldSz → notesSz
 * but CT_Presentation mandates
 *   sldMasterIdLst → notesMasterIdLst → handoutMasterIdLst → sldIdLst
 *   → sldSz → notesSz → … → embeddedFontLst → …
 * Out-of-sequence `notesMasterIdLst` (and `embeddedFontLst` if PR 6 ran)
 * triggers PowerPoint's "found a problem with content" repair dialog
 * even though the underlying content is valid. Keynote is lenient and
 * just renders.
 *
 * We don't rebuild the XML; we just relocate the affected elements,
 * preserving their inner text verbatim. Safe to call when the elements
 * are already in order — the function is a no-op.
 */
async function sanitisePresentationXml(outZip: JSZip): Promise<void> {
  const file = outZip.file("ppt/presentation.xml");
  if (!file) return;
  let xml = await file.async("string");
  const original = xml;

  // The schema-correct slot for notesMasterIdLst is immediately after
  // sldMasterIdLst and before sldIdLst.
  const extractBlock = (tag: string): string | null => {
    const re = new RegExp(`<p:${tag}\\b[^>]*>[\\s\\S]*?</p:${tag}>`);
    const m = re.exec(xml);
    if (!m) return null;
    xml = xml.slice(0, m.index) + xml.slice(m.index + m[0].length);
    return m[0];
  };

  const insertAfter = (anchorTag: string, block: string): void => {
    const closeAnchor = `</p:${anchorTag}>`;
    const idx = xml.indexOf(closeAnchor);
    if (idx < 0) return;
    const at = idx + closeAnchor.length;
    xml = xml.slice(0, at) + block + xml.slice(at);
  };

  const notesBlock = extractBlock("notesMasterIdLst");
  if (notesBlock) insertAfter("sldMasterIdLst", notesBlock);

  const handoutBlock = extractBlock("handoutMasterIdLst");
  if (handoutBlock) {
    // handoutMasterIdLst sits between notesMasterIdLst (if present) and
    // sldIdLst. If notes was just inserted, anchor on it; otherwise on
    // sldMasterIdLst.
    const anchor = /\<\/p:notesMasterIdLst\>/.test(xml)
      ? "notesMasterIdLst"
      : "sldMasterIdLst";
    insertAfter(anchor, handoutBlock);
  }

  // embeddedFontLst belongs AFTER smartTags / before custShowLst — in
  // practice, immediately after notesSz works for every deck we emit.
  const fontLstBlock = extractBlock("embeddedFontLst");
  if (fontLstBlock) {
    // notesSz is self-closing in pptxgenjs output, so we look for the
    // self-closing tag end.
    const m = /<p:notesSz\b[^>]*\/>/.exec(xml);
    if (m) {
      const at = m.index + m[0].length;
      xml = xml.slice(0, at) + fontLstBlock + xml.slice(at);
    } else {
      // Fallback: put it back where we found it. Shouldn't happen — every
      // pptxgenjs deck has notesSz.
      insertAfter("sldIdLst", fontLstBlock);
    }
  }

  if (xml !== original) outZip.file("ppt/presentation.xml", xml);
}

/**
 * Strip insignificant whitespace from every `.rels` file in the zip.
 * pptxgenjs writes some rels files (notesMaster1, notesSlideN) with
 * pretty-printed indentation including whitespace BETWEEN the XML
 * declaration and the `<Relationships>` root. PowerPoint's strict
 * package validator rejects this even though plain XML 1.0 allows
 * whitespace in the prolog. Keynote is lenient.
 *
 * Conservative: only collapses whitespace OUTSIDE the
 * Relationships element and between its children — both are
 * element-only content models with no semantic whitespace.
 */
async function sanitiseRels(outZip: JSZip): Promise<void> {
  const relsPaths: string[] = [];
  outZip.forEach((path) => {
    if (path.endsWith(".rels")) relsPaths.push(path);
  });
  for (const p of relsPaths) {
    const file = outZip.file(p);
    if (!file) continue;
    const xml = await file.async("string");
    let updated = xml;
    // Drop whitespace between `?>` and `<Relationships`.
    updated = updated.replace(/(\?>)\s+(<Relationships\b)/, "$1$2");
    // Drop whitespace BETWEEN `<Relationship .../>` children.
    updated = updated.replace(
      /(<Relationship\b[^>]*\/>)\s+(<(?:Relationship\b|\/Relationships>))/g,
      "$1$2"
    );
    // Drop whitespace immediately before `</Relationships>` close.
    updated = updated.replace(/\s+<\/Relationships>/, "</Relationships>");
    // Drop whitespace inside the `<Relationships>` open tag's content area.
    updated = updated.replace(/(<Relationships\b[^>]*>)\s+(<Relationship\b)/, "$1$2");
    if (updated !== xml) outZip.file(p, updated);
  }
}

/**
 * Drop empty directory entries from the zip. pptxgenjs adds
 * `ppt/charts/`, `ppt/charts/_rels/`, `ppt/embeddings/` (and similar)
 * as zip directory entries even when no chart / embedding ever lands.
 * PowerPoint validates the package and the empty `ppt/charts/_rels/`
 * with no `ppt/charts/*.xml` is one of the patterns it flags.
 *
 * Synchronous — JSZip's `forEach` + `remove` are both sync.
 */
function pruneEmptyDirectories(outZip: JSZip): void {
  const filePaths: string[] = [];
  const dirPaths: string[] = [];
  outZip.forEach((path, entry) => {
    if (entry.dir) dirPaths.push(path);
    else filePaths.push(path);
  });
  for (const dir of dirPaths) {
    const prefix = dir.endsWith("/") ? dir : dir + "/";
    const hasContent = filePaths.some((f) => f.startsWith(prefix));
    if (!hasContent) outZip.remove(dir);
  }
}

/**
 * Walk every `ppt/slides/slideN.xml` and collapse consecutive `<a:pPr>`
 * elements inside the same `<a:p>` to a single one. pptxgenjs sometimes
 * emits two adjacent `<a:pPr>` blocks (typically when a multi-run text
 * item with `breakLine` lands at a paragraph boundary) — CT_TextParagraph
 * permits only one `pPr` per `<a:p>`, so PowerPoint flags the file as
 * corrupt and offers to repair. Keynote is lenient and silently merges.
 *
 * The collapsed form keeps the FIRST occurrence (matches what PowerPoint
 * resolves to in practice). When the two are identical it's a no-op
 * semantically; when they differ, the first wins.
 */
async function sanitiseSlideXml(outZip: JSZip): Promise<void> {
  const slidePaths: string[] = [];
  outZip.forEach((path) => {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(path)) slidePaths.push(path);
  });
  for (const p of slidePaths) {
    const file = outZip.file(p);
    if (!file) continue;
    const xml = await file.async("string");
    // Match a `<a:pPr>` (with or without children) followed immediately
    // by another `<a:pPr>` and drop the second. Repeat until no more
    // pairs remain so 3+ consecutive blocks collapse to one.
    const pprPair =
      /(<a:pPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:pPr>))(<a:pPr\b[^>]*(?:\/>|>[\s\S]*?<\/a:pPr>))/g;
    let updated = xml;
    let prev;
    do {
      prev = updated;
      updated = updated.replace(pprPair, "$1");
    } while (updated !== prev);
    // pptxgenjs writes some element-only nodes with whitespace text
    // between open/close (`<p:cNvPr …>    </p:cNvPr>`) which PowerPoint
    // flags. Collapse to self-closing for elements that only have
    // whitespace content. Restricted to nvSpPr/cNvPr-style empties so we
    // don't accidentally normalise text frames.
    updated = updated.replace(
      /<(p:cNvPr|p:nvPr|p:cNvSpPr|p:cNvGrpSpPr|p:cNvPicPr|a:ln|a:avLst|a:lstStyle|a:bodyPr|a:gdLst|a:ahLst|a:cxnLst)\b([^>]*)>\s+<\/\1>/g,
      "<$1$2/>"
    );
    if (updated !== xml) outZip.file(p, updated);
  }
}

// -- Package invariant: every internal rel target resolves to a part --------

/**
 * Basename prefix the preserve paths stamp onto copied-in parts to dodge
 * collisions with whatever pptxgenjs already wrote (`uniqueTarget`,
 * `slidewise_chrome_*`). Used by the dangling-rel repair below to recover the
 * original part name a rel should resolve to.
 */
const PRESERVE_PREFIX_RE = /^slidewise_(?:preserved|chrome)_\d+_/;

/**
 * Relationship types that are SAFE to drop when their target part is missing:
 * each is optional in the package and removing it leaves a still-valid file.
 * Critical *implicit* rels (slideLayout, slideMaster, theme) are deliberately
 * absent — a slide without its layout (or a layout without its master) is just
 * as invalid as one pointing at a missing part, so dropping those would only
 * trade one corruption for another. Those shouldn't dangle anyway
 * (rewriteSlideLayoutRefs / preserveDeckChrome repoint them); if one ever does
 * we keep it and warn rather than make the package worse.
 *
 * Matched against the last path segment of the relationship Type URI.
 */
const DROPPABLE_REL_TYPES = new Set([
  "notesMaster",
  "notesSlide",
  "tags",
  "comments",
  "commentAuthors",
  "glossaryDocument",
]);

function relTypeSuffix(type: string): string {
  const slash = type.lastIndexOf("/");
  return slash >= 0 ? type.slice(slash + 1) : type;
}

/** The owning part directory for a `*.rels` file, e.g.
 * `ppt/slides/_rels/slide1.xml.rels` → `ppt/slides`, `_rels/.rels` → ``. */
function ownerDirForRels(relsPath: string): string {
  const stripped = relsPath.replace(/(^|\/)_rels\/[^/]+$/, "");
  return stripped === relsPath ? dirOf(relsPath) : stripped;
}

/**
 * Final guard: every INTERNAL relationship target must resolve to a part that
 * actually ships in the package. PowerPoint flags a repair (and stricter
 * consumers reject outright) when a `.rels` points at a missing part.
 *
 * Two danglers slip past the individual preserve paths:
 *
 *  - **Renamed-but-clobbered** (e.g. `tags`): `injectIntoSlide` copies a
 *    slide-referenced part under a `slidewise_preserved_N_` name and points the
 *    slide rel there, but `preserveDeckChrome` later wipes the whole
 *    `ppt/tags/` (a chrome prefix) and re-copies the source parts under their
 *    ORIGINAL names. The prefixed copy is gone; the rel dangles. Here the part
 *    still exists under its de-prefixed name, so we re-point the rel at it.
 *
 *  - **Genuinely absent** (e.g. `notesMaster`): pptxgenjs writes a notesSlide
 *    per slide, each rel-linked to `notesMasters/notesMaster1.xml`, then
 *    `preserveDeckChrome` removes that part (chrome prefix) without a source
 *    replacement when the source has no notes master. Nothing resolves it, so
 *    we drop the relationship — but only when the slide/notes body doesn't
 *    reference its rId (implicit rels like `notesMaster` never do; dropping a
 *    body-referenced rId would just move the corruption into the XML).
 *
 * Exported for direct unit testing.
 */
export async function reconcileDanglingRels(outZip: JSZip): Promise<void> {
  const present = new Set<string>();
  outZip.forEach((path, entry) => {
    if (!entry.dir) present.add(path);
  });

  const relsPaths: string[] = [];
  outZip.forEach((path, entry) => {
    if (!entry.dir && path.endsWith(".rels")) relsPaths.push(path);
  });

  for (const relsPath of relsPaths) {
    const file = outZip.file(relsPath);
    if (!file) continue;
    const xml = await file.async("string");
    const ownerDir = ownerDirForRels(relsPath);

    // The body of the part this rels file describes — read lazily, only when a
    // drop candidate appears, so we can check whether its rId is referenced.
    const ownerPath = relsPath.replace(/(^|\/)_rels\/([^/]+)\.rels$/, "$1$2");
    let ownerBody: string | null | undefined;
    const ownerReferences = async (rid: string): Promise<boolean> => {
      if (ownerBody === undefined) {
        ownerBody = (await outZip.file(ownerPath)?.async("string")) ?? null;
      }
      return ownerBody != null && new RegExp(`"${rid}"`).test(ownerBody);
    };

    let changed = false;
    const rewritten: string[] = [];
    let last = 0;
    const re = /<Relationship\b[^>]*?\/>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const tag = m[0];
      rewritten.push(xml.slice(last, m.index));
      last = m.index + tag.length;

      const mode = /\bTargetMode="([^"]+)"/.exec(tag)?.[1];
      const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
      const id = /\bId="([^"]+)"/.exec(tag)?.[1];
      const type = /\bType="([^"]+)"/.exec(tag)?.[1];
      const isExternal =
        mode === "External" || (target ? /^https?:\/\//i.test(target) : false);
      if (!target || !id || isExternal) {
        rewritten.push(tag);
        continue;
      }
      const full = normalisePath(target, ownerDir);
      if (present.has(full)) {
        rewritten.push(tag);
        continue;
      }

      // Try to recover the part under its de-prefixed (original) name.
      const slash = target.lastIndexOf("/");
      const dir = slash >= 0 ? target.slice(0, slash + 1) : "";
      const base = slash >= 0 ? target.slice(slash + 1) : target;
      const deprefixed = base.replace(PRESERVE_PREFIX_RE, "");
      if (deprefixed !== base) {
        const repairedTarget = `${dir}${deprefixed}`;
        if (present.has(normalisePath(repairedTarget, ownerDir))) {
          rewritten.push(
            tag.replace(/\bTarget="[^"]+"/, `Target="${repairedTarget}"`)
          );
          changed = true;
          continue;
        }
      }

      // Genuinely missing and unrepairable. Drop only when (a) the type is
      // safe to remove and (b) the owner body doesn't reference its rId —
      // dropping a body-referenced rId would just move the dangle into the
      // XML. Anything else we keep and warn about: there's no safe action,
      // and dropping a critical rel (e.g. a slide's only layout) would make
      // the package no less broken.
      const droppable = type ? DROPPABLE_REL_TYPES.has(relTypeSuffix(type)) : false;
      if (droppable && !(await ownerReferences(id))) {
        changed = true;
        continue; // (tag intentionally omitted — relationship removed.)
      }
      console.warn(
        `[slidewise/pptx] ${relsPath}: relationship ${id} → ${target} ` +
          "resolves to a missing part and cannot be safely repaired or dropped; " +
          "leaving it in place."
      );
      rewritten.push(tag);
    }
    if (!changed) continue;
    rewritten.push(xml.slice(last));
    outZip.file(relsPath, rewritten.join(""));
  }
}

// -- Bug fix: SVG markup written into the .png raster fallback ----------------

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const;

/** A valid 1×1 fully-transparent PNG, used as a last-resort raster fallback
 * when no rasterizer is available (SSR / Node) — a degraded-but-VALID image
 * beats SVG-bytes-in-a-.png, which corrupts the whole package for strict
 * consumers (Google Slides, LibreOffice, thumbnail renderers, OOXML
 * validators). PowerPoint itself renders from the `<asvg:svgBlip>` regardless.
 *
 * Every chunk's CRC-32 must be correct: the previous constant had a bad IDAT
 * CRC, which decodes in lenient readers but is rejected by the strict PNG/OOXML
 * validators this fallback exists to satisfy. Regenerate with a real encoder
 * (and re-verify chunk CRCs) if you ever change it. */
const TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";

function decodeBase64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64.replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const B = (
    globalThis as unknown as { Buffer?: { from(b: string, e: string): Uint8Array } }
  ).Buffer;
  if (B) return B.from(b64, "base64");
  throw new Error("[slidewise] no base64 decoder available");
}

function isPngBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === PNG_MAGIC[0] &&
    bytes[1] === PNG_MAGIC[1] &&
    bytes[2] === PNG_MAGIC[2] &&
    bytes[3] === PNG_MAGIC[3]
  );
}

/** True when the bytes are XML/SVG markup rather than a raster — i.e. the
 * first non-whitespace byte is `<` and an `<svg` tag appears near the start. */
function looksLikeSvgBytes(bytes: Uint8Array): boolean {
  let i = 0;
  // Skip a UTF-8 BOM, then leading whitespace.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    i = 3;
  }
  while (
    i < bytes.length &&
    (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)
  ) {
    i++;
  }
  if (bytes[i] !== 0x3c /* '<' */) return false;
  const head = new TextDecoder()
    .decode(bytes.subarray(i, Math.min(bytes.length, i + 512)))
    .toLowerCase();
  return head.includes("<svg");
}

/**
 * Rasterize SVG bytes to PNG bytes using the browser canvas pipeline. Returns
 * null when no canvas/Image API is available (SSR, Node, jsdom without SVG
 * rendering) or decoding fails — the caller then falls back to a valid
 * transparent PNG so the package is never left holding a corrupt one.
 */
async function rasterizeSvgToPng(svgBytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (
      typeof Image === "undefined" ||
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function"
    ) {
      return null;
    }
    const copy = new Uint8Array(svgBytes);
    const blob = new Blob([copy.buffer as ArrayBuffer], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("svg decode failed"));
        img.src = url;
      });
      const w = Math.max(1, Math.round(img.naturalWidth || img.width || 512));
      const h = Math.max(1, Math.round(img.naturalHeight || img.height || 512));
      let canvas: HTMLCanvasElement | OffscreenCanvas;
      if (typeof OffscreenCanvas !== "undefined") {
        canvas = new OffscreenCanvas(w, h);
      } else if (typeof document !== "undefined") {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        canvas = c;
      } else {
        return null;
      }
      const ctx = canvas.getContext("2d") as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, w, h);
      let outBlob: Blob | null;
      if ("convertToBlob" in canvas) {
        outBlob = await canvas.convertToBlob({ type: "image/png" });
      } else {
        outBlob = await new Promise<Blob | null>((resolve) =>
          (canvas as HTMLCanvasElement).toBlob((b) => resolve(b), "image/png")
        );
      }
      if (!outBlob) return null;
      const out = new Uint8Array(await outBlob.arrayBuffer());
      return isPngBytes(out) ? out : null;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

/**
 * pptxgenjs emits a dual-blip for SVG images (`<a:blip>` raster + an
 * `<asvg:svgBlip>` vector) but writes the SVG SOURCE into the `.png` raster
 * fallback part instead of a rasterized PNG (its `isSvgPng` rel carries the
 * SVG `data:` URL verbatim). The `.png` extension + `image/png` content type
 * are correct — only the bytes are wrong, so PowerPoint renders fine off the
 * svgBlip while every strict consumer rejects the bogus PNG.
 *
 * Replace those bytes with a real rasterized PNG when a canvas is available,
 * else a valid transparent PNG. The `<asvg:svgBlip>` .svg part is left intact.
 */
async function fixSvgRasterFallbacks(
  outZip: JSZip,
  rasterizeSvg?: SvgRasterizer
): Promise<void> {
  const pngPaths: string[] = [];
  outZip.forEach((path, entry) => {
    if (!entry.dir && /^ppt\/media\/.+\.png$/i.test(path)) pngPaths.push(path);
  });
  let placeholder: Uint8Array | null = null;
  for (const p of pngPaths) {
    const file = outZip.file(p);
    if (!file) continue;
    const bytes = await file.async("uint8array");
    if (isPngBytes(bytes) || !looksLikeSvgBytes(bytes)) continue;
    // Faithful first: a host-provided rasterizer (the only option on Node/SSR,
    // where there's no canvas), then the browser canvas pipeline. Only if both
    // decline do we degrade to a valid transparent PNG — never leave the part
    // holding SVG bytes.
    const raster =
      (await tryHostRasterizer(rasterizeSvg, bytes)) ??
      (await rasterizeSvgToPng(bytes)) ??
      (placeholder ??= decodeBase64ToBytes(TRANSPARENT_PNG_BASE64));
    outZip.file(p, raster, { binary: true });
  }
}

/**
 * Invoke a host {@link SvgRasterizer}, returning its bytes only when it
 * actually produced a valid PNG. Swallows throws and non-PNG output so a flaky
 * host engine can never corrupt the part — the caller then falls through to the
 * canvas pipeline or the transparent placeholder.
 */
async function tryHostRasterizer(
  rasterizeSvg: SvgRasterizer | undefined,
  svgBytes: Uint8Array
): Promise<Uint8Array | null> {
  if (!rasterizeSvg) return null;
  try {
    const out = await rasterizeSvg(svgBytes);
    return out && isPngBytes(out) ? out : null;
  } catch {
    return null;
  }
}
