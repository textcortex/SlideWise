import JSZip from "jszip";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { nanoid } from "nanoid";
import type {
  Deck,
  Slide,
  SlideElement,
  TextElement,
  TextRun,
  ShapeElement,
  ShapeKind,
  ImageElement,
  LineElement,
  TableElement,
  UnknownElement,
} from "@/lib/types";
import { SLIDE_W, SLIDE_H } from "@/lib/types";
import { emuToPx, pointsToPx } from "./units";
import type { ParseDiagnostics } from "./types";

/**
 * Linear transform from raw source-PPTX pixels (EMU/EMU_PER_PX) into
 * Slidewise's fixed 1920×1080 canvas. We pick a uniform scale that fits the
 * source slide entirely, then center it — preserves aspect, letterboxes when
 * source is 4:3 and target is 16:9.
 */
interface Fit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface Rels {
  byId: Map<string, { target: string; type: string }>;
}

interface ThemeColors {
  // Theme color scheme. Keys match OOXML schemeClr @val tokens.
  dk1: string;
  lt1: string;
  dk2: string;
  lt2: string;
  accent1: string;
  accent2: string;
  accent3: string;
  accent4: string;
  accent5: string;
  accent6: string;
  hlink: string;
  folHlink: string;
}

interface PlaceholderInfo {
  /** Geometry from layout/master in raw px (pre-fit). */
  rawX?: number;
  rawY?: number;
  rawW?: number;
  rawH?: number;
  rotation?: number;
  /** Default text style inherited when slide-level rPr is absent. */
  rPr?: any;
  pPr?: any;
  bodyPr?: any;
  /** Fallback paragraphs (used when the slide placeholder has no text). */
  paragraphs?: any[];
}

interface MasterTextDefaults {
  title?: any; // a:lvl1pPr (and friends) — we only use lvl1.
  body?: any;
  other?: any;
}

interface ParseContext {
  diagnostics: ParseDiagnostics;
  zip: JSZip;
  slidePath: string;
  slideRels: Rels;
  fit: Fit;
  theme: ThemeColors;
  layoutPh: Map<string, PlaceholderInfo>;
  masterPh: Map<string, PlaceholderInfo>;
  masterTextDefaults: MasterTextDefaults;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  preserveOrder: false,
  isArray: (name) => ARRAY_TAGS.has(name),
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: false,
  suppressEmptyNode: true,
});

// Tags that should always be arrays even when only one occurs.
const ARRAY_TAGS = new Set([
  "p:sp",
  "p:pic",
  "p:cxnSp",
  "p:graphicFrame",
  "p:grpSp",
  "a:p",
  "a:r",
  "a:tr",
  "a:tc",
  "Relationship",
]);

const DEFAULT_THEME: ThemeColors = {
  dk1: "#000000",
  lt1: "#FFFFFF",
  dk2: "#1F497D",
  lt2: "#EEECE1",
  accent1: "#4F81BD",
  accent2: "#C0504D",
  accent3: "#9BBB59",
  accent4: "#8064A2",
  accent5: "#4BACC6",
  accent6: "#F79646",
  hlink: "#0000FF",
  folHlink: "#800080",
};

/**
 * Parse a PPTX blob into a Slidewise Deck. Coverage:
 *  - Slide background (solid + theme color)
 *  - Text boxes with placeholder inheritance from layout/master, theme-color
 *    resolution, multi-run formatting, paragraph alignment, lineHeight
 *  - Preset shapes (rect, roundRect, ellipse, triangle, diamond, star — and
 *    many other prsts mapped to the closest available kind so they at least
 *    render with correct fill/position)
 *  - Images (embedded media → data URLs, srcRect crop preserved)
 *  - Connector lines (cxnSp) and shapes authored as prst="line"
 *  - Tables (basic row/cell content + header/body fills)
 *  - Group shapes (recursed and flattened with the group transform applied)
 *  - Anything else (charts, SmartArt, embedded video) is preserved as
 *    UnknownElement carrying its raw OOXML so a save round-trip can re-emit
 *    it without data loss.
 */
export async function parsePptx(blob: Blob | ArrayBuffer): Promise<Deck> {
  const zip = await JSZip.loadAsync(blob);
  const diagnostics: ParseDiagnostics = {
    unknownElementCount: 0,
    droppedAnimations: 0,
    warnings: [],
  };

  const presentationXml = await readXml(zip, "ppt/presentation.xml");
  const presentationRels = await readRels(zip, "ppt/_rels/presentation.xml.rels");

  const fit = computeFit(presentationXml);

  const slideIdList = asArray<{ "@_r:id": string }>(
    presentationXml?.["p:presentation"]?.["p:sldIdLst"]?.["p:sldId"]
  );
  const slidePaths = slideIdList
    .map((entry) => presentationRels.byId.get(entry["@_r:id"])?.target)
    .filter((p): p is string => Boolean(p))
    .map((p) => normalisePath(p, "ppt"));

  const title = await readTitle(zip);

  const slides: Slide[] = [];
  for (const slidePath of slidePaths) {
    const slide = await parseSlide(zip, slidePath, diagnostics, fit);
    if (slide) slides.push(slide);
  }

  if (!slides.length) {
    slides.push({ id: nanoid(8), background: "#FFFFFF", elements: [] });
    diagnostics.warnings.push("PPTX contained no slides; created an empty one.");
  }

  const deck: Deck = { title, slides };
  if (diagnostics.warnings.length) {
    console.info("[slidewise/pptx] parse diagnostics:", diagnostics);
  }
  return deck;
}

async function parseSlide(
  zip: JSZip,
  slidePath: string,
  diagnostics: ParseDiagnostics,
  fit: Fit
): Promise<Slide | null> {
  const xml = await readXml(zip, slidePath);
  if (!xml) return null;
  const slideRelsPath = relsPathFor(slidePath);
  const slideRels = await readRels(zip, slideRelsPath);

  // Walk the rels chain: slide → slideLayout → slideMaster → theme.
  const layoutTarget = firstByType(slideRels, "slideLayout");
  const layoutPath = layoutTarget
    ? normalisePath(layoutTarget, dirOf(slidePath))
    : null;
  const layoutXml = layoutPath ? await readXml(zip, layoutPath) : null;
  const layoutRels = layoutPath
    ? await readRels(zip, relsPathFor(layoutPath))
    : { byId: new Map() };

  const masterTarget = firstByType(layoutRels, "slideMaster");
  const masterPath =
    layoutPath && masterTarget
      ? normalisePath(masterTarget, dirOf(layoutPath))
      : null;
  const masterXml = masterPath ? await readXml(zip, masterPath) : null;
  const masterRels = masterPath
    ? await readRels(zip, relsPathFor(masterPath))
    : { byId: new Map() };

  const themeTarget = firstByType(masterRels, "theme");
  const themePath =
    masterPath && themeTarget
      ? normalisePath(themeTarget, dirOf(masterPath))
      : null;
  const themeXml = themePath ? await readXml(zip, themePath) : null;
  const theme = themeXml ? extractTheme(themeXml) : DEFAULT_THEME;

  const layoutPh = layoutXml ? extractPlaceholders(layoutXml) : new Map();
  const masterPh = masterXml ? extractPlaceholders(masterXml) : new Map();
  const masterTextDefaults: MasterTextDefaults = masterXml
    ? extractMasterTextDefaults(masterXml)
    : {};

  const ctx: ParseContext = {
    diagnostics,
    zip,
    slidePath,
    slideRels,
    fit,
    theme,
    layoutPh,
    masterPh,
    masterTextDefaults,
  };

  const sld = xml["p:sld"];
  const cSld = sld?.["p:cSld"];
  const slideBg = extractBackgroundColor(cSld?.["p:bg"], theme);
  const layoutBg = layoutXml
    ? extractBackgroundColor(
        layoutXml?.["p:sldLayout"]?.["p:cSld"]?.["p:bg"],
        theme
      )
    : undefined;
  const masterBg = masterXml
    ? extractBackgroundColor(
        masterXml?.["p:sldMaster"]?.["p:cSld"]?.["p:bg"],
        theme
      )
    : undefined;
  const background = slideBg ?? layoutBg ?? masterBg ?? "#FFFFFF";

  const spTree = cSld?.["p:spTree"];
  const elements: SlideElement[] = [];

  if (spTree) {
    const collected = await parseSpTree(spTree, ctx, identityTransform());
    let z = 1;
    for (const el of collected) {
      elements.push({ ...el, z: z++ });
    }
  }

  return {
    id: nanoid(8),
    background,
    elements,
  };
}

interface GroupTransform {
  /** Linear transform for child raw-px coordinates: x' = a*x + c, y' = b*y + d. */
  a: number;
  b: number;
  c: number;
  d: number;
}

function identityTransform(): GroupTransform {
  return { a: 1, b: 1, c: 0, d: 0 };
}

async function parseSpTree(
  spTree: any,
  ctx: ParseContext,
  outer: GroupTransform
): Promise<SlideElement[]> {
  const out: SlideElement[] = [];
  for (const sp of asArray(spTree["p:sp"])) {
    const el = await parseSpOrText(sp, ctx, outer);
    if (el) out.push(el);
  }
  for (const pic of asArray(spTree["p:pic"])) {
    const el = await parsePic(pic, ctx, outer);
    if (el) out.push(el);
  }
  for (const cxn of asArray(spTree["p:cxnSp"])) {
    const el = parseCxn(cxn, ctx, outer);
    if (el) out.push(el);
  }
  for (const gf of asArray(spTree["p:graphicFrame"])) {
    const el = parseGraphicFrame(gf, ctx, outer);
    if (el) out.push(el);
  }
  for (const grp of asArray(spTree["p:grpSp"])) {
    const inner = composeGroupTransform(grp, outer);
    const children = await parseSpTree(grp, ctx, inner);
    out.push(...children);
  }
  return out;
}

/**
 * Compose the group transform. PPTX groups carry both an outer xfrm
 * (off/ext, where the group sits on the slide) and chOff/chExt (the
 * coordinate system its children author in). Mapping a child raw-px point
 * (cx, cy) onto the slide is:
 *   x = (cx - chOffX) * (extX / chExtX) + offX
 *   y = (cy - chOffY) * (extY / chExtY) + offY
 * Then the outer group's own transform is applied on top.
 */
function composeGroupTransform(grp: any, outer: GroupTransform): GroupTransform {
  const xfrm = grp?.["p:grpSpPr"]?.["a:xfrm"];
  if (!xfrm) return outer;
  const off = xfrm["a:off"];
  const ext = xfrm["a:ext"];
  const chOff = xfrm["a:chOff"];
  const chExt = xfrm["a:chExt"];
  if (!off || !ext || !chOff || !chExt) return outer;
  const offX = emuToPx(Number(off["@_x"] ?? 0));
  const offY = emuToPx(Number(off["@_y"] ?? 0));
  const extX = emuToPx(Number(ext["@_cx"] ?? 0)) || 1;
  const extY = emuToPx(Number(ext["@_cy"] ?? 0)) || 1;
  const cOffX = emuToPx(Number(chOff["@_x"] ?? 0));
  const cOffY = emuToPx(Number(chOff["@_y"] ?? 0));
  const cExtX = emuToPx(Number(chExt["@_cx"] ?? 0)) || extX;
  const cExtY = emuToPx(Number(chExt["@_cy"] ?? 0)) || extY;
  const ax = extX / cExtX;
  const by = extY / cExtY;
  const cx0 = offX - cOffX * ax;
  const dy0 = offY - cOffY * by;
  // Compose with outer: outer maps (x,y) -> (a*x+c, b*y+d). After local: (ax*x+cx0, by*y+dy0).
  // Combined: outer(local(x,y)) = (a*(ax*x+cx0)+c, b*(by*y+dy0)+d)
  return {
    a: outer.a * ax,
    b: outer.b * by,
    c: outer.a * cx0 + outer.c,
    d: outer.b * dy0 + outer.d,
  };
}

// ---------------------------------------------------------------------------
// shape / text
// ---------------------------------------------------------------------------

async function parseSpOrText(
  sp: any,
  ctx: ParseContext,
  outer: GroupTransform
): Promise<SlideElement | null> {
  const ph = sp?.["p:nvSpPr"]?.["p:nvPr"]?.["p:ph"];
  const phKey = ph ? placeholderKey(ph) : null;
  const layoutPh = phKey ? lookupPlaceholder(ctx.layoutPh, ph!) : undefined;
  const masterPh = phKey ? lookupPlaceholder(ctx.masterPh, ph!) : undefined;

  const xfrm = sp?.["p:spPr"]?.["a:xfrm"];
  const geom = readGeometry(xfrm, ctx.fit, outer)
    ?? placeholderGeometry(layoutPh, ctx.fit, outer)
    ?? placeholderGeometry(masterPh, ctx.fit, outer);

  if (!geom) {
    return toUnknown(sp, "p:sp", ctx, outer);
  }

  const txBody = sp["p:txBody"];
  const prstGeom = sp?.["p:spPr"]?.["a:prstGeom"];
  const presetName = prstGeom?.["@_prst"];

  // Lines are sometimes authored as <p:sp prst="line">.
  if (presetName === "line" || presetName === "straightConnector1") {
    const flipV = xfrm?.["@_flipV"] === "1";
    return makeLineFromGeometry(
      geom,
      sp?.["p:spPr"]?.["a:ln"],
      ctx,
      flipV
    );
  }

  const phType = ph?.["@_type"];
  const isPlaceholderTextHost = !!ph && phType !== "pic";
  const hasText = !!txBody && hasAnyText(txBody);
  const isText =
    hasText ||
    (isPlaceholderTextHost && !presetName) ||
    (!!txBody && (!presetName || presetName === "rect"));

  if (isText) {
    return makeTextElement(sp, txBody, geom, ctx, ph, layoutPh, masterPh);
  }

  // Fill / stroke. Use placeholder-inherited spPr if slide spPr is empty.
  const spPr = sp?.["p:spPr"];
  const fillColor = extractShapeFill(spPr, ctx.theme) ?? "transparent";
  const lineProps = spPr?.["a:ln"];
  const lineHasNoFill = lineProps?.["a:noFill"] !== undefined;
  const stroke = lineHasNoFill
    ? undefined
    : resolveColor(lineProps?.["a:solidFill"], ctx.theme);
  const strokeWidthEmu =
    !lineHasNoFill && lineProps?.["@_w"]
      ? Number(lineProps["@_w"])
      : undefined;

  const kind = mapPrstToKind(presetName);
  if (!kind) {
    // Fall back to a rect with the shape's fill so it remains visible at the
    // correct position rather than dropping to an opaque "Imported content"
    // tile.
    const fallback: ShapeElement = {
      id: nanoid(8),
      type: "shape",
      ...geom,
      z: 0,
      shape: "rect",
      fill: fillColor === "transparent" ? "rgba(0,0,0,0)" : fillColor,
      stroke,
      strokeWidth: strokeWidthEmu
        ? Math.max(1, Math.round(emuToPx(strokeWidthEmu) * ctx.fit.scale))
        : undefined,
    };
    return fallback;
  }

  // PPTX `roundRect` carries the corner radius via <a:avLst><a:gd name="adj"
  // fmla="val N"/></a:avLst>; N is in 1/100000ths of the shorter side.
  let radius: number | undefined;
  if (presetName === "roundRect") {
    const adj = asArray(prstGeom?.["a:avLst"]?.["a:gd"]).find(
      (g: any) => g?.["@_name"] === "adj"
    );
    const fmla: string | undefined = adj?.["@_fmla"];
    const m = typeof fmla === "string" ? /val\s+(-?\d+)/.exec(fmla) : null;
    const frac = m ? Number(m[1]) / 100000 : 0.16667;
    radius = Math.round(Math.min(geom.w, geom.h) * frac);
  }

  const shape: ShapeElement = {
    id: nanoid(8),
    type: "shape",
    ...geom,
    z: 0,
    shape: kind,
    fill: fillColor,
    stroke,
    strokeWidth: strokeWidthEmu
      ? Math.max(1, Math.round(emuToPx(strokeWidthEmu) * ctx.fit.scale))
      : undefined,
    radius,
  };
  return shape;
}

function makeTextElement(
  _sp: any,
  txBody: any,
  geom: { x: number; y: number; w: number; h: number; rotation: number },
  ctx: ParseContext,
  ph: any,
  layoutPh: PlaceholderInfo | undefined,
  masterPh: PlaceholderInfo | undefined
): TextElement {
  // Try the slide's own txBody first; if it has no actual runs, fall back to
  // the layout/master placeholder's stub text so titles like "Click to edit
  // title" don't render but real layout-supplied titles do.
  const hasRealText = txBody && hasAnyText(txBody);
  const effectiveTxBody = hasRealText
    ? txBody
    : layoutPh?.paragraphs
      ? { "a:bodyPr": layoutPh.bodyPr, "a:p": layoutPh.paragraphs }
      : masterPh?.paragraphs
        ? { "a:bodyPr": masterPh.bodyPr, "a:p": masterPh.paragraphs }
        : txBody;

  // Master defaults for the placeholder type (title vs body vs other).
  const phType = ph?.["@_type"];
  const masterDef =
    phType === "title" || phType === "ctrTitle"
      ? ctx.masterTextDefaults.title
      : phType === "body" || phType === "subTitle"
        ? ctx.masterTextDefaults.body
        : ctx.masterTextDefaults.other;

  // Accumulate inheritance: slide < layout < master < masterDefaults.
  const fallbackRPr = mergeFirst(
    layoutPh?.rPr,
    masterPh?.rPr,
    masterDef?.["a:defRPr"]
  );
  const fallbackPPr = mergeFirst(
    layoutPh?.pPr,
    masterPh?.pPr,
    masterDef
  );
  const fallbackBodyPr = mergeFirst(layoutPh?.bodyPr, masterPh?.bodyPr);

  const text = extractRuns(effectiveTxBody, ctx.theme, fallbackRPr, fallbackPPr);
  const first = text.runs[0];
  const align = text.align ?? readAlign(fallbackPPr) ?? "left";
  const valign =
    readBodyVAlign(effectiveTxBody?.["a:bodyPr"]) ??
    readBodyVAlign(fallbackBodyPr) ??
    "top";

  const scale = ctx.fit.scale;
  const fontSize = first?.fontSize
    ? Math.max(6, Math.round(first.fontSize * scale))
    : Math.round(defaultFontSizePx(phType, ctx) * scale);
  const fontFamily =
    first?.fontFamily ??
    fallbackRPr?.["a:latin"]?.["@_typeface"] ??
    "Inter";
  const fontWeight = first?.bold ? 700 : 400;
  const color =
    first?.color ??
    resolveColor(fallbackRPr?.["a:solidFill"], ctx.theme) ??
    "#0E1330";

  const runs: TextRun[] = text.runs.map((r) => ({
    text: r.text,
    fontFamily: r.fontFamily,
    fontSize: r.fontSize ? Math.max(6, Math.round(r.fontSize * scale)) : undefined,
    fontWeight: r.bold ? 700 : r.bold === false ? 400 : undefined,
    italic: r.italic,
    underline: r.underline,
    strike: r.strike,
    color: r.color,
    letterSpacing: r.letterSpacing
      ? Math.round(r.letterSpacing * scale)
      : undefined,
  }));
  const hasMixedFormatting = runs.length > 1 && runs.some((r, i) => {
    if (i === 0) return false;
    const a = runs[0];
    return (
      a.color !== r.color ||
      a.fontFamily !== r.fontFamily ||
      a.fontSize !== r.fontSize ||
      a.fontWeight !== r.fontWeight ||
      a.italic !== r.italic ||
      a.underline !== r.underline ||
      a.strike !== r.strike
    );
  });

  const el: TextElement = {
    id: nanoid(8),
    type: "text",
    ...geom,
    z: 0,
    text: text.plain,
    fontFamily,
    fontSize,
    fontWeight,
    italic: !!first?.italic,
    underline: !!first?.underline,
    strike: !!first?.strike,
    color,
    align,
    vAlign: valign,
    lineHeight: text.lineHeightPct ?? 1.2,
    letterSpacing: first?.letterSpacing
      ? Math.round(first.letterSpacing * scale)
      : 0,
    ...(hasMixedFormatting ? { runs } : {}),
  };
  return el;
}

function defaultFontSizePx(phType: string | undefined, _ctx: ParseContext): number {
  // Slidewise pixels (will be scaled by fit.scale by caller).
  if (phType === "title" || phType === "ctrTitle") return pointsToPx(44);
  if (phType === "body" || phType === "subTitle") return pointsToPx(24);
  return pointsToPx(18);
}

async function parsePic(
  pic: any,
  ctx: ParseContext,
  outer: GroupTransform
): Promise<SlideElement | null> {
  const xfrm = pic?.["p:spPr"]?.["a:xfrm"];
  const geom = readGeometry(xfrm, ctx.fit, outer);
  if (!geom) return toUnknown(pic, "p:pic", ctx, outer);

  const blipRef = pic?.["p:blipFill"]?.["a:blip"]?.["@_r:embed"];
  if (!blipRef) return toUnknown(pic, "p:pic", ctx, outer);

  const mediaPath = ctx.slideRels.byId.get(blipRef)?.target;
  if (!mediaPath) return toUnknown(pic, "p:pic", ctx, outer);

  const fullPath = normalisePath(mediaPath, dirOf(ctx.slidePath));
  const file = ctx.zip.file(fullPath);
  if (!file) return toUnknown(pic, "p:pic", ctx, outer);

  const base64 = await file.async("base64");
  const ext = (fullPath.split(".").pop() || "png").toLowerCase();
  const mime = mimeForExt(ext);

  const blipFill = pic?.["p:blipFill"];
  const hasStretch = !!blipFill?.["a:stretch"];
  const fitMode: ImageElement["fit"] = hasStretch ? "fill" : "cover";

  const sr = blipFill?.["a:srcRect"];
  const crop = sr
    ? {
        l: Number(sr["@_l"] ?? 0) / 100000,
        r: Number(sr["@_r"] ?? 0) / 100000,
        t: Number(sr["@_t"] ?? 0) / 100000,
        b: Number(sr["@_b"] ?? 0) / 100000,
      }
    : undefined;
  const hasCrop =
    crop && (crop.l > 0 || crop.r > 0 || crop.t > 0 || crop.b > 0);

  const image: ImageElement = {
    id: nanoid(8),
    type: "image",
    ...geom,
    z: 0,
    src: `data:${mime};base64,${base64}`,
    fit: fitMode,
    ...(hasCrop ? { crop } : {}),
  };
  return image;
}

function parseCxn(
  cxn: any,
  ctx: ParseContext,
  outer: GroupTransform
): SlideElement | null {
  const xfrm = cxn?.["p:spPr"]?.["a:xfrm"];
  const geom = readGeometry(xfrm, ctx.fit, outer);
  if (!geom) return null;
  const flipV = xfrm?.["@_flipV"] === "1";
  return makeLineFromGeometry(geom, cxn?.["p:spPr"]?.["a:ln"], ctx, flipV);
}

function makeLineFromGeometry(
  geom: { x: number; y: number; w: number; h: number; rotation: number },
  lineProps: any,
  ctx: ParseContext,
  flipV: boolean
): LineElement {
  const stroke = resolveColor(lineProps?.["a:solidFill"], ctx.theme) ?? "#0E1330";
  const strokeWidth = lineProps?.["@_w"]
    ? Math.max(1, Math.round(emuToPx(Number(lineProps["@_w"])) * ctx.fit.scale))
    : 4;
  const dashed = !!lineProps?.["a:prstDash"];
  const arrow = !!lineProps?.["a:headEnd"] || !!lineProps?.["a:tailEnd"];
  const rawH = flipV ? -geom.h : geom.h;
  const w = geom.w === 0 ? 1 : geom.w;
  const h = Math.abs(rawH) === 0 ? 1 : rawH;
  const line: LineElement = {
    id: nanoid(8),
    type: "line",
    x: geom.x,
    y: geom.y,
    w,
    h,
    rotation: geom.rotation,
    z: 0,
    stroke,
    strokeWidth,
    dashed,
    arrow,
  };
  return line;
}

function parseGraphicFrame(
  gf: any,
  ctx: ParseContext,
  outer: GroupTransform
): SlideElement | null {
  const tbl = gf?.["a:graphic"]?.["a:graphicData"]?.["a:tbl"];
  if (tbl) {
    const parsed = parseTable(gf, tbl, ctx, outer);
    if (parsed) return parsed;
  }
  return toUnknown(gf, "p:graphicFrame", ctx, outer);
}

function parseTable(
  gf: any,
  tbl: any,
  ctx: ParseContext,
  outer: GroupTransform
): TableElement | null {
  const xfrm = gf?.["p:xfrm"] || gf?.["p:spPr"]?.["a:xfrm"];
  const geom = readGeometry(xfrm, ctx.fit, outer);
  if (!geom) return null;

  const trs = asArray(tbl["a:tr"]);
  if (!trs.length) return null;

  const rows: string[][] = [];
  let firstFontSizePx: number | undefined;
  let firstColor: string | undefined;
  let headerFill = "#0E1330";
  let bodyFill = "#FFFFFF";

  for (let ri = 0; ri < trs.length; ri++) {
    const tr = trs[ri];
    const tcs = asArray(tr["a:tc"]);
    const cells: string[] = [];
    for (const tc of tcs) {
      if (tc?.["@_hMerge"] === "1" || tc?.["@_vMerge"] === "1") {
        cells.push("");
        continue;
      }
      const txBody = tc["a:txBody"];
      const text = txBody
        ? extractRuns(txBody, ctx.theme)
        : { plain: "", runs: [] as RunInfo[] };
      cells.push(text.plain);

      const r0 = text.runs[0];
      if (firstFontSizePx === undefined && r0?.fontSize) {
        firstFontSizePx = Math.max(8, Math.round(r0.fontSize * ctx.fit.scale));
      }
      if (!firstColor && r0?.color) firstColor = r0.color;

      const cellFill = resolveColor(tc?.["a:tcPr"]?.["a:solidFill"], ctx.theme);
      if (cellFill) {
        if (ri === 0) headerFill = cellFill;
        else bodyFill = cellFill;
      }
    }
    rows.push(cells);
  }

  const table: TableElement = {
    id: nanoid(8),
    type: "table",
    ...geom,
    z: 0,
    rows,
    headerFill,
    rowFill: bodyFill,
    textColor: firstColor ?? "#0E1330",
    fontSize: firstFontSizePx ?? 18,
  };
  return table;
}

function toUnknown(
  node: any,
  tag: string,
  ctx: ParseContext,
  outer: GroupTransform
): UnknownElement {
  ctx.diagnostics.unknownElementCount++;
  const xfrm =
    node?.["p:spPr"]?.["a:xfrm"] ||
    node?.["p:grpSpPr"]?.["a:xfrm"] ||
    node?.["a:xfrm"];
  const geom = readGeometry(xfrm, ctx.fit, outer) ?? {
    x: 0,
    y: 0,
    w: 200,
    h: 100,
    rotation: 0,
  };
  return {
    id: nanoid(8),
    type: "unknown",
    ...geom,
    z: 0,
    ooxmlTag: tag,
    ooxmlXml: xmlBuilder.build({ [tag]: node }),
    label: friendlyLabelForTag(tag),
  };
}

function friendlyLabelForTag(tag: string): string {
  switch (tag) {
    case "p:graphicFrame":
      return "Chart / table / SmartArt";
    case "p:grpSp":
      return "Grouped shapes";
    case "p:sp":
      return "Imported shape";
    case "p:pic":
      return "Image";
    default:
      return "Imported content";
  }
}

// ---------------------------------------------------------------------------
// placeholders + masters
// ---------------------------------------------------------------------------

function placeholderKey(ph: any): string {
  const type = ph?.["@_type"] ?? "";
  const idx = ph?.["@_idx"] ?? "";
  return `${type}|${idx}`;
}

function lookupPlaceholder(
  map: Map<string, PlaceholderInfo>,
  ph: any
): PlaceholderInfo | undefined {
  const type = ph?.["@_type"] ?? "";
  const idx = ph?.["@_idx"] ?? "";
  // Try exact, then by idx alone, then by type alone.
  return (
    map.get(`${type}|${idx}`) ??
    map.get(`|${idx}`) ??
    map.get(`${type}|`) ??
    (type === "ctrTitle" ? map.get("title|") : undefined) ??
    (type === "subTitle" ? map.get("body|") : undefined)
  );
}

function placeholderGeometry(
  ph: PlaceholderInfo | undefined,
  fit: Fit,
  outer: GroupTransform
): { x: number; y: number; w: number; h: number; rotation: number } | null {
  if (!ph || ph.rawX === undefined) return null;
  return applyFit(
    {
      rawX: ph.rawX!,
      rawY: ph.rawY!,
      rawW: ph.rawW!,
      rawH: ph.rawH!,
      rotation: ph.rotation ?? 0,
    },
    fit,
    outer
  );
}

function extractPlaceholders(rootXml: any): Map<string, PlaceholderInfo> {
  const out = new Map<string, PlaceholderInfo>();
  const root =
    rootXml?.["p:sldLayout"] ?? rootXml?.["p:sldMaster"] ?? rootXml;
  const sps = asArray(root?.["p:cSld"]?.["p:spTree"]?.["p:sp"]);
  for (const sp of sps) {
    const ph = sp?.["p:nvSpPr"]?.["p:nvPr"]?.["p:ph"];
    if (!ph) continue;
    const xfrm = sp?.["p:spPr"]?.["a:xfrm"];
    const off = xfrm?.["a:off"];
    const ext = xfrm?.["a:ext"];
    const txBody = sp?.["p:txBody"];
    const paragraphs = asArray(txBody?.["a:p"]);
    const firstP = paragraphs[0];
    const firstR = asArray(firstP?.["a:r"])[0];
    const info: PlaceholderInfo = {
      rawX: off ? emuToPx(Number(off["@_x"] ?? 0)) : undefined,
      rawY: off ? emuToPx(Number(off["@_y"] ?? 0)) : undefined,
      rawW: ext ? emuToPx(Number(ext["@_cx"] ?? 0)) : undefined,
      rawH: ext ? emuToPx(Number(ext["@_cy"] ?? 0)) : undefined,
      rotation: xfrm?.["@_rot"] ? Number(xfrm["@_rot"]) / 60000 : 0,
      rPr: firstR?.["a:rPr"] ?? firstP?.["a:pPr"]?.["a:defRPr"],
      pPr: firstP?.["a:pPr"],
      bodyPr: txBody?.["a:bodyPr"],
      paragraphs: hasAnyText(txBody) ? paragraphs : undefined,
    };
    out.set(placeholderKey(ph), info);
  }
  return out;
}

function extractMasterTextDefaults(masterXml: any): MasterTextDefaults {
  const txStyles = masterXml?.["p:sldMaster"]?.["p:txStyles"];
  if (!txStyles) return {};
  return {
    title: txStyles?.["p:titleStyle"]?.["a:lvl1pPr"],
    body: txStyles?.["p:bodyStyle"]?.["a:lvl1pPr"],
    other: txStyles?.["p:otherStyle"]?.["a:lvl1pPr"],
  };
}

// ---------------------------------------------------------------------------
// theme
// ---------------------------------------------------------------------------

function extractTheme(themeXml: any): ThemeColors {
  const scheme =
    themeXml?.["a:theme"]?.["a:themeElements"]?.["a:clrScheme"] ?? {};
  const out: ThemeColors = { ...DEFAULT_THEME };
  for (const key of [
    "dk1",
    "lt1",
    "dk2",
    "lt2",
    "accent1",
    "accent2",
    "accent3",
    "accent4",
    "accent5",
    "accent6",
    "hlink",
    "folHlink",
  ] as const) {
    const node = scheme[`a:${key}`];
    const color = node ? readSchemeBaseColor(node) : undefined;
    if (color) out[key] = color;
  }
  return out;
}

function readSchemeBaseColor(node: any): string | undefined {
  const srgb = node?.["a:srgbClr"]?.["@_val"];
  if (srgb) return `#${String(srgb).toUpperCase()}`;
  const sys = node?.["a:sysClr"]?.["@_lastClr"];
  if (sys) return `#${String(sys).toUpperCase()}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// color resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a color node into a CSS hex string. Handles solid fill envelopes
 * (a:solidFill containing srgb/sys/scheme/prstClr) and bare color nodes
 * (e.g. a gradient stop). Applies modifiers: lumMod, lumOff, shade, tint,
 * alpha. Returns #RRGGBB or #RRGGBBAA.
 */
function resolveColor(node: any, theme: ThemeColors): string | undefined {
  if (!node) return undefined;
  // Allow caller to pass either a:solidFill or a bare color node.
  const inner = pickColorChild(node) ?? node;
  if (!inner) return undefined;
  let base = readBaseHex(inner, theme);
  if (!base) return undefined;
  let { r, g, b, a } = hexToRgba(base);
  let { h, s, l } = rgbToHsl(r, g, b);

  const modParent = pickColorChildEnvelope(node) ?? inner;
  const lumMod = numFromVal(modParent?.["a:lumMod"]);
  const lumOff = numFromVal(modParent?.["a:lumOff"]);
  const shade = numFromVal(modParent?.["a:shade"]);
  const tint = numFromVal(modParent?.["a:tint"]);
  const alphaN = numFromVal(modParent?.["a:alpha"]);

  if (lumMod !== undefined) l = clamp(l * lumMod);
  if (lumOff !== undefined) l = clamp(l + lumOff);
  // shade/tint: per OOXML, val=100000 is no-op. shade darkens via L; tint lightens via L.
  if (shade !== undefined) l = clamp(l * shade);
  if (tint !== undefined) l = clamp(l + (1 - l) * (1 - tint));

  ({ r, g, b } = hslToRgb(h, s, l));
  if (alphaN !== undefined) a = clamp(a * alphaN);

  const hex = rgbToHex(r, g, b);
  if (a >= 0.999) return hex;
  const aa = Math.round(a * 255).toString(16).padStart(2, "0").toUpperCase();
  return `${hex}${aa}`;
}

function pickColorChildEnvelope(node: any): any | undefined {
  // Prefers the inner color child when called with a wrapping <a:solidFill>.
  return (
    node?.["a:srgbClr"] ??
    node?.["a:sysClr"] ??
    node?.["a:schemeClr"] ??
    node?.["a:prstClr"] ??
    undefined
  );
}

function pickColorChild(node: any): any | undefined {
  // Returns whichever <a:*Clr> child is present, normalising the envelope.
  if (node?.["a:srgbClr"] || node?.["a:sysClr"] || node?.["a:schemeClr"] || node?.["a:prstClr"]) {
    return node;
  }
  return undefined;
}

function readBaseHex(node: any, theme: ThemeColors): string | undefined {
  const srgb = node?.["a:srgbClr"]?.["@_val"];
  if (srgb) return `#${String(srgb).toUpperCase()}`;
  const sys = node?.["a:sysClr"]?.["@_lastClr"];
  if (sys) return `#${String(sys).toUpperCase()}`;
  const scheme = node?.["a:schemeClr"]?.["@_val"];
  if (scheme) return resolveSchemeToken(scheme, theme);
  const prst = node?.["a:prstClr"]?.["@_val"];
  if (prst) return resolvePresetColor(prst);
  return undefined;
}

function resolveSchemeToken(token: string, theme: ThemeColors): string {
  switch (token) {
    case "bg1":
      return theme.lt1;
    case "bg2":
      return theme.lt2;
    case "tx1":
      return theme.dk1;
    case "tx2":
      return theme.dk2;
    case "phClr":
      // Placeholder color sentinel — best-effort fallback.
      return theme.dk1;
    default: {
      const v = (theme as unknown as Record<string, string>)[token];
      return v ?? "#000000";
    }
  }
}

function resolvePresetColor(name: string): string {
  // Very small subset of HTML4-like names; rarely used in modern PPTX.
  const map: Record<string, string> = {
    black: "#000000",
    white: "#FFFFFF",
    red: "#FF0000",
    green: "#008000",
    blue: "#0000FF",
    yellow: "#FFFF00",
    cyan: "#00FFFF",
    magenta: "#FF00FF",
    gray: "#808080",
  };
  return map[name.toLowerCase()] ?? "#000000";
}

function numFromVal(node: any): number | undefined {
  const v = node?.["@_val"];
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v) / 100000;
  return Number.isFinite(n) ? n : undefined;
}

function clamp(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(hue(h + 1 / 3) * 255),
    g: Math.round(hue(h) * 255),
    b: Math.round(hue(h - 1 / 3) * 255),
  };
}

/**
 * Extract a CSS background string from a shape's fill spec. Theme-aware.
 */
function extractShapeFill(spPr: any, theme: ThemeColors): string | undefined {
  if (!spPr) return undefined;
  if (spPr["a:noFill"] !== undefined) return "transparent";
  if (spPr["a:solidFill"]) {
    return resolveColor(spPr["a:solidFill"], theme);
  }
  const gf = spPr["a:gradFill"];
  if (gf) {
    const stops = asArray(gf["a:gsLst"]?.["a:gs"])
      .map((g: any) => {
        const pos = Number(g?.["@_pos"] ?? 0) / 1000;
        const color = resolveColor(g, theme) ?? "#000000";
        return { pos, color };
      })
      .sort((a, b) => a.pos - b.pos);
    if (!stops.length) return undefined;
    const allTransparent = stops.every(
      (s) => s.color.length === 9 && s.color.endsWith("00")
    );
    if (allTransparent) return "transparent";
    const angDeg = gf["a:lin"]?.["@_ang"]
      ? (Number(gf["a:lin"]["@_ang"]) / 60000 + 90) % 360
      : 90;
    const stopsCss = stops.map((s) => `${s.color} ${s.pos.toFixed(2)}%`).join(", ");
    return `linear-gradient(${angDeg}deg, ${stopsCss})`;
  }
  return undefined;
}

function extractBackgroundColor(bg: any, theme: ThemeColors): string | undefined {
  return (
    resolveColor(bg?.["p:bgPr"]?.["a:solidFill"], theme) ??
    (bg?.["p:bgPr"]?.["a:noFill"] !== undefined ? "transparent" : undefined)
  );
}

function readBodyVAlign(bodyPr: any): "top" | "middle" | "bottom" | undefined {
  const anchor = bodyPr?.["@_anchor"];
  if (anchor === "ctr") return "middle";
  if (anchor === "b") return "bottom";
  if (anchor === "t") return "top";
  return undefined;
}

function readAlign(pPr: any): "left" | "center" | "right" | undefined {
  const a = pPr?.["@_algn"];
  if (a === "ctr") return "center";
  if (a === "r") return "right";
  if (a === "l" || a === "just") return "left";
  return undefined;
}

interface RunInfo {
  text: string;
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  letterSpacing?: number;
}

function extractRuns(
  txBody: any,
  theme: ThemeColors,
  fallbackRPr?: any,
  fallbackPPr?: any
): {
  runs: RunInfo[];
  plain: string;
  align?: "left" | "center" | "right";
  lineHeightPct?: number;
} {
  const runs: RunInfo[] = [];
  let align: "left" | "center" | "right" | undefined;
  let lineHeightPct: number | undefined;
  const paragraphs = asArray(txBody?.["a:p"]);
  const pieces: string[] = [];

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const p = paragraphs[pi];
    const pPr = p?.["a:pPr"];
    if (!align) {
      align = readAlign(pPr) ?? readAlign(fallbackPPr);
    }
    if (lineHeightPct === undefined) {
      const lnPct =
        pPr?.["a:lnSpc"]?.["a:spcPct"]?.["@_val"] ??
        fallbackPPr?.["a:lnSpc"]?.["a:spcPct"]?.["@_val"];
      if (lnPct) lineHeightPct = Number(lnPct) / 100000;
    }
    const rs = asArray(p?.["a:r"]);
    const paragraphText: string[] = [];
    for (const r of rs) {
      const t = r?.["a:t"];
      const rPr = r?.["a:rPr"] ?? {};
      const text = typeof t === "string" ? t : t?.["#text"] ?? "";
      paragraphText.push(text);
      const spcRaw = rPr?.["@_spc"] ?? fallbackRPr?.["@_spc"];
      const letterSpacing =
        spcRaw !== undefined && spcRaw !== ""
          ? pointsToPx(Number(spcRaw) / 100)
          : undefined;
      const fontSize =
        rPr?.["@_sz"] ?? fallbackRPr?.["@_sz"]
          ? pointsToPx(Number(rPr?.["@_sz"] ?? fallbackRPr?.["@_sz"]) / 100)
          : undefined;
      const fontFamily =
        rPr?.["a:latin"]?.["@_typeface"] ??
        fallbackRPr?.["a:latin"]?.["@_typeface"];
      const color =
        resolveColor(rPr?.["a:solidFill"], theme) ??
        resolveColor(fallbackRPr?.["a:solidFill"], theme);
      const boldVal = rPr?.["@_b"] ?? fallbackRPr?.["@_b"];
      const italicVal = rPr?.["@_i"] ?? fallbackRPr?.["@_i"];
      const underlineVal = rPr?.["@_u"] ?? fallbackRPr?.["@_u"];
      const strikeVal = rPr?.["@_strike"] ?? fallbackRPr?.["@_strike"];
      runs.push({
        text,
        fontFamily,
        fontSize,
        bold: boldVal === "1" || boldVal === 1,
        italic: italicVal === "1" || italicVal === 1,
        underline: underlineVal && underlineVal !== "none",
        strike: strikeVal === "sngStrike",
        color,
        letterSpacing,
      });
    }
    pieces.push(paragraphText.join(""));
  }
  return {
    runs,
    plain: pieces.join("\n"),
    align,
    lineHeightPct,
  };
}

function hasAnyText(txBody: any): boolean {
  const ps = asArray(txBody?.["a:p"]);
  for (const p of ps) {
    const rs = asArray(p?.["a:r"]);
    for (const r of rs) {
      const t = r?.["a:t"];
      const text = typeof t === "string" ? t : t?.["#text"] ?? "";
      if (text && String(text).length > 0) return true;
    }
  }
  return false;
}

function mergeFirst<T>(...candidates: (T | undefined)[]): T | undefined {
  for (const c of candidates) {
    if (c !== undefined && c !== null) return c;
  }
  return undefined;
}

/**
 * Map an OOXML preset shape name to the closest Slidewise ShapeKind. Returns
 * null only for shapes we genuinely cannot represent at all (the caller then
 * falls back to a colored rect to preserve visibility).
 */
function mapPrstToKind(prst?: string): ShapeKind | null {
  if (!prst) return null;
  switch (prst) {
    // Direct mappings.
    case "rect":
    case "snip1Rect":
    case "snip2SameRect":
    case "snip2DiagRect":
    case "snipRoundRect":
    case "round1Rect":
    case "round2DiagRect":
    case "round2SameRect":
      return "rect";
    case "roundRect":
      return "rounded";
    case "ellipse":
    case "circle":
      return "circle";
    case "triangle":
    case "rtTriangle":
      return "triangle";
    case "diamond":
      return "diamond";
    case "star4":
    case "star5":
    case "star6":
    case "star7":
    case "star8":
    case "star10":
    case "star12":
    case "star16":
    case "star24":
    case "star32":
      return "star";
    // Loose mappings — preserve visibility with the closest available kind.
    case "parallelogram":
    case "trapezoid":
    case "hexagon":
    case "pentagon":
    case "octagon":
    case "heptagon":
    case "decagon":
    case "dodecagon":
    case "plus":
    case "cube":
    case "can":
    case "leftArrow":
    case "rightArrow":
    case "upArrow":
    case "downArrow":
    case "leftRightArrow":
    case "upDownArrow":
    case "bentArrow":
    case "uturnArrow":
    case "callout1":
    case "callout2":
    case "callout3":
    case "wedgeRectCallout":
    case "wedgeRoundRectCallout":
    case "flowChartProcess":
    case "flowChartDecision":
    case "flowChartTerminator":
    case "flowChartConnector":
      return "rect";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

function readGeometry(
  xfrm: any,
  fit: Fit,
  outer: GroupTransform
): {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
} | null {
  if (!xfrm) return null;
  const off = xfrm["a:off"];
  const ext = xfrm["a:ext"];
  if (!off || !ext) return null;
  const rawX = emuToPx(Number(off["@_x"] ?? 0));
  const rawY = emuToPx(Number(off["@_y"] ?? 0));
  const rawW = emuToPx(Number(ext["@_cx"] ?? 0));
  const rawH = emuToPx(Number(ext["@_cy"] ?? 0));
  const rot = xfrm["@_rot"] ? Number(xfrm["@_rot"]) / 60000 : 0;
  return applyFit(
    { rawX, rawY, rawW, rawH, rotation: rot },
    fit,
    outer
  );
}

function applyFit(
  raw: { rawX: number; rawY: number; rawW: number; rawH: number; rotation: number },
  fit: Fit,
  outer: GroupTransform
): { x: number; y: number; w: number; h: number; rotation: number } {
  // Apply the group's local linear transform to map child raw coords to the
  // raw slide coordinate system, then apply the slide-to-canvas fit.
  const slideRawX = outer.a * raw.rawX + outer.c;
  const slideRawY = outer.b * raw.rawY + outer.d;
  const slideRawW = raw.rawW * outer.a;
  const slideRawH = raw.rawH * outer.b;
  return {
    x: Math.round(slideRawX * fit.scale + fit.offsetX),
    y: Math.round(slideRawY * fit.scale + fit.offsetY),
    w: Math.max(1, Math.round(slideRawW * fit.scale)),
    h: Math.max(1, Math.round(slideRawH * fit.scale)),
    rotation: Math.round(raw.rotation),
  };
}

function computeFit(presentationXml: any): Fit {
  const sldSz = presentationXml?.["p:presentation"]?.["p:sldSz"];
  const cxEmu = Number(sldSz?.["@_cx"]) || 12192000;
  const cyEmu = Number(sldSz?.["@_cy"]) || 6858000;
  const sourceW = emuToPx(cxEmu);
  const sourceH = emuToPx(cyEmu);
  const scale = Math.min(SLIDE_W / sourceW, SLIDE_H / sourceH);
  const offsetX = Math.round((SLIDE_W - sourceW * scale) / 2);
  const offsetY = Math.round((SLIDE_H - sourceH * scale) / 2);
  return { scale, offsetX, offsetY };
}

// ---------------------------------------------------------------------------
// zip + xml helpers
// ---------------------------------------------------------------------------

async function readXml(zip: JSZip, path: string): Promise<any | null> {
  const file = zip.file(path);
  if (!file) return null;
  const text = await file.async("string");
  return xmlParser.parse(text);
}

async function readRels(zip: JSZip, path: string): Promise<Rels> {
  const byId = new Map<string, { target: string; type: string }>();
  const xml = await readXml(zip, path);
  if (!xml) return { byId };
  const rels = asArray(xml?.["Relationships"]?.["Relationship"]);
  for (const r of rels) {
    const id = r?.["@_Id"];
    const target = r?.["@_Target"];
    const type = r?.["@_Type"] ?? "";
    if (id && target) byId.set(id, { target, type });
  }
  return { byId };
}

function firstByType(rels: Rels, suffix: string): string | undefined {
  for (const { target, type } of rels.byId.values()) {
    if (type.endsWith(`/${suffix}`) || type.endsWith(suffix)) return target;
  }
  return undefined;
}

function relsPathFor(xmlPath: string): string {
  return xmlPath.replace(/([^/]+)\.xml$/, "_rels/$1.xml.rels");
}

async function readTitle(zip: JSZip): Promise<string> {
  const file = zip.file("docProps/core.xml");
  if (!file) return "Untitled";
  const text = await file.async("string");
  const m = text.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/);
  return (m?.[1] || "Untitled").trim() || "Untitled";
}

function asArray<T = any>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

function normalisePath(target: string, base: string): string {
  if (target.startsWith("/")) return target.slice(1);
  if (target.startsWith("../")) {
    const segments = base.split("/").filter(Boolean);
    let t = target;
    while (t.startsWith("../")) {
      segments.pop();
      t = t.slice(3);
    }
    return [...segments, t].filter(Boolean).join("/");
  }
  return base ? `${base}/${target}` : target;
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
