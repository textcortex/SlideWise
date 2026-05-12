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
  ShapePath,
  ImageElement,
  LineElement,
  TableElement,
  UnknownElement,
} from "@/lib/types";
import { SLIDE_W, SLIDE_H } from "@/lib/types";
import { CURRENT_DECK_VERSION } from "@/lib/schema/migrate";
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
  // bg1/bg2/tx1/tx2 are *token* names rather than colour scheme entries —
  // their resolved hexes come from the master's <p:clrMap>. Slidewise bakes
  // those into the theme so resolveSchemeToken stays a flat lookup.
  bg1: string;
  bg2: string;
  tx1: string;
  tx2: string;
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
  /** Per-level paragraph defaults from <a:lstStyle><a:lvlNpPr>. */
  lvlPPr?: (any | undefined)[];
  /** Fallback paragraphs (used when the slide placeholder has no text). */
  paragraphs?: any[];
  /** Raw spPr (used to resolve the placeholder's own fill / stroke). */
  spPr?: any;
}

interface MasterTextDefaults {
  title?: (any | undefined)[]; // titleStyle lvl1..lvl9 pPr
  body?: (any | undefined)[]; // bodyStyle lvl1..lvl9 pPr
  other?: (any | undefined)[];
}

interface ParseContext {
  diagnostics: ParseDiagnostics;
  zip: JSZip;
  slidePath: string;
  slideRels: Rels;
  fit: Fit;
  theme: ThemeColors;
  themeFills: ThemeFills;
  themeFonts: ThemeFonts;
  layoutPh: Map<string, PlaceholderInfo>;
  masterPh: Map<string, PlaceholderInfo>;
  masterTextDefaults: MasterTextDefaults;
}

/**
 * Ordered theme fill lists from a:fmtScheme. PPTX <p:bgRef idx="1001+"> looks
 * up the (idx - 1000)th entry of bgFillStyleLst (and analogously fillStyleLst
 * for 1+). Order across mixed tag types matters — fast-xml-parser flattens by
 * tag, so we reconstruct order from the raw XML.
 */
interface ThemeFill {
  kind: "solidFill" | "gradFill" | "blipFill" | "pattFill" | "noFill";
  node: any;
}

interface ThemeFills {
  bg: ThemeFill[];
  fg: ThemeFill[];
}

interface ThemeFonts {
  /** Major (heading) Latin typeface — referenced via `+mj-lt`. */
  majorLatin?: string;
  /** Minor (body) Latin typeface — referenced via `+mn-lt`. */
  minorLatin?: string;
}

/**
 * Maps generic colour tokens used by slides (`bg1`, `tx1`, `bg2`, `tx2`) onto
 * actual theme entries (`lt1`, `dk1`, …). Defined on the slide master via
 * `<p:clrMap>`; individual slides may override via `<p:clrMapOvr>`.
 */
interface ClrMap {
  bg1: keyof ThemeColors;
  bg2: keyof ThemeColors;
  tx1: keyof ThemeColors;
  tx2: keyof ThemeColors;
}

const DEFAULT_CLR_MAP: ClrMap = { bg1: "lt1", bg2: "lt2", tx1: "dk1", tx2: "dk2" };

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
  "a:br",
  "a:fld",
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
  // Default clrMap (bg1→lt1, tx1→dk1, …).
  bg1: "#FFFFFF",
  bg2: "#EEECE1",
  tx1: "#000000",
  tx2: "#1F497D",
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

  const deck: Deck = { version: CURRENT_DECK_VERSION, title, slides };
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
  const themeRaw = themePath ? await readXmlRaw(zip, themePath) : null;
  const baseTheme = themeXml ? extractTheme(themeXml) : DEFAULT_THEME;
  const themeFills =
    themeXml && themeRaw
      ? extractThemeFills(themeXml, themeRaw)
      : { bg: [], fg: [] };
  const themeFonts = themeXml ? extractThemeFonts(themeXml) : {};
  // <p:clrMap> lives on the master; <p:clrMapOvr><a:overrideClrMapping/> on
  // the slide can override individual mappings. Slides commonly only declare
  // <a:masterClrMapping/> which means "inherit the master's map verbatim".
  const masterClrMap = masterXml
    ? extractClrMap(masterXml?.["p:sldMaster"]?.["p:clrMap"])
    : DEFAULT_CLR_MAP;
  const clrMapOvr = xml["p:sld"]?.["p:clrMapOvr"]?.["a:overrideClrMapping"];
  const clrMap = clrMapOvr ? extractClrMap(clrMapOvr) : masterClrMap;
  // Bake the clrMap into the theme so bg1/bg2/tx1/tx2 stay flat lookups.
  const theme: ThemeColors = {
    ...baseTheme,
    bg1: baseTheme[clrMap.bg1],
    bg2: baseTheme[clrMap.bg2],
    tx1: baseTheme[clrMap.tx1],
    tx2: baseTheme[clrMap.tx2],
  };

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
    themeFills,
    themeFonts,
    layoutPh,
    masterPh,
    masterTextDefaults,
  };

  const sld = xml["p:sld"];
  const cSld = sld?.["p:cSld"];
  const slideBg = extractBackground(cSld?.["p:bg"], ctx);
  const layoutBg = layoutXml
    ? extractBackground(
        layoutXml?.["p:sldLayout"]?.["p:cSld"]?.["p:bg"],
        ctx
      )
    : undefined;
  const masterBg = masterXml
    ? extractBackground(
        masterXml?.["p:sldMaster"]?.["p:cSld"]?.["p:bg"],
        ctx
      )
    : undefined;
  const background = slideBg ?? layoutBg ?? masterBg ?? "#FFFFFF";

  const spTree = cSld?.["p:spTree"];

  // Layout & master visuals (non-placeholder shapes/pics, plus the fill of
  // placeholder-bearing shapes) form an underlay so brand bars, side gradients,
  // logo pics, and tinted placeholder boxes appear behind slide content.
  // Placeholders the slide already overrides (e.g. picture placeholder filled
  // by an in-slide <p:pic>) are skipped so their "Insert Picture" prompt
  // background doesn't leak through.
  const slidePhKeys = collectSlidePlaceholderKeys(spTree);
  const masterUnderlay = masterXml
    ? await parseUnderlay(
        masterXml["p:sldMaster"]?.["p:cSld"]?.["p:spTree"],
        ctx,
        masterPath!,
        masterRels,
        slidePhKeys
      )
    : [];
  const layoutUnderlay = layoutXml
    ? await parseUnderlay(
        layoutXml["p:sldLayout"]?.["p:cSld"]?.["p:spTree"],
        ctx,
        layoutPath!,
        layoutRels,
        slidePhKeys
      )
    : [];
  const elements: SlideElement[] = [];

  let z = 1;
  for (const el of masterUnderlay) elements.push({ ...el, z: z++ });
  for (const el of layoutUnderlay) elements.push({ ...el, z: z++ });
  if (spTree) {
    const collected = await parseSpTree(spTree, ctx, identityTransform());
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

/**
 * Walk a layout or master spTree and return elements to render behind the
 * slide: non-placeholder shapes/pics (the brand bars, gradient bands, corner
 * logos) and any explicit fill on placeholder-bearing shapes (the tinted
 * boxes some templates host on layout placeholders). Hidden shapes are
 * skipped. Placeholder text/positions remain handled by the existing
 * inheritance path so we don't duplicate them.
 */
async function parseUnderlay(
  spTree: any,
  ctx: ParseContext,
  ownerPath: string,
  ownerRels: Rels,
  slidePhKeys: Set<string>
): Promise<SlideElement[]> {
  if (!spTree) return [];
  const underlayCtx: ParseContext = {
    ...ctx,
    slidePath: ownerPath,
    slideRels: ownerRels,
  };
  return walkUnderlay(spTree, underlayCtx, identityTransform(), slidePhKeys);
}

async function walkUnderlay(
  spTree: any,
  ctx: ParseContext,
  outer: GroupTransform,
  slidePhKeys: Set<string>
): Promise<SlideElement[]> {
  const out: SlideElement[] = [];
  for (const sp of asArray(spTree["p:sp"])) {
    if (isHiddenNode(sp, "p:nvSpPr")) continue;
    const ph = sp?.["p:nvSpPr"]?.["p:nvPr"]?.["p:ph"];
    if (ph) {
      const isPicPrompt = ph["@_type"] === "pic";
      const isOverridden = slidePhKeys.has(placeholderKey(ph));
      // Picture placeholders are "Insert Picture" prompts; when the slide
      // supplies an actual image, the prompt panel must hide.
      if (isPicPrompt && isOverridden) continue;
      // When the slide hosts this placeholder, its fill rides on the
      // slide's text element (TextElement.background) so it stays at the
      // text's z-index — important when the slide also has a full-bleed
      // image that would otherwise cover an underlay-emitted backing.
      if (isOverridden) continue;
      // Unreferenced placeholders: emit a fill-only backing so coloured
      // boxes (numbered chips, decorative panels) appear.
      const filler = await placeholderFillUnderlay(sp, ctx, outer);
      if (filler) out.push(filler);
      continue;
    }
    const el = await parseSpOrText(sp, ctx, outer, { underlay: true });
    if (el) out.push(el);
  }
  for (const pic of asArray(spTree["p:pic"])) {
    if (isHiddenNode(pic, "p:nvPicPr")) continue;
    const ph = pic?.["p:nvPicPr"]?.["p:nvPr"]?.["p:ph"];
    if (ph && slidePhKeys.has(placeholderKey(ph))) continue;
    const el = await parsePic(pic, ctx, outer);
    if (el) out.push(el);
  }
  for (const cxn of asArray(spTree["p:cxnSp"])) {
    const el = parseCxn(cxn, ctx, outer);
    if (el) out.push(el);
  }
  for (const grp of asArray(spTree["p:grpSp"])) {
    const inner = composeGroupTransform(grp, outer);
    out.push(...(await walkUnderlay(grp, ctx, inner, slidePhKeys)));
  }
  return out;
}

function collectSlidePlaceholderKeys(spTree: any): Set<string> {
  const keys = new Set<string>();
  if (!spTree) return keys;
  const visit = (tree: any) => {
    if (!tree) return;
    for (const sp of asArray(tree["p:sp"])) {
      const ph = sp?.["p:nvSpPr"]?.["p:nvPr"]?.["p:ph"];
      if (ph) keys.add(placeholderKey(ph));
    }
    for (const pic of asArray(tree["p:pic"])) {
      const ph = pic?.["p:nvPicPr"]?.["p:nvPr"]?.["p:ph"];
      if (ph) keys.add(placeholderKey(ph));
    }
    for (const grp of asArray(tree["p:grpSp"])) visit(grp);
  };
  visit(spTree);
  return keys;
}

function isHiddenNode(node: any, nvKey: "p:nvSpPr" | "p:nvPicPr"): boolean {
  const cNvPr = node?.[nvKey]?.["p:cNvPr"];
  return cNvPr?.["@_hidden"] === "1" || cNvPr?.["@_hidden"] === 1;
}

/**
 * Resolve a shape's <p:style><a:fillRef idx="N">...<a:schemeClr/></a:fillRef>
 * against the theme's fillStyleLst. idx=0 = noFill; 1+ indexes the fillStyleLst
 * children; 1001+ indexes bgFillStyleLst (rarely used here). The colour child
 * inside fillRef plays the role of phClr in the theme fill template.
 */
function resolveStyleFillRef(sp: any, ctx: ParseContext): string | undefined {
  const fillRef = sp?.["p:style"]?.["a:fillRef"];
  if (!fillRef) return undefined;
  const idx = Number(fillRef["@_idx"]);
  if (!Number.isFinite(idx) || idx === 0) return undefined;
  const list = idx >= 1000 ? ctx.themeFills.bg : ctx.themeFills.fg;
  const entry = list[(idx >= 1000 ? idx - 1001 : idx - 1)];
  if (!entry) return undefined;
  const phColor = readBaseHex(fillRef, ctx.theme);
  if (entry.kind === "solidFill") {
    return resolveColor(substitutePhClr(entry.node, phColor), ctx.theme);
  }
  if (entry.kind === "gradFill") {
    return extractShapeFill(
      { "a:gradFill": substitutePhClr(entry.node, phColor) },
      ctx.theme
    );
  }
  if (entry.kind === "noFill") return "transparent";
  return undefined;
}

async function placeholderFillUnderlay(
  sp: any,
  ctx: ParseContext,
  outer: GroupTransform = identityTransform()
): Promise<ShapeElement | null> {
  const spPr = sp?.["p:spPr"];
  if (!spPr) return null;
  const fill = extractShapeFill(spPr, ctx.theme);
  if (!fill || fill === "transparent") return null;
  const geom = readGeometry(spPr["a:xfrm"], ctx.fit, outer);
  if (!geom) return null;
  return {
    id: nanoid(8),
    type: "shape",
    ...geom,
    z: 0,
    shape: "rect",
    fill,
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
  // Cursor per tag — we pop from each parsed array as we encounter its tag
  // in the document-order list, so the same elements get visited in the
  // order they appeared in the source XML (which determines z-index).
  const cursors: Record<string, number> = {
    "p:sp": 0,
    "p:pic": 0,
    "p:cxnSp": 0,
    "p:graphicFrame": 0,
    "p:grpSp": 0,
  };
  const order: string[] = (spTree as any)?._childOrder ?? [
    // Fall back to legacy tag-grouped order when raw isn't attached
    // (e.g. tests that build a parsed structure by hand).
    ...asArray(spTree["p:sp"]).map(() => "p:sp"),
    ...asArray(spTree["p:pic"]).map(() => "p:pic"),
    ...asArray(spTree["p:cxnSp"]).map(() => "p:cxnSp"),
    ...asArray(spTree["p:graphicFrame"]).map(() => "p:graphicFrame"),
    ...asArray(spTree["p:grpSp"]).map(() => "p:grpSp"),
  ];

  for (const tag of order) {
    if (!(tag in cursors)) continue;
    const arr = asArray((spTree as any)[tag]);
    const idx = cursors[tag]++;
    const node = arr[idx];
    if (!node) continue;
    if (tag === "p:sp") {
      const el = await parseSpOrText(node, ctx, outer);
      if (el) out.push(el);
    } else if (tag === "p:pic") {
      const el = await parsePic(node, ctx, outer);
      if (el) out.push(el);
    } else if (tag === "p:cxnSp") {
      const el = parseCxn(node, ctx, outer);
      if (el) out.push(el);
    } else if (tag === "p:graphicFrame") {
      const el = parseGraphicFrame(node, ctx, outer);
      if (el) out.push(el);
    } else if (tag === "p:grpSp") {
      const inner = composeGroupTransform(node, outer);
      const children = await parseSpTree(node, ctx, inner);
      out.push(...children);
    }
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
  outer: GroupTransform,
  opts: { underlay?: boolean } = {}
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
  const custGeom = sp?.["p:spPr"]?.["a:custGeom"];
  const customPath = custGeom ? parseCustGeomPath(custGeom) : undefined;

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
  // Underlay shapes come from layout/master decoration; the slide's own
  // placeholder will host the text, so don't promote an empty txBody to a
  // text element (that would drop the shape's fill).
  const isText = opts.underlay
    ? hasText
    : hasText ||
      (isPlaceholderTextHost && !presetName) ||
      (!!txBody && (!presetName || presetName === "rect"));

  if (isText) {
    return makeTextElement(sp, txBody, geom, ctx, ph, layoutPh, masterPh);
  }

  // Fill / stroke. Use placeholder-inherited spPr if slide spPr is empty.
  const spPr = sp?.["p:spPr"];
  const fillColor =
    extractShapeFill(spPr, ctx.theme)
    ?? resolveStyleFillRef(sp, ctx)
    ?? "transparent";
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
    // tile. When the source carried a <a:custGeom> path we attach it so the
    // renderer draws the actual silhouette (logos, brand marks) instead of
    // the rectangle stand-in.
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
      ...(customPath ? { path: customPath } : {}),
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

  // Master defaults for the placeholder type (title vs body vs other), as
  // an array of lvl1..lvl9 paragraph properties.
  const phType = ph?.["@_type"];
  const masterLevels: (any | undefined)[] =
    phType === "title" || phType === "ctrTitle"
      ? (ctx.masterTextDefaults.title ?? [])
      : phType === "body" || phType === "subTitle"
        ? (ctx.masterTextDefaults.body ?? [])
        : (ctx.masterTextDefaults.other ?? []);
  const masterLvl1 = masterLevels[0];

  // Accumulate inheritance: slide < layout < master < masterDefaults. Each
  // level can specify just a subset of fields (the layout might set the
  // typeface while only the master defines the colour), so merge field by
  // field with earlier candidates winning.
  const fallbackRPr = mergeRPrChain(
    layoutPh?.rPr,
    masterPh?.rPr,
    masterLvl1?.["a:defRPr"]
  );
  const fallbackPPr = mergeFirst(
    layoutPh?.pPr,
    masterPh?.pPr,
    masterLvl1
  );
  const fallbackBodyPr = mergeFirst(layoutPh?.bodyPr, masterPh?.bodyPr);

  // Resolve a per-level [layoutLvl, masterPhLvl, masterTxStyleLvl] chain so
  // bullet/alignment/lineSpacing each fall through independently when an
  // earlier layer is silent on that particular field.
  const listStyle: (any | undefined)[][] = [];
  for (let i = 0; i < 9; i++) {
    const chain = [
      layoutPh?.lvlPPr?.[i],
      masterPh?.lvlPPr?.[i],
      masterLevels[i],
    ].filter(Boolean);
    listStyle.push(chain);
  }

  // <a:bodyPr><a:normAutofit fontScale="..." lnSpcReduction="..."/> shrinks
  // text that overflowed when authored — apply so wraps don't push runs off
  // the slide.
  const autoFit = readNormAutofit(
    effectiveTxBody?.["a:bodyPr"] ?? fallbackBodyPr
  );

  const text = extractRuns(
    effectiveTxBody,
    ctx.theme,
    fallbackRPr,
    fallbackPPr,
    ctx.themeFonts,
    listStyle,
    autoFit
  );
  const first = text.runs[0];
  // Each layer of the inheritance chain may set @algn independently — a
  // layout placeholder can override geometry without touching alignment,
  // expecting the master's algn="r" (slide-number, page-footer right-edge
  // style) to still apply. mergeFirst would lock onto the layout's whole
  // pPr and hide the master's algn, so check each layer in turn.
  const align =
    text.align ??
    readAlign(layoutPh?.pPr) ??
    readAlign(masterPh?.pPr) ??
    readAlign(masterLvl1) ??
    "left";
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
    resolveFontFamily(
      fallbackRPr?.["a:latin"]?.["@_typeface"],
      ctx.themeFonts
    ) ??
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
  // Layout placeholders often supply a fill (e.g. a tinted body box) or a
  // <a:custGeom> path (a white brand-logo plate) that should sit
  // *immediately* behind the slide's hosted text — at the same z, not in
  // the underlay. Otherwise a full-bleed image on the slide will cover the
  // backing.
  const phSpPr = layoutPh?.spPr;
  const phFill = phSpPr ? extractShapeFill(phSpPr, ctx.theme) : undefined;
  const phPath = phSpPr?.["a:custGeom"]
    ? parseCustGeomPath(phSpPr["a:custGeom"])
    : undefined;
  if (phPath && phFill && phFill !== "transparent") {
    // custGeom defines the actual rendered silhouette; the fill applies to
    // it. Skip the flat background and render the glyph as a backing path.
    el.backingPath = {
      d: phPath.d,
      viewW: phPath.viewW,
      viewH: phPath.viewH,
      fill: phFill,
      fillRule: phPath.fillRule,
    };
  } else if (phFill && phFill !== "transparent") {
    el.background = phFill;
  }
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
  // Picture placeholders (<p:ph type="pic">) often omit xfrm — inherit
  // geometry from the layout/master placeholder of the same key.
  const ph = pic?.["p:nvPicPr"]?.["p:nvPr"]?.["p:ph"];
  const layoutPh = ph ? lookupPlaceholder(ctx.layoutPh, ph) : undefined;
  const masterPh = ph ? lookupPlaceholder(ctx.masterPh, ph) : undefined;
  const geom =
    readGeometry(xfrm, ctx.fit, outer)
    ?? placeholderGeometry(layoutPh, ctx.fit, outer)
    ?? placeholderGeometry(masterPh, ctx.fit, outer);
  if (!geom) return toUnknown(pic, "p:pic", ctx, outer);

  // Modern PPTX embeds SVGs via a dual-blip: <a:blip r:embed="rId_png">…
  //   <a:extLst><a:ext uri="…"><asvg:svgBlip r:embed="rId_svg"/></a:ext></a:extLst>
  // </a:blip>. The outer embed is the raster fallback; prefer the SVG when
  // present so vector logos stay sharp.
  const blip = pic?.["p:blipFill"]?.["a:blip"];
  const svgRef = findSvgBlipRef(blip);
  const rasterRef = blip?.["@_r:embed"];
  const blipRef = svgRef ?? rasterRef;
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

/**
 * Pull the SVG blip rId from a:blip/a:extLst/a:ext/asvg:svgBlip if present.
 * Returns undefined when the picture is raster-only.
 */
function findSvgBlipRef(blip: any): string | undefined {
  if (!blip) return undefined;
  const exts = asArray(blip?.["a:extLst"]?.["a:ext"]);
  for (const ext of exts) {
    const svg = ext?.["asvg:svgBlip"];
    const ref = svg?.["@_r:embed"];
    if (ref) return ref;
  }
  return undefined;
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
  const dashVal = lineProps?.["a:prstDash"]?.["@_val"];
  // <a:prstDash val="solid"/> is a valid explicit solid declaration. Only the
  // patterned values are actually dashed; everything else (including absent
  // and "solid") renders as a normal line.
  const dashed =
    typeof dashVal === "string" &&
    dashVal !== "solid" &&
    dashVal.length > 0;
  // <a:headEnd type="none"/> is valid PPTX for an explicit "no arrowhead".
  // Only mark as arrow when the type is one of the actual arrowhead presets.
  const headType = lineProps?.["a:headEnd"]?.["@_type"];
  const tailType = lineProps?.["a:tailEnd"]?.["@_type"];
  const isArrowType = (t: unknown) =>
    typeof t === "string" && t.length > 0 && t !== "none";
  const arrow = isArrowType(headType) || isArrowType(tailType);
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
        ? extractRuns(txBody, ctx.theme, undefined, undefined, ctx.themeFonts)
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
    findByType(map, type) ??
    (type === "ctrTitle" ? findByType(map, "title") : undefined) ??
    (type === "subTitle" ? findByType(map, "body") : undefined)
  );
}

function findByType(
  map: Map<string, PlaceholderInfo>,
  type: string
): PlaceholderInfo | undefined {
  if (!type) return undefined;
  const prefix = `${type}|`;
  for (const [key, value] of map) {
    if (key.startsWith(prefix)) return value;
  }
  return undefined;
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
    // Default run/paragraph properties live on the placeholder's
    // <a:lstStyle><a:lvl1pPr> (font, size, colour, etc). A stub <a:r><a:rPr/>
    // with just `lang` carries no real style — prefer the lstStyle defaults
    // over an empty inline rPr so the layout's typography reaches the slide.
    const lstStyle = txBody?.["a:lstStyle"];
    const lvl1 = lstStyle?.["a:lvl1pPr"];
    const lvlPPr = collectLevelPPrs(lstStyle);
    const stubRPr = firstR?.["a:rPr"];
    const info: PlaceholderInfo = {
      rawX: off ? emuToPx(Number(off["@_x"] ?? 0)) : undefined,
      rawY: off ? emuToPx(Number(off["@_y"] ?? 0)) : undefined,
      rawW: ext ? emuToPx(Number(ext["@_cx"] ?? 0)) : undefined,
      rawH: ext ? emuToPx(Number(ext["@_cy"] ?? 0)) : undefined,
      rotation: xfrm?.["@_rot"] ? Number(xfrm["@_rot"]) / 60000 : 0,
      rPr: pickMeaningful(
        stubRPr,
        lvl1?.["a:defRPr"],
        firstP?.["a:pPr"]?.["a:defRPr"]
      ),
      pPr: lvl1 ?? firstP?.["a:pPr"],
      bodyPr: txBody?.["a:bodyPr"],
      lvlPPr: lvlPPr.some(Boolean) ? lvlPPr : undefined,
      paragraphs: hasAnyText(txBody) ? paragraphs : undefined,
      spPr: sp?.["p:spPr"],
    };
    out.set(placeholderKey(ph), info);
  }
  return out;
}

/**
 * Return the first candidate that carries actual style fields (font, size,
 * colour, weight, italic, underline). An empty `<a:rPr lang="en-GB"/>` looks
 * truthy but contributes nothing, so it shouldn't shadow a meaningful
 * lstStyle/defRPr further down the chain.
 */
function pickMeaningful(...candidates: any[]): any {
  for (const c of candidates) {
    if (!c) continue;
    if (rPrHasStyle(c)) return c;
  }
  // Fall back to the first defined value, even if otherwise empty, so we
  // never regress callers that depend on truthiness.
  return candidates.find((c) => c !== undefined && c !== null);
}

function rPrHasStyle(rPr: any): boolean {
  if (!rPr || typeof rPr !== "object") return false;
  return (
    rPr["@_sz"] !== undefined ||
    rPr["@_b"] !== undefined ||
    rPr["@_i"] !== undefined ||
    rPr["@_u"] !== undefined ||
    rPr["@_spc"] !== undefined ||
    rPr["a:latin"] !== undefined ||
    rPr["a:solidFill"] !== undefined
  );
}

function extractMasterTextDefaults(masterXml: any): MasterTextDefaults {
  const txStyles = masterXml?.["p:sldMaster"]?.["p:txStyles"];
  if (!txStyles) return {};
  return {
    title: collectLevelPPrs(txStyles?.["p:titleStyle"]),
    body: collectLevelPPrs(txStyles?.["p:bodyStyle"]),
    other: collectLevelPPrs(txStyles?.["p:otherStyle"]),
  };
}

function collectLevelPPrs(style: any): (any | undefined)[] {
  if (!style) return [];
  const out: (any | undefined)[] = [];
  for (let lvl = 1; lvl <= 9; lvl++) {
    out.push(style[`a:lvl${lvl}pPr`]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// theme
// ---------------------------------------------------------------------------

function extractThemeFonts(themeXml: any): ThemeFonts {
  const fs = themeXml?.["a:theme"]?.["a:themeElements"]?.["a:fontScheme"];
  return {
    majorLatin: fs?.["a:majorFont"]?.["a:latin"]?.["@_typeface"] || undefined,
    minorLatin: fs?.["a:minorFont"]?.["a:latin"]?.["@_typeface"] || undefined,
  };
}

function extractClrMap(node: any): ClrMap {
  if (!node) return DEFAULT_CLR_MAP;
  const pick = (attr: string, fallback: ClrMap[keyof ClrMap]) => {
    const v = node[`@_${attr}`];
    return isThemeKey(v) ? (v as ClrMap[keyof ClrMap]) : fallback;
  };
  return {
    bg1: pick("bg1", DEFAULT_CLR_MAP.bg1),
    bg2: pick("bg2", DEFAULT_CLR_MAP.bg2),
    tx1: pick("tx1", DEFAULT_CLR_MAP.tx1),
    tx2: pick("tx2", DEFAULT_CLR_MAP.tx2),
  };
}

const THEME_KEYS = new Set([
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
]);

function isThemeKey(v: unknown): v is keyof ThemeColors {
  return typeof v === "string" && THEME_KEYS.has(v);
}

/**
 * Resolve OOXML major/minor font tokens (`+mj-lt`, `+mn-lt`, …) against the
 * theme's font scheme. Returns the original value when it isn't a token, and
 * `undefined` when the token can't be resolved.
 */
function resolveFontFamily(
  raw: string | undefined,
  fonts: ThemeFonts
): string | undefined {
  if (!raw) return undefined;
  if (raw === "+mj-lt" || raw === "+mj-ea" || raw === "+mj-cs") {
    return fonts.majorLatin;
  }
  if (raw === "+mn-lt" || raw === "+mn-ea" || raw === "+mn-cs") {
    return fonts.minorLatin;
  }
  return raw;
}

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
  if (token === "phClr") {
    // Placeholder colour sentinel — caller (substitutePhClr) should already
    // have replaced this; surface a sensible fallback if it didn't.
    return theme.dk1;
  }
  const v = (theme as unknown as Record<string, string>)[token];
  return v ?? "#000000";
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
    // Radial / path gradient: <a:path path="circle|rect|shape"> with
    // <a:fillToRect> giving the rectangle the gradient fills *toward*.
    // The CSS focus sits at the geometric opposite of that rectangle's
    // centre, so a fillToRect collapsed to the bottom-left corner
    // (l=0, t=100, r=100, b=0) places the radial centre at the top-right.
    const pathNode = gf["a:path"];
    if (pathNode) {
      const pathType = pathNode["@_path"];
      const ftr = pathNode["a:fillToRect"];
      const lIn = Number(ftr?.["@_l"] ?? 0) / 1000;
      const tIn = Number(ftr?.["@_t"] ?? 0) / 1000;
      const rIn = Number(ftr?.["@_r"] ?? 0) / 1000;
      const bIn = Number(ftr?.["@_b"] ?? 0) / 1000;
      // CT_RelativeRect insets: l from left, t from top, r from right, b
      // from bottom. The rect's centre is at ((l + 100−r) / 2,
      // (t + 100−b) / 2). The CSS focus is the geometric opposite within
      // the shape so the gradient peaks where PowerPoint draws it.
      const ftrCx = (lIn + (100 - rIn)) / 2;
      const ftrCy = (tIn + (100 - bIn)) / 2;
      // CSS focus is the geometric opposite of fillToRect's centre — the
      // gradient fills *toward* fillToRect.
      const focusX = clampPct(100 - ftrCx);
      const focusY = clampPct(100 - ftrCy);
      void pathType;
      // PowerPoint's `<a:path path="circle">` doesn't render as a strict
      // geometric circle — combined with the typical `tileRect` extension
      // and a corner focus, the visible result on real decks is much
      // closer to a linear ramp along the dominant axis from the focus
      // toward fillToRect. CSS linear-gradient matches that intent
      // cleanly (a CSS radial leaves an obvious "blob" at the corner that
      // PowerPoint doesn't draw).
      // Direction from the CSS focus toward fillToRect's centre.
      const dx = (100 - focusX) - focusX;
      const dy = (100 - focusY) - focusY;
      // PowerPoint's path-based gradient on a real slide reads as an
      // axis-aligned ramp, not a diagonal one — the ramp follows whichever
      // axis fillToRect collapses on. Snap to the dominant axis so the
      // gradient looks like the source instead of cutting across corners.
      // Ties (e.g. fillToRect at a single corner) favour the vertical
      // axis, matching how the eon chapter slides read.
      let cssAngle: number;
      if (Math.abs(dy) >= Math.abs(dx)) {
        cssAngle = dy >= 0 ? 180 : 0; // 180deg = top→bottom, 0deg = bottom→top
      } else {
        cssAngle = dx >= 0 ? 90 : 270; // 90deg = left→right, 270deg = right→left
      }
      // OOXML stops ramp outer→focus: pos=0 at the boundary (fillToRect),
      // pos=100000 at the focus. CSS linear goes start→end (0%→100%); we
      // place the focus colour at 0% (start) and the boundary at 100%.
      const flipped = stops
        .map((s) => ({ pos: 100 - s.pos, color: s.color }))
        .sort((a, b) => a.pos - b.pos);
      const stopsCss = flipped
        .map((s) => `${s.color} ${s.pos.toFixed(2)}%`)
        .join(", ");
      return `linear-gradient(${cssAngle.toFixed(2)}deg, ${stopsCss})`;
    }
    const angDeg = gf["a:lin"]?.["@_ang"]
      ? (Number(gf["a:lin"]["@_ang"]) / 60000 + 90) % 360
      : 90;
    const stopsCss = stops.map((s) => `${s.color} ${s.pos.toFixed(2)}%`).join(", ");
    return `linear-gradient(${angDeg}deg, ${stopsCss})`;
  }
  return undefined;
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

function extractBackground(bg: any, ctx: ParseContext): string | undefined {
  if (!bg) return undefined;
  const bgPr = bg["p:bgPr"];
  if (bgPr) {
    if (bgPr["a:noFill"] !== undefined) return "transparent";
    const solid = resolveColor(bgPr["a:solidFill"], ctx.theme);
    if (solid) return solid;
    const grad = extractShapeFill({ "a:gradFill": bgPr["a:gradFill"] }, ctx.theme);
    if (grad) return grad;
    // blipFill bg → render as the embedded image via CSS background. Falls
    // through to undefined for now; tracked for a follow-up.
  }
  const bgRef = bg["p:bgRef"];
  if (bgRef) return resolveBgRef(bgRef, ctx);
  return undefined;
}

/**
 * Resolve <p:bgRef idx="..."> against the theme fill lists. idx 1001..1003
 * indexes a:bgFillStyleLst; idx 1+ indexes a:fillStyleLst (rarely used for
 * backgrounds). The <p:bgRef> also carries a color child (e.g. schemeClr) that
 * fills in any <a:schemeClr val="phClr"> placeholders inside the theme fill.
 */
function resolveBgRef(bgRef: any, ctx: ParseContext): string | undefined {
  const rawIdx = bgRef?.["@_idx"];
  if (rawIdx === undefined) return undefined;
  const idx = Number(rawIdx);
  if (!Number.isFinite(idx)) return undefined;
  const list = idx >= 1000 ? ctx.themeFills.bg : ctx.themeFills.fg;
  const entry = list[(idx >= 1000 ? idx - 1001 : idx - 1)];
  if (!entry) return undefined;
  const phColor = readBaseHex(bgRef, ctx.theme);
  if (entry.kind === "solidFill") {
    const node = substitutePhClr(entry.node, phColor);
    return resolveColor(node, ctx.theme);
  }
  if (entry.kind === "gradFill") {
    const node = substitutePhClr(entry.node, phColor);
    return extractShapeFill({ "a:gradFill": node }, ctx.theme);
  }
  // blipFill / pattFill / noFill — not modelled as a slide background yet.
  if (entry.kind === "noFill") return "transparent";
  return undefined;
}

/**
 * Replace <a:schemeClr val="phClr"> placeholders inside a theme fill template
 * with the caller's actual color, so the modifier chain (lumMod, shade, etc.)
 * still applies. Returns a shallow-cloned tree.
 */
function substitutePhClr(node: any, phHex: string | undefined): any {
  if (!phHex) return node;
  const replacement = phHex.startsWith("#") ? phHex.slice(1) : phHex;
  const walk = (n: any): any => {
    if (n == null || typeof n !== "object") return n;
    if (Array.isArray(n)) return n.map(walk);
    const out: any = {};
    for (const k of Object.keys(n)) {
      if (k === "a:schemeClr" && n[k]?.["@_val"] === "phClr") {
        const mods: any = { ...n[k] };
        delete mods["@_val"];
        out["a:srgbClr"] = { ...mods, "@_val": replacement };
      } else {
        out[k] = walk(n[k]);
      }
    }
    return out;
  };
  return walk(node);
}

function extractThemeFills(themeXml: any, themeRaw: string): ThemeFills {
  const fmt = themeXml?.["a:theme"]?.["a:themeElements"]?.["a:fmtScheme"];
  if (!fmt) return { bg: [], fg: [] };
  const build = (blockTag: string, parsed: any): ThemeFill[] => {
    const kinds = extractDirectChildOrder(themeRaw, blockTag);
    if (!kinds.length || !parsed) return [];
    const buckets: Record<string, any[]> = {};
    for (const kind of new Set(kinds)) {
      buckets[kind] = asArray(parsed[`a:${kind}`]).slice();
    }
    const out: ThemeFill[] = [];
    for (const kind of kinds) {
      const node = buckets[kind]?.shift();
      if (node !== undefined) out.push({ kind: kind as ThemeFill["kind"], node });
    }
    return out;
  };
  return {
    bg: build("bgFillStyleLst", fmt["a:bgFillStyleLst"]),
    fg: build("fillStyleLst", fmt["a:fillStyleLst"]),
  };
}

/**
 * Returns the local tag names of direct children of the first <a:{blockTag}>
 * in document order. Used to recover the cross-tag-type order that
 * fast-xml-parser drops when it groups by element name.
 */
function extractDirectChildOrder(rawXml: string, blockTag: string): string[] {
  const openRe = new RegExp(`<a:${blockTag}\\b[^>]*>`);
  const close = `</a:${blockTag}>`;
  const m = openRe.exec(rawXml);
  if (!m) return [];
  const start = m.index + m[0].length;
  const end = rawXml.indexOf(close, start);
  if (end < 0) return [];
  const inner = rawXml.slice(start, end);
  const tags: string[] = [];
  let depth = 0;
  let i = 0;
  while (i < inner.length) {
    if (inner[i] !== "<") {
      i++;
      continue;
    }
    if (inner.startsWith("<!--", i)) {
      const j = inner.indexOf("-->", i);
      if (j < 0) break;
      i = j + 3;
      continue;
    }
    if (inner.startsWith("<?", i)) {
      const j = inner.indexOf("?>", i);
      if (j < 0) break;
      i = j + 2;
      continue;
    }
    const closeBracket = inner.indexOf(">", i);
    if (closeBracket < 0) break;
    const tag = inner.slice(i, closeBracket + 1);
    if (tag.startsWith("</")) {
      depth--;
      i = closeBracket + 1;
      continue;
    }
    const isSelfClose = tag.endsWith("/>");
    const nameMatch = /^<a:([\w]+)/.exec(tag);
    if (depth === 0 && nameMatch) tags.push(nameMatch[1]);
    if (!isSelfClose) depth++;
    i = closeBracket + 1;
  }
  return tags;
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
  fallbackPPr?: any,
  themeFonts: ThemeFonts = {},
  listStyle: (any | undefined)[][] = [],
  autoFit?: AutoFit
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
  const autoNumCounters = new Map<number, number>();
  let prevAutoKey: string | undefined;

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const p = paragraphs[pi];
    const pPr = p?.["a:pPr"];
    const lvl = clampLevel(Number(pPr?.["@_lvl"] ?? 0));
    const levelChain = listStyle[lvl] ?? [];
    const findLevel = (k: string): any =>
      [pPr, ...levelChain, fallbackPPr].find((s) => s?.[k] !== undefined);
    if (!align) {
      align =
        readAlign(pPr) ??
        readAlign(levelChain.find((s) => s?.["@_algn"])) ??
        readAlign(fallbackPPr);
    }
    if (lineHeightPct === undefined) {
      const src = findLevel("a:lnSpc");
      const lnPct = src?.["a:lnSpc"]?.["a:spcPct"]?.["@_val"];
      if (lnPct) {
        const base = Number(lnPct) / 100000;
        const reduction = autoFit?.lnSpcReduction ?? 0;
        lineHeightPct = base * (1 - reduction);
      }
    }

    // Resolve bullet across the inheritance chain (slide pPr > layout > master
    // placeholder > master txStyles). Each layer can specify just the bullet
    // without overriding everything else.
    const bullet = resolveBullet([pPr, ...levelChain]);
    const prefix = computeBulletPrefix(
      bullet,
      lvl,
      autoNumCounters,
      prevAutoKey
    );
    prevAutoKey = prefix.autoKey;

    const rs = asArray(p?.["a:r"]);
    const flds = asArray(p?.["a:fld"]);
    const paraStart = runs.length;
    const paragraphText: string[] = [];
    if (prefix.text) paragraphText.push(prefix.text);

    const onRun = (r: any) => {
      const built = buildRunInfo(r, theme, themeFonts, fallbackRPr);
      if (autoFit?.fontScale && built.run.fontSize) {
        built.run.fontSize *= autoFit.fontScale;
      }
      runs.push(built.run);
      paragraphText.push(built.text);
    };

    // <a:br/> hard line breaks AND <a:fld> field placeholders (e.g.
    // datetime1, slidenum) are siblings of <a:r>; when any are present
    // walk the paragraph children in document order so they land in the
    // right place. Otherwise stay on the fast path.
    if (p?.["a:br"] || p?.["a:fld"]) {
      const order = paragraphChildOrder(p);
      for (const entry of order) {
        if (entry.kind === "br") {
          if (runs.length) runs[runs.length - 1].text += "\n";
          paragraphText.push("\n");
          continue;
        }
        const source = entry.kind === "r" ? rs : flds;
        const r = source[entry.index];
        if (r) onRun(r);
      }
    } else {
      for (const r of rs) onRun(r);
    }

    // Prepend the bullet prefix to the first run of this paragraph so it
    // survives renderers that walk `runs` instead of the joined `plain` text.
    if (prefix.text && runs.length > paraStart) {
      runs[paraStart].text = prefix.text + runs[paraStart].text;
    }

    // Carry the inter-paragraph break onto the last run we just emitted —
    // renderers that walk `runs` (mixed-formatting path) would otherwise
    // concatenate paragraphs into one long line.
    if (pi < paragraphs.length - 1 && runs.length > 0) {
      runs[runs.length - 1].text += "\n";
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

interface AutoFit {
  fontScale?: number; // 0..1
  lnSpcReduction?: number; // 0..1
}

function readNormAutofit(bodyPr: any): AutoFit | undefined {
  const af = bodyPr?.["a:normAutofit"];
  if (!af) return undefined;
  const fontScale = af["@_fontScale"] ? Number(af["@_fontScale"]) / 100000 : undefined;
  const lnSpcReduction = af["@_lnSpcReduction"]
    ? Number(af["@_lnSpcReduction"]) / 100000
    : undefined;
  if (fontScale === undefined && lnSpcReduction === undefined) return undefined;
  return { fontScale, lnSpcReduction };
}

interface ResolvedBullet {
  kind: "none" | "char" | "auto";
  char?: string;
  autoType?: string;
  autoStartAt?: number;
}

function resolveBullet(sources: (any | undefined)[]): ResolvedBullet {
  // First source that defines any of buNone/buChar/buAutoNum wins.
  for (const src of sources) {
    if (!src) continue;
    if (src["a:buNone"] !== undefined) return { kind: "none" };
    if (src["a:buChar"]?.["@_char"])
      return { kind: "char", char: String(src["a:buChar"]["@_char"]) };
    if (src["a:buAutoNum"]) {
      return {
        kind: "auto",
        autoType: src["a:buAutoNum"]["@_type"] ?? "arabicPeriod",
        autoStartAt: src["a:buAutoNum"]["@_startAt"]
          ? Number(src["a:buAutoNum"]["@_startAt"])
          : 1,
      };
    }
  }
  return { kind: "none" };
}

function computeBulletPrefix(
  bullet: ResolvedBullet,
  level: number,
  counters: Map<number, number>,
  prevAutoKey: string | undefined
): { text: string; autoKey: string | undefined } {
  const indent = "  ".repeat(level);
  if (bullet.kind === "none") {
    // Drop the counter so a later run of <a:buAutoNum> restarts at 1 even at
    // the same level.
    counters.delete(level);
    return { text: "", autoKey: undefined };
  }
  if (bullet.kind === "char") {
    counters.delete(level);
    return {
      text: `${indent}${bullet.char ?? "•"}  `,
      autoKey: undefined,
    };
  }
  const key = `auto|${level}|${bullet.autoType ?? "arabicPeriod"}`;
  const continuing = key === prevAutoKey;
  const next = continuing
    ? (counters.get(level) ?? bullet.autoStartAt ?? 1) + 1
    : bullet.autoStartAt ?? 1;
  counters.set(level, next);
  return {
    text: `${indent}${formatAutoNum(next, bullet.autoType ?? "arabicPeriod")}  `,
    autoKey: key,
  };
}

function formatAutoNum(n: number, type: string): string {
  switch (type) {
    case "arabicPlain":
      return `${n}`;
    case "arabicParenR":
      return `${n})`;
    case "arabicParenBoth":
      return `(${n})`;
    case "arabicPeriod":
      return `${n}.`;
    case "alphaUcPeriod":
      return `${toAlpha(n).toUpperCase()}.`;
    case "alphaLcPeriod":
      return `${toAlpha(n)}.`;
    case "romanUcPeriod":
      return `${toRoman(n).toUpperCase()}.`;
    case "romanLcPeriod":
      return `${toRoman(n)}.`;
    default:
      return `${n}.`;
  }
}

function toAlpha(n: number): string {
  let s = "";
  let v = n;
  while (v > 0) {
    const r = (v - 1) % 26;
    s = String.fromCharCode(97 + r) + s;
    v = Math.floor((v - 1) / 26);
  }
  return s || "a";
}

function toRoman(n: number): string {
  if (n <= 0) return "";
  const pairs: [number, string][] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  let v = n;
  for (const [val, sym] of pairs) {
    while (v >= val) {
      out += sym;
      v -= val;
    }
  }
  return out;
}

function clampLevel(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n > 8) return 8;
  return Math.floor(n);
}

function buildRunInfo(
  r: any,
  theme: ThemeColors,
  themeFonts: ThemeFonts,
  fallbackRPr: any
): { run: RunInfo; text: string } {
  const t = r?.["a:t"];
  const rPr = r?.["a:rPr"] ?? {};
  const text = typeof t === "string" ? t : t?.["#text"] ?? "";
  const spcRaw = rPr?.["@_spc"] ?? fallbackRPr?.["@_spc"];
  const letterSpacing =
    spcRaw !== undefined && spcRaw !== ""
      ? pointsToPx(Number(spcRaw) / 100)
      : undefined;
  const fontSize =
    rPr?.["@_sz"] ?? fallbackRPr?.["@_sz"]
      ? pointsToPx(Number(rPr?.["@_sz"] ?? fallbackRPr?.["@_sz"]) / 100)
      : undefined;
  const rawFontFamily =
    rPr?.["a:latin"]?.["@_typeface"] ??
    fallbackRPr?.["a:latin"]?.["@_typeface"];
  const fontFamily = resolveFontFamily(rawFontFamily, themeFonts);
  const color =
    resolveColor(rPr?.["a:solidFill"], theme) ??
    resolveColor(fallbackRPr?.["a:solidFill"], theme);
  const boldVal = rPr?.["@_b"] ?? fallbackRPr?.["@_b"];
  const italicVal = rPr?.["@_i"] ?? fallbackRPr?.["@_i"];
  const underlineVal = rPr?.["@_u"] ?? fallbackRPr?.["@_u"];
  const strikeVal = rPr?.["@_strike"] ?? fallbackRPr?.["@_strike"];
  return {
    text,
    run: {
      text,
      fontFamily,
      fontSize,
      bold: boldVal === "1" || boldVal === 1,
      italic: italicVal === "1" || italicVal === 1,
      underline: !!(underlineVal && underlineVal !== "none"),
      strike: strikeVal === "sngStrike",
      color,
      letterSpacing,
    },
  };
}

/**
 * Returns the ordered list of <a:r>/<a:br> direct children of a paragraph
 * with each entry's running index into the corresponding array on the parsed
 * paragraph. The order is recovered from the paragraph's raw XML (attached
 * during readXml) because fast-xml-parser groups children by tag name.
 */
function paragraphChildOrder(
  p: any
): { kind: "r" | "br" | "fld"; index: number }[] {
  const raw = (p as any)?._rawSrc as string | undefined;
  if (raw) return paragraphChildOrderFromRaw(raw);
  // No raw available (paragraph has no <a:br/> and pre-PR-2 readXml didn't
  // attach it). Fall back to the order implied by the parsed arrays: all
  // runs, then all fields. Document order across these tag types is lost
  // by fast-xml-parser, but the typical PPTX paragraph has either runs or
  // a field, not both, so this matches reality in practice.
  const out: { kind: "r" | "br" | "fld"; index: number }[] = [];
  asArray(p?.["a:r"]).forEach((_, i) => out.push({ kind: "r", index: i }));
  asArray(p?.["a:fld"]).forEach((_, i) => out.push({ kind: "fld", index: i }));
  return out;
}

/**
 * Convert a PPTX `<a:custGeom>` (custom geometry — used for logos, brand
 * marks, hand-drawn shapes) into an SVG path. Reads command order from the
 * raw XML attached during readXml, since fast-xml-parser groups children by
 * tag name and drops cross-tag document order. Supports moveTo, lnTo,
 * cubicBezTo, quadBezTo, and close; arcTo and formula-based guide
 * references aren't translated yet (they degrade to a flat-fill rect).
 */
function parseCustGeomPath(custGeom: any): ShapePath | undefined {
  const raw = (custGeom as any)?._rawSrc as string | undefined;
  if (!raw) return undefined;
  // Each <a:path w="…" h="…"> defines its own coordinate system; the SVG
  // viewBox uses the FIRST path's dimensions and subsequent paths inherit
  // it. In practice almost every custGeom in real decks uses one viewbox
  // across all sub-paths.
  const paths = findAllElementRawBlocks(raw, "path");
  if (!paths.length) return undefined;
  let viewW = 0;
  let viewH = 0;
  let d = "";
  for (const block of paths) {
    const headerEnd = block.indexOf(">");
    if (headerEnd < 0) continue;
    const header = block.slice(0, headerEnd + 1);
    const w = Number(/\bw="(\d+)"/.exec(header)?.[1] ?? 0);
    const h = Number(/\bh="(\d+)"/.exec(header)?.[1] ?? 0);
    if (w > viewW) viewW = w;
    if (h > viewH) viewH = h;
    d += (d ? " " : "") + custGeomBodyToSvgD(block);
  }
  if (!d || viewW <= 0 || viewH <= 0) return undefined;
  // OOXML composite paths (multiple subpaths with internal holes — letters
  // like the "e" and "o" in the eon wordmark) render with even-odd winding
  // by default; the nonzero default of SVG would fill the holes.
  return { d, viewW, viewH, fillRule: "evenodd" };
}

function custGeomBodyToSvgD(pathBlock: string): string {
  const headerEnd = pathBlock.indexOf(">");
  const closeIdx = pathBlock.lastIndexOf("</a:path>");
  const inner =
    closeIdx > headerEnd
      ? pathBlock.slice(headerEnd + 1, closeIdx)
      : pathBlock.slice(headerEnd + 1);
  let out = "";
  let i = 0;
  let depth = 0;
  while (i < inner.length) {
    if (inner[i] !== "<") {
      i++;
      continue;
    }
    if (inner.startsWith("</", i)) {
      depth--;
      const end = inner.indexOf(">", i);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (inner.startsWith("<!--", i)) {
      const end = inner.indexOf("-->", i);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    const close = inner.indexOf(">", i);
    if (close < 0) break;
    const tag = inner.slice(i, close + 1);
    const nameMatch = /^<a:([\w]+)/.exec(tag);
    const isSelfClose = tag.endsWith("/>");
    if (depth === 0 && nameMatch) {
      const name = nameMatch[1];
      if (name === "close") {
        out += " Z";
      } else if (
        name === "moveTo" ||
        name === "lnTo" ||
        name === "cubicBezTo" ||
        name === "quadBezTo"
      ) {
        // Each command's <a:pt x="..." y="..."/> children are siblings — pull
        // them out of the inner block in document order. SVG path commands
        // take all of their control points after a single letter:
        // cubicBezTo → "C x1 y1 x2 y2 x3 y3", quadBezTo → "Q x1 y1 x2 y2",
        // moveTo/lnTo → "M x y" / "L x y".
        const cmdClose = inner.indexOf(`</a:${name}>`, close + 1);
        if (cmdClose < 0) break;
        const body = inner.slice(close + 1, cmdClose);
        const coords: string[] = [];
        const ptRe = /<a:pt\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>/g;
        let m: RegExpExecArray | null;
        while ((m = ptRe.exec(body))) {
          coords.push(m[1], m[2]);
        }
        if (coords.length) {
          const letter =
            name === "moveTo"
              ? "M"
              : name === "lnTo"
                ? "L"
                : name === "cubicBezTo"
                  ? "C"
                  : "Q";
          out += ` ${letter} ${coords.join(" ")}`;
        }
        i = cmdClose + `</a:${name}>`.length;
        continue;
      }
      // arcTo and any unknown command: skip without emitting anything yet.
    }
    if (!isSelfClose) depth++;
    i = close + 1;
  }
  return out.trim();
}

function paragraphChildOrderFromRaw(
  raw: string
): { kind: "r" | "br" | "fld"; index: number }[] {
  const tagEnd = raw.indexOf(">");
  const closeIdx = raw.lastIndexOf("</a:p>");
  if (tagEnd < 0 || closeIdx < 0) return [];
  const inner = raw.slice(tagEnd + 1, closeIdx);
  const out: { kind: "r" | "br" | "fld"; index: number }[] = [];
  let depth = 0;
  let rIdx = 0;
  let brIdx = 0;
  let fldIdx = 0;
  let i = 0;
  while (i < inner.length) {
    if (inner[i] !== "<") {
      i++;
      continue;
    }
    if (inner.startsWith("</", i)) {
      depth--;
      const end = inner.indexOf(">", i);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (inner.startsWith("<!--", i)) {
      const end = inner.indexOf("-->", i);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    if (inner.startsWith("<?", i)) {
      const end = inner.indexOf("?>", i);
      if (end < 0) break;
      i = end + 2;
      continue;
    }
    const close = inner.indexOf(">", i);
    if (close < 0) break;
    const tag = inner.slice(i, close + 1);
    const isSelfClose = tag.endsWith("/>");
    const nameMatch = /^<(a:[\w]+)/.exec(tag);
    if (depth === 0 && nameMatch) {
      const name = nameMatch[1];
      if (name === "a:r") out.push({ kind: "r", index: rIdx++ });
      else if (name === "a:br") out.push({ kind: "br", index: brIdx++ });
      else if (name === "a:fld") out.push({ kind: "fld", index: fldIdx++ });
    }
    if (!isSelfClose) depth++;
    i = close + 1;
  }
  return out;
}

function hasAnyText(txBody: any): boolean {
  const ps = asArray(txBody?.["a:p"]);
  for (const p of ps) {
    for (const r of [...asArray(p?.["a:r"]), ...asArray(p?.["a:fld"])]) {
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
 * Per-field rPr merge: earlier candidates win for each individual attribute
 * (font typeface, size, colour, weight, italic, …). Used to flatten the
 * layout→master→txStyles inheritance chain into a single fallback rPr for
 * the run extractor.
 */
function mergeRPrChain(...candidates: (any | undefined)[]): any | undefined {
  const out: any = {};
  let touched = false;
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    for (const k of Object.keys(c)) {
      if (out[k] === undefined) {
        out[k] = c[k];
        touched = true;
      }
    }
  }
  return touched ? out : undefined;
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
  const parsed = xmlParser.parse(text);
  // fast-xml-parser groups children by tag name and drops cross-tag
  // document order. Attach raw fragments for paragraphs (run/br/fld
  // interleaving), custGeom path commands, and spTree/grpSp children
  // (which carry z-index via source order).
  annotateRawOrder(parsed, text);
  return parsed;
}

function annotateRawOrder(parsed: any, rawText: string): void {
  annotateParagraphRawSrc(parsed, rawText);
  annotateSpTreeChildOrder(parsed, rawText);
}

/**
 * Attach `_childOrder: string[]` to every parsed `<p:spTree>` and
 * `<p:grpSp>` so callers can iterate children (sp, pic, cxnSp,
 * graphicFrame, grpSp) in document order. PPTX z-index follows source
 * order — a slide that lists `<p:pic>` before `<p:sp>` means the picture
 * sits behind the text — but fast-xml-parser groups children by tag name
 * and drops cross-tag ordering.
 */
function annotateSpTreeChildOrder(parsed: any, rawText: string): void {
  if (!rawText.includes("<p:spTree") && !rawText.includes("<p:grpSp")) return;
  for (const tag of ["p:spTree", "p:grpSp"] as const) {
    if (!rawText.includes(`<${tag}`)) continue;
    const blocks = findAllRawBlocks(rawText, tag);
    if (!blocks.length) continue;
    const nodes: any[] = [];
    collectNamedDfs(parsed, tag, nodes);
    const n = Math.min(blocks.length, nodes.length);
    for (let i = 0; i < n; i++) {
      const order = extractTopLevelChildNames(blocks[i]);
      Object.defineProperty(nodes[i], "_childOrder", {
        value: order,
        enumerable: false,
        configurable: true,
      });
    }
  }
}

function extractTopLevelChildNames(blockXml: string): string[] {
  const tagEnd = blockXml.indexOf(">");
  const close = blockXml.lastIndexOf("<");
  if (tagEnd < 0 || close <= tagEnd) return [];
  const inner = blockXml.slice(tagEnd + 1, close);
  const out: string[] = [];
  let depth = 0;
  let i = 0;
  while (i < inner.length) {
    if (inner[i] !== "<") {
      i++;
      continue;
    }
    if (inner.startsWith("</", i)) {
      depth--;
      const end = inner.indexOf(">", i);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (inner.startsWith("<!--", i)) {
      const end = inner.indexOf("-->", i);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    const end = inner.indexOf(">", i);
    if (end < 0) break;
    const tag = inner.slice(i, end + 1);
    const selfClose = tag.endsWith("/>");
    const nameMatch = /^<([\w:]+)/.exec(tag);
    if (depth === 0 && nameMatch) out.push(nameMatch[1]);
    if (!selfClose) depth++;
    i = end + 1;
  }
  return out;
}

function findAllRawBlocks(raw: string, fullName: string): string[] {
  const blocks: string[] = [];
  // Depth-aware scan so self-nesting tags (e.g. `<p:grpSp>` inside another
  // `<p:grpSp>`) match their correct closing tag instead of the first inner
  // one we encounter.
  const openRe = new RegExp(`<${fullName}\\b[^>]*?(/?)>`, "g");
  const closeTag = `</${fullName}>`;
  let i = 0;
  while (i < raw.length) {
    openRe.lastIndex = i;
    const m = openRe.exec(raw);
    if (!m) break;
    const start = m.index;
    const tagEnd = openRe.lastIndex;
    if (m[1] === "/") {
      blocks.push(raw.slice(start, tagEnd));
      i = tagEnd;
      continue;
    }
    let depth = 1;
    let scan = tagEnd;
    const innerOpenRe = new RegExp(`<${fullName}\\b[^>]*?(/?)>`, "g");
    while (depth > 0 && scan < raw.length) {
      innerOpenRe.lastIndex = scan;
      const nextOpen = innerOpenRe.exec(raw);
      const nextClose = raw.indexOf(closeTag, scan);
      if (nextClose < 0) {
        depth = -1;
        break;
      }
      if (nextOpen && nextOpen.index < nextClose) {
        // Self-closing opens don't change depth.
        if (nextOpen[1] !== "/") depth++;
        scan = innerOpenRe.lastIndex;
      } else {
        depth--;
        scan = nextClose + closeTag.length;
      }
    }
    if (depth !== 0) break;
    blocks.push(raw.slice(start, scan));
    i = scan;
  }
  return blocks;
}

function annotateParagraphRawSrc(parsed: any, rawText: string): void {
  // Cross-tag document order matters when a paragraph mixes <a:r>, <a:br>,
  // and <a:fld>. fast-xml-parser groups by tag name, so we keep the raw
  // XML for any paragraph that contains a break or a field.
  if (rawText.includes("<a:br") || rawText.includes("<a:fld")) {
    const blocks = findAllParagraphRawBlocks(rawText);
    if (blocks.length) {
      const parsedPs: any[] = [];
      collectParagraphsDfs(parsed, parsedPs);
      const n = Math.min(blocks.length, parsedPs.length);
      for (let i = 0; i < n; i++) {
        const block = blocks[i];
        if (block.includes("<a:br") || block.includes("<a:fld")) {
          Object.defineProperty(parsedPs[i], "_rawSrc", {
            value: block,
            enumerable: false,
            configurable: true,
          });
        }
      }
    }
  }
  // <a:custGeom> path commands (moveTo, lnTo, cubicBezTo, …) are siblings,
  // and their cross-tag order defines the silhouette of brand logos and
  // hand-drawn shapes. Same fast-xml-parser issue, same fix: attach raw.
  if (rawText.includes("<a:custGeom")) {
    const blocks = findAllElementRawBlocks(rawText, "custGeom");
    if (blocks.length) {
      const parsedCustGeoms: any[] = [];
      collectNamedDfs(parsed, "a:custGeom", parsedCustGeoms);
      const n = Math.min(blocks.length, parsedCustGeoms.length);
      for (let i = 0; i < n; i++) {
        Object.defineProperty(parsedCustGeoms[i], "_rawSrc", {
          value: blocks[i],
          enumerable: false,
          configurable: true,
        });
      }
    }
  }
}

function collectNamedDfs(node: any, key: string, acc: any[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectNamedDfs(n, key, acc);
    return;
  }
  for (const k of Object.keys(node)) {
    if (k.startsWith("@_") || k === "#text") continue;
    if (k === key) {
      for (const v of asArray(node[k])) acc.push(v);
    } else {
      collectNamedDfs(node[k], key, acc);
    }
  }
}

function findAllElementRawBlocks(raw: string, localName: string): string[] {
  const blocks: string[] = [];
  const openSelfClose = new RegExp(`<a:${localName}\\b[^>]*/>`);
  const openTag = new RegExp(`<a:${localName}\\b[^>]*>`);
  const close = `</a:${localName}>`;
  let cursor = 0;
  while (cursor < raw.length) {
    const slice = raw.slice(cursor);
    const sc = openSelfClose.exec(slice);
    const ot = openTag.exec(slice);
    // Pick whichever comes first (and only if it isn't a self-close that was
    // also matched by openTag).
    let start = -1;
    let selfClose = false;
    if (sc && (!ot || sc.index <= ot.index)) {
      start = cursor + sc.index;
      selfClose = true;
    } else if (ot) {
      start = cursor + ot.index;
      selfClose = ot[0].endsWith("/>");
    }
    if (start < 0) break;
    if (selfClose) {
      const end = raw.indexOf(">", start);
      blocks.push(raw.slice(start, end + 1));
      cursor = end + 1;
      continue;
    }
    const tagEnd = raw.indexOf(">", start);
    const closeIdx = raw.indexOf(close, tagEnd + 1);
    if (closeIdx < 0) break;
    blocks.push(raw.slice(start, closeIdx + close.length));
    cursor = closeIdx + close.length;
  }
  return blocks;
}

function findAllParagraphRawBlocks(raw: string): string[] {
  const blocks: string[] = [];
  let i = 0;
  while (i < raw.length) {
    const a = raw.indexOf("<a:p>", i);
    const b = raw.indexOf("<a:p ", i);
    let start: number;
    if (a < 0 && b < 0) break;
    if (a < 0) start = b;
    else if (b < 0) start = a;
    else start = Math.min(a, b);
    const tagEnd = raw.indexOf(">", start);
    if (tagEnd < 0) break;
    if (raw[tagEnd - 1] === "/") {
      blocks.push(raw.slice(start, tagEnd + 1));
      i = tagEnd + 1;
      continue;
    }
    // <a:p> never nests inside another <a:p>, so the first </a:p> is ours.
    const close = raw.indexOf("</a:p>", tagEnd + 1);
    if (close < 0) break;
    blocks.push(raw.slice(start, close + "</a:p>".length));
    i = close + "</a:p>".length;
  }
  return blocks;
}

function collectParagraphsDfs(node: any, acc: any[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) collectParagraphsDfs(n, acc);
    return;
  }
  for (const k of Object.keys(node)) {
    if (k.startsWith("@_") || k === "#text") continue;
    if (k === "a:p") {
      for (const p of asArray(node[k])) acc.push(p);
    } else {
      collectParagraphsDfs(node[k], acc);
    }
  }
}

async function readXmlRaw(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  return file.async("string");
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
