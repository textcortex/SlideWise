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
  ChartElement,
  ChartSeries,
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
  /**
   * Parsed `ppt/tableStyles.xml`, keyed by style GUID (uppercased, no
   * braces). Raw `<a:fill>` / `<a:tcTxStyle>` nodes are kept untouched so
   * each table can resolve colours against its own slide's theme.
   */
  tableStyles: Map<string, TableStyleRaw>;
  /**
   * GUID of the default table style declared at file level via
   * `<a:tableStyleList def="…">`. Applied when a `<a:tbl>` omits its own
   * `<a:tableStyleId>`.
   */
  defaultTableStyleId?: string;
}

/**
 * Raw table-style parts kept as parsed XML nodes — colour resolution
 * happens at apply time against the table's slide theme. Each part
 * corresponds to a `<a:wholeTbl>` / `<a:firstRow>` / `<a:band1H>` /
 * etc. region inside a `<a:tblStyle>`.
 */
interface TableStylePart {
  fill?: any; // <a:fill> or <a:fillRef>
  textColor?: any; // <a:tcTxStyle> colour child
  bold?: boolean;
}

interface TableStyleRaw {
  wholeTbl?: TableStylePart;
  firstRow?: TableStylePart;
  lastRow?: TableStylePart;
  firstCol?: TableStylePart;
  lastCol?: TableStylePart;
  band1H?: TableStylePart;
  band2H?: TableStylePart;
  band1V?: TableStylePart;
  band2V?: TableStylePart;
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
export async function parsePptx(
  blob: Blob | ArrayBuffer | Uint8Array
): Promise<Deck> {
  // Keep the original archive bytes so serializeDeck can re-inject any
  // OOXML we couldn't model (UnknownElement) back into the saved file
  // along with the media it referenced. See SOURCE_PPTX / SOURCE_SLIDE_PATH.
  const sourceBuffer = await toArrayBuffer(blob);
  const zip = await JSZip.loadAsync(sourceBuffer);
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

  // ppt/tableStyles.xml lives at a deck-level path referenced from
  // ppt/_rels/presentation.xml.rels. Loading it once and threading via
  // ParseContext keeps per-slide table parsing flat.
  const { styles: tableStyles, defaultId: defaultTableStyleId } =
    await readTableStyles(zip, presentationRels);

  const slides: Slide[] = [];
  for (const slidePath of slidePaths) {
    const slide = await parseSlide(
      zip,
      slidePath,
      diagnostics,
      fit,
      tableStyles,
      defaultTableStyleId
    );
    if (slide) {
      // Tag the slide with the source xml path so the serializer can pick
      // the right `ppt/slides/slideN.xml.rels` to copy media refs from
      // when the user adds / reorders / deletes slides in the editor.
      Object.defineProperty(slide, SOURCE_SLIDE_PATH, {
        value: slidePath,
        enumerable: false,
        configurable: true,
      });
      slides.push(slide);
    }
  }

  if (!slides.length) {
    slides.push({ id: nanoid(8), background: "#FFFFFF", elements: [] });
    diagnostics.warnings.push("PPTX contained no slides; created an empty one.");
  }

  const deck: Deck = { version: CURRENT_DECK_VERSION, title, slides };
  Object.defineProperty(deck, SOURCE_PPTX, {
    value: sourceBuffer,
    enumerable: false,
    configurable: true,
  });
  if (diagnostics.warnings.length) {
    console.info("[slidewise/pptx] parse diagnostics:", diagnostics);
  }
  return deck;
}

/** Non-enumerable property keys used to ferry the original archive
 * bytes from parse to serialize so we can round-trip the OOXML we
 * couldn't model. Internal — do not depend on these from outside the
 * package; the contract is enforced at the parse/serialize boundary. */
export const SOURCE_PPTX = "__slidewiseSourcePptx";
export const SOURCE_SLIDE_PATH = "__slidewiseSourceSlidePath";

/**
 * Per-element source-XML registry. Keyed by `SlideElement.id`, holds the
 * verbatim OOXML for every imported element + a snapshot of its semantic
 * fields at parse time. The serializer compares the current element to
 * the snapshot — if unchanged it re-emits the source XML verbatim
 * (bypassing pptxgenjs), so layout-derived gradients, custGeom paths,
 * backings, etc. survive saves regardless of pptxgenjs's coverage.
 *
 * Module-level Map → in-memory only. State that survives localStorage
 * rehydrate (where this Map is empty for a new module instance) falls
 * back to the legacy lossy pptxgenjs path. Hosts that need lossless
 * round-trip across page reloads should re-import the PPTX to repopulate.
 */
interface ElementSource {
  /** Verbatim `<p:sp>`/`<p:pic>`/`<p:cxnSp>`/`<p:graphicFrame>` XML. */
  xml: string;
  /** JSON snapshot of the semantic fields used for change detection. */
  snapshot: string;
  /** Source slide path the XML came from — used to resolve rels/media. */
  slidePath: string;
}

const elementSourceRegistry = new Map<string, ElementSource>();

export function getElementSource(elementId: string): ElementSource | undefined {
  return elementSourceRegistry.get(elementId);
}

export function snapshotElement(element: SlideElement): string {
  // Hash only fields the user can change in the editor. Element `id` and
  // `z` are intentionally excluded — they may be reassigned by the store
  // without representing a meaningful edit.
  const e = element as any;
  return JSON.stringify({
    type: e.type,
    x: e.x,
    y: e.y,
    w: e.w,
    h: e.h,
    rotation: e.rotation,
    text: e.text,
    fontFamily: e.fontFamily,
    fontSize: e.fontSize,
    fontWeight: e.fontWeight,
    italic: e.italic,
    underline: e.underline,
    strike: e.strike,
    color: e.color,
    align: e.align,
    vAlign: e.vAlign,
    lineHeight: e.lineHeight,
    letterSpacing: e.letterSpacing,
    runs: e.runs,
    shape: e.shape,
    fill: e.fill,
    stroke: e.stroke,
    strokeWidth: e.strokeWidth,
    radius: e.radius,
    src: e.src,
    fit: e.fit,
    crop: e.crop,
    dashed: e.dashed,
    arrow: e.arrow,
    rows: e.rows,
    headerFill: e.headerFill,
    rowFill: e.rowFill,
    textColor: e.textColor,
    borderColor: e.borderColor,
  });
}

function registerElementSource(
  element: SlideElement,
  rawXml: string | undefined,
  slidePath: string
): void {
  if (!rawXml) return;
  // Skip elements whose source XML relies on placeholder geometry
  // inheritance (no explicit <a:xfrm>). pptxgenjs writes its own
  // slideLayouts on save, so on re-parse those inherited positions are
  // gone — re-injecting the XML would produce a geom-less <p:sp> that
  // falls into UnknownElement. Letting pptxgenjs emit them instead
  // bakes the resolved coords into the output.
  if (!hasExplicitXfrm(rawXml)) return;
  elementSourceRegistry.set(element.id, {
    xml: rawXml,
    snapshot: snapshotElement(element),
    slidePath,
  });
}

function hasExplicitXfrm(xml: string): boolean {
  // Look only at top-level <p:spPr>/<p:grpSpPr> xfrm; child xfrm inside
  // e.g. a <p:txBody> doesn't count toward positioning the shape itself.
  return /<a:xfrm[\s>]/.test(xml);
}

async function toArrayBuffer(
  input: Blob | ArrayBuffer | Uint8Array
): Promise<ArrayBuffer> {
  if (input instanceof ArrayBuffer) return input;
  // Node Buffer is a Uint8Array subclass; honour it explicitly so the
  // server-side `serializeDeck → arrayBuffer → parsePptx` round-trip
  // works without the caller having to allocate a Blob.
  if (input instanceof Uint8Array) {
    const copy = new ArrayBuffer(input.byteLength);
    new Uint8Array(copy).set(input);
    return copy;
  }
  return input.arrayBuffer();
}

async function parseSlide(
  zip: JSZip,
  slidePath: string,
  diagnostics: ParseDiagnostics,
  fit: Fit,
  tableStyles: Map<string, TableStyleRaw>,
  defaultTableStyleId: string | undefined
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
    tableStyles,
    defaultTableStyleId,
  };

  const sld = xml["p:sld"];
  const cSld = sld?.["p:cSld"];
  const slideBg = await extractBackground(
    cSld?.["p:bg"],
    ctx,
    slideRels,
    slidePath
  );
  const layoutBg = layoutXml
    ? await extractBackground(
        layoutXml?.["p:sldLayout"]?.["p:cSld"]?.["p:bg"],
        ctx,
        layoutRels,
        layoutPath!
      )
    : undefined;
  const masterBg = masterXml
    ? await extractBackground(
        masterXml?.["p:sldMaster"]?.["p:cSld"]?.["p:bg"],
        ctx,
        masterRels,
        masterPath!
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
  // Allocate the slide id up front so underlay parsing can register any
  // overridden-placeholder source XML as a "backing decoration" for this
  // slide. The serializer reads that registry by slide id at save time.
  const slideId = nanoid(8);
  const slidePhKeys = collectSlidePlaceholderKeys(spTree);
  const masterUnderlay = masterXml
    ? await parseUnderlay(
        masterXml["p:sldMaster"]?.["p:cSld"]?.["p:spTree"],
        ctx,
        masterPath!,
        masterRels,
        slidePhKeys,
        slideId
      )
    : [];
  const layoutUnderlay = layoutXml
    ? await parseUnderlay(
        layoutXml["p:sldLayout"]?.["p:cSld"]?.["p:spTree"],
        ctx,
        layoutPath!,
        layoutRels,
        slidePhKeys,
        slideId
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
    id: slideId,
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
  slidePhKeys: Set<string>,
  slideId: string
): Promise<SlideElement[]> {
  if (!spTree) return [];
  const underlayCtx: ParseContext = {
    ...ctx,
    slidePath: ownerPath,
    slideRels: ownerRels,
  };
  return walkUnderlay(
    spTree,
    underlayCtx,
    identityTransform(),
    slidePhKeys,
    slideId
  );
}

async function walkUnderlay(
  spTree: any,
  ctx: ParseContext,
  outer: GroupTransform,
  slidePhKeys: Set<string>,
  slideId: string
): Promise<SlideElement[]> {
  const out: SlideElement[] = [];
  // Underlay elements come from a layout or master spTree — for the
  // serializer's per-element source-XML preservation, register them with
  // the *layout* (or master) path so referenced rels + media get pulled
  // from the right archive entry. ctx.slidePath has been shadowed to the
  // layout/master path by parseUnderlay, so the same registerElementSource
  // call works.
  const registerFromNode = (node: any, el: SlideElement | null) => {
    if (!el) return;
    const rawSrc = (node as any)?._elementRawSrc as string | undefined;
    registerElementSource(el, rawSrc, ctx.slidePath);
    out.push(el);
  };
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
      // text's z-index. pptxgenjs can't write those fields back though —
      // register the layout placeholder's source XML as a *backing
      // decoration* for the slide so the serializer can re-emit it
      // verbatim at low z behind the slide's text.
      if (isOverridden) {
        // The slide's text element already carries `background` /
        // `backingPath` baked from this layout placeholder. pptxgenjs
        // can't write those fields back, so they're lost on save — but
        // attempts to re-inject the layout's source XML produced
        // double-text and geometry-less shapes on re-parse. Accept the
        // backingPath/background loss for now; track in a follow-up that
        // writes raw OOXML for text elements carrying decoration fields.
        continue;
      }
      // Unreferenced placeholders: emit a fill-only backing so coloured
      // boxes (numbered chips, decorative panels) appear. Filler shapes
      // are synthetic — we don't register a source XML for them because
      // there's no single source element to replay verbatim.
      const filler = await placeholderFillUnderlay(sp, ctx, outer);
      if (filler) out.push(filler);
      continue;
    }
    registerFromNode(sp, await parseSpOrText(sp, ctx, outer, { underlay: true }));
  }
  for (const pic of asArray(spTree["p:pic"])) {
    if (isHiddenNode(pic, "p:nvPicPr")) continue;
    const ph = pic?.["p:nvPicPr"]?.["p:nvPr"]?.["p:ph"];
    if (ph && slidePhKeys.has(placeholderKey(ph))) continue;
    registerFromNode(pic, await parsePic(pic, ctx, outer));
  }
  for (const cxn of asArray(spTree["p:cxnSp"])) {
    registerFromNode(cxn, parseCxn(cxn, ctx, outer));
  }
  for (const grp of asArray(spTree["p:grpSp"])) {
    const inner = composeGroupTransform(grp, outer);
    out.push(
      ...(await walkUnderlay(grp, ctx, inner, slidePhKeys, slideId))
    );
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
    const rawSrc = (node as any)?._elementRawSrc as string | undefined;
    if (tag === "p:sp") {
      const el = await parseSpOrText(node, ctx, outer);
      if (el) {
        registerElementSource(el, rawSrc, ctx.slidePath);
        out.push(el);
      }
    } else if (tag === "p:pic") {
      const el = await parsePic(node, ctx, outer);
      if (el) {
        registerElementSource(el, rawSrc, ctx.slidePath);
        out.push(el);
      }
    } else if (tag === "p:cxnSp") {
      const el = parseCxn(node, ctx, outer);
      if (el) {
        registerElementSource(el, rawSrc, ctx.slidePath);
        out.push(el);
      }
    } else if (tag === "p:graphicFrame") {
      const el = await parseGraphicFrame(node, ctx, outer);
      if (el) {
        registerElementSource(el, rawSrc, ctx.slidePath);
        out.push(el);
      }
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
  // Treat as text when the element actually carries text OR when it's a
  // placeholder text host with no preset geometry override. A
  // non-placeholder shape with an empty <p:txBody> (commonly authored
  // around <a:custGeom> graphics like brand icons) is a SHAPE — promoting
  // it to a text element would drop the silhouette and fill.
  const isText = hasText || (isPlaceholderTextHost && !presetName);
  void opts;

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
  sp: any,
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
  // Inner padding from <a:bodyPr lIns/tIns/rIns/bIns>. PowerPoint applies
  // these as text-box insets (the typographic equivalent of CSS padding).
  // Default values in OOXML are 91440 / 45720 / 91440 / 45720 EMU. The
  // slide often carries an empty <a:bodyPr/> that should silently inherit
  // each attribute from the layout/master, so we read per-field rather
  // than swap whole bodyPr objects.
  const slideBp = effectiveTxBody?.["a:bodyPr"];
  const layoutBp = layoutPh?.bodyPr;
  const masterBp = masterPh?.bodyPr;
  const readIns = (key: string, fallback: number): number => {
    const v =
      slideBp?.[`@_${key}`] ??
      layoutBp?.[`@_${key}`] ??
      masterBp?.[`@_${key}`];
    return v !== undefined ? Number(v) : fallback;
  };
  const lIns = readIns("lIns", 91440);
  const tIns = readIns("tIns", 45720);
  const rIns = readIns("rIns", 91440);
  const bIns = readIns("bIns", 45720);
  const padding = {
    l: Math.round(emuToPx(lIns) * ctx.fit.scale),
    t: Math.round(emuToPx(tIns) * ctx.fit.scale),
    r: Math.round(emuToPx(rIns) * ctx.fit.scale),
    b: Math.round(emuToPx(bIns) * ctx.fit.scale),
  };
  if (padding.l || padding.t || padding.r || padding.b) {
    el.padding = padding;
  }

  // Layout placeholders often supply a fill (e.g. a tinted body box) or a
  // <a:custGeom> path (a white brand-logo plate) that should sit
  // *immediately* behind the slide's hosted text — at the same z, not in
  // the underlay. Otherwise a full-bleed image on the slide will cover the
  // backing. The slide's own <p:spPr> can also override the fill on a
  // per-element basis (e.g. one chip in a roadmap is the "active" red
  // tile) — read the slide's spPr first and fall back to the layout's.
  const slideSpPr = sp?.["p:spPr"];
  const layoutSpPr = layoutPh?.spPr;
  const slideFill = slideSpPr ? extractShapeFill(slideSpPr, ctx.theme) : undefined;
  const layoutFill = layoutSpPr ? extractShapeFill(layoutSpPr, ctx.theme) : undefined;
  const phFill = slideFill ?? layoutFill;
  const phSpPr = layoutSpPr;
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
  // present so vector logos stay sharp. EMF/WMF primaries also sometimes
  // ship an alternate raster blip in the same extLst — collect every rId
  // and let resolveBlipMedia pick the best renderable one.
  const blip = pic?.["p:blipFill"]?.["a:blip"];
  const candidateRefs = collectBlipRefs(blip);
  if (!candidateRefs.length) return toUnknown(pic, "p:pic", ctx, outer);

  const resolved = resolveBlipMedia(candidateRefs, ctx, pic);
  if (!resolved) return toUnknown(pic, "p:pic", ctx, outer);
  const { fullPath, file, ext } = resolved;
  let base64: string;
  let mime: string;
  if (ext === "emf" || ext === "wmf") {
    // No raster sibling shipped — decode the metafile in-browser via
    // emf-converter (Canvas-based EMF/WMF parser). Returns null when no
    // canvas API is available (e.g. SSR / Node tests without jsdom);
    // we fall back to the legacy diagnostic-skip in that case so consumers
    // still detect dropped vector metafiles.
    const decoded = await decodeMetafileToDataUrl(file, ext);
    if (!decoded) {
      ctx.diagnostics.warnings.push(
        `Skipped ${ext.toUpperCase()} image at ${fullPath} — vector metafile decode unavailable in this environment.`
      );
      return null;
    }
    // decoded is `data:image/png;base64,…` — strip prefix to match the
    // common path below.
    const comma = decoded.indexOf(",");
    base64 = comma >= 0 ? decoded.slice(comma + 1) : "";
    mime = "image/png";
  } else {
    base64 = await file.async("base64");
    mime = mimeForExt(ext);
  }

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
 * Decode an EMF / WMF metafile to a PNG data URL using `emf-converter`'s
 * Canvas-based replayer. Returns null when:
 *  - the runtime has no Canvas / OffscreenCanvas (SSR, Node without jsdom),
 *  - the metafile header is malformed,
 *  - the decoder throws (e.g. unsupported record).
 * The caller falls back to the legacy diagnostic-skip in that case so we
 * never blow up parsing over a single bad picture.
 */
async function decodeMetafileToDataUrl(
  file: JSZip.JSZipObject,
  ext: string
): Promise<string | null> {
  try {
    const u8 = await file.async("uint8array");
    const buffer = u8.buffer.slice(
      u8.byteOffset,
      u8.byteOffset + u8.byteLength
    ) as ArrayBuffer;
    const { convertEmfToDataUrl, convertWmfToDataUrl } = await import(
      "emf-converter"
    );
    return ext === "wmf"
      ? await convertWmfToDataUrl(buffer)
      : await convertEmfToDataUrl(buffer);
  } catch {
    return null;
  }
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

/**
 * Collect every rId that could provide pixels for a `<p:blipFill>`. Ordered
 * by preference: SVG blip (sharpest), the primary `<a:blip r:embed>`, then
 * any additional `r:embed` carried inside `<a:extLst>` (Microsoft
 * occasionally embeds an alt raster alongside an EMF primary).
 */
function collectBlipRefs(blip: any): string[] {
  if (!blip) return [];
  const out: string[] = [];
  const svgRef = findSvgBlipRef(blip);
  if (svgRef) out.push(svgRef);
  const primary = blip?.["@_r:embed"];
  if (primary && !out.includes(primary)) out.push(primary);
  const exts = asArray(blip?.["a:extLst"]?.["a:ext"]);
  for (const ext of exts) {
    // Skip the svgBlip envelope (handled above) and walk every remaining
    // descendant for an `r:embed` attribute.
    for (const ref of collectREmbedRefs(ext)) {
      if (!out.includes(ref)) out.push(ref);
    }
  }
  return out;
}

function collectREmbedRefs(node: any): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const it of n) walk(it);
      return;
    }
    const embed = n["@_r:embed"];
    if (typeof embed === "string") out.push(embed);
    for (const k of Object.keys(n)) {
      if (k.startsWith("@_")) continue;
      walk(n[k]);
    }
  };
  walk(node);
  return out;
}

const RASTER_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

interface ResolvedMedia {
  fullPath: string;
  file: JSZip.JSZipObject;
  ext: string;
}

/**
 * Pick the best renderable media file for a picture. Walks the candidate
 * rId list, prefers raster/SVG entries over EMF/WMF, and as a last resort
 * scans the slide rels for an image sharing the EMF's base filename — some
 * authoring tools ship `image1.emf` next to `image1.png` for exactly this
 * fallback case.
 */
function resolveBlipMedia(
  refs: string[],
  ctx: ParseContext,
  pic: any
): ResolvedMedia | null {
  type Candidate = { fullPath: string; file: JSZip.JSZipObject; ext: string };
  let emfHit: Candidate | null = null;

  const tryPath = (target: string): Candidate | null => {
    const fullPath = normalisePath(target, dirOf(ctx.slidePath));
    const file = ctx.zip.file(fullPath);
    if (!file) return null;
    const ext = (fullPath.split(".").pop() || "png").toLowerCase();
    return { fullPath, file, ext };
  };

  for (const ref of refs) {
    const target = ctx.slideRels.byId.get(ref)?.target;
    if (!target) continue;
    const c = tryPath(target);
    if (!c) continue;
    if (RASTER_EXTS.has(c.ext)) return c;
    if ((c.ext === "emf" || c.ext === "wmf") && !emfHit) emfHit = c;
  }

  // Last-ditch: when the only hit is EMF/WMF, scan the slide rels for any
  // image whose basename matches (`image1.emf` → `image1.png`). This catches
  // decks where PowerPoint shipped both formats but only the EMF was wired
  // into the <a:blip>.
  if (emfHit) {
    const base = emfHit.fullPath.replace(/\.[^.]+$/, "");
    const baseLeaf = base.split("/").pop() ?? base;
    for (const { target } of ctx.slideRels.byId.values()) {
      const candidatePath = normalisePath(target, dirOf(ctx.slidePath));
      const leaf = candidatePath.split("/").pop() ?? candidatePath;
      const ext = (candidatePath.split(".").pop() || "").toLowerCase();
      if (!RASTER_EXTS.has(ext)) continue;
      const leafBase = leaf.replace(/\.[^.]+$/, "");
      if (leafBase !== baseLeaf) continue;
      const file = ctx.zip.file(candidatePath);
      if (file) return { fullPath: candidatePath, file, ext };
    }
    // Picture-level <a:extLst> on the <p:pic> itself sometimes carries a
    // cached raster preview as <p:blip r:embed>; sweep that too.
    const picExtRefs = collectREmbedRefs(pic?.["p:nvPicPr"]?.["p:nvPr"]?.["p:extLst"]);
    for (const ref of picExtRefs) {
      const target = ctx.slideRels.byId.get(ref)?.target;
      if (!target) continue;
      const c = tryPath(target);
      if (c && RASTER_EXTS.has(c.ext)) return c;
    }
    return emfHit;
  }
  return null;
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

async function parseGraphicFrame(
  gf: any,
  ctx: ParseContext,
  outer: GroupTransform
): Promise<SlideElement | null> {
  const tbl = gf?.["a:graphic"]?.["a:graphicData"]?.["a:tbl"];
  if (tbl) {
    const parsed = parseTable(gf, tbl, ctx, outer);
    if (parsed) return parsed;
  }
  // Charts: <c:chart r:id="rId…"/> sits inside graphicData. We try, in
  // order: (1) cached preview image shipped via chart rels (fastest +
  // PowerPoint-faithful), (2) parse the chart XML into a ChartElement
  // and render it live via ECharts. The original <p:graphicFrame> XML is
  // always preserved so save round-trips keep the source chart part.
  const chart = gf?.["a:graphic"]?.["a:graphicData"]?.["c:chart"];
  if (chart) {
    const img = await parseChartCachedImage(gf, chart, ctx, outer);
    if (img) return img;
    const live = await parseLiveChart(gf, chart, ctx, outer);
    if (live) return live;
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

  // <a:tblPr> drives which style parts apply. Defaults match PowerPoint's
  // "Insert Table" behaviour: first row treated as header, no banding.
  const tblPr = tbl?.["a:tblPr"] ?? {};
  const tblPrAttr = (name: string): boolean => {
    const v = tblPr?.[`@_${name}`];
    return v === "1" || v === "true";
  };
  const hasHeader = tblPrAttr("firstRow");
  const hasLastRow = tblPrAttr("lastRow");
  const hasFirstCol = tblPrAttr("firstCol");
  const hasLastCol = tblPrAttr("lastCol");
  const bandRows = tblPrAttr("bandRow");

  const styleIdRaw =
    extractText(tblPr?.["a:tableStyleId"]) ?? ctx.defaultTableStyleId;
  const styleId = styleIdRaw ? normaliseGuid(styleIdRaw) : undefined;
  const style = styleId ? ctx.tableStyles.get(styleId) : undefined;

  const styleFill = (part: TableStylePart | undefined): string | undefined =>
    part ? resolveTableStyleFill(part, ctx) : undefined;
  const styleText = (part: TableStylePart | undefined): string | undefined =>
    part ? resolveTableStyleTextColor(part, ctx) : undefined;

  const wholeFill = styleFill(style?.wholeTbl);
  const wholeText = styleText(style?.wholeTbl);
  const headerStyleFill = styleFill(style?.firstRow);
  const headerStyleText = styleText(style?.firstRow);
  const lastRowFill = styleFill(style?.lastRow);
  const firstColFill = styleFill(style?.firstCol);
  const firstColText = styleText(style?.firstCol);
  const lastColFill = styleFill(style?.lastCol);
  const band1Fill = styleFill(style?.band1H);
  const band2Fill = styleFill(style?.band2H);

  const rows: string[][] = [];
  let firstFontSizePx: number | undefined;
  let firstColor: string | undefined;
  let headerCellFill: string | undefined;
  let bodyCellFill: string | undefined;

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

      // Cell-level <a:tcPr><a:solidFill> wins over style fills (PPTX
      // override semantics): record it here so the table-level defaults
      // we pick below don't clobber it. We can't model per-cell fills
      // yet, so the *first* explicit cell fill on the header / body
      // wins for the whole row class.
      const cellFill = resolveColor(tc?.["a:tcPr"]?.["a:solidFill"], ctx.theme);
      if (cellFill) {
        if (ri === 0 && headerCellFill === undefined) headerCellFill = cellFill;
        else if (ri > 0 && bodyCellFill === undefined) bodyCellFill = cellFill;
      }
    }
    rows.push(cells);
  }

  // Resolve final fills with precedence: cell-level override > style part > whole-table > built-in default.
  const headerFill =
    headerCellFill ?? (hasHeader ? headerStyleFill : undefined) ?? wholeFill ?? "#0E1330";
  const rowFill = bodyCellFill ?? band1Fill ?? wholeFill ?? "#FFFFFF";
  const rowAltFill = bandRows ? band2Fill ?? wholeFill : undefined;

  const table: TableElement = {
    id: nanoid(8),
    type: "table",
    ...geom,
    z: 0,
    rows,
    headerFill,
    rowFill,
    textColor: firstColor ?? wholeText ?? "#0E1330",
    fontSize: firstFontSizePx ?? 18,
    hasHeader,
    bandRows,
    ...(rowAltFill ? { rowAltFill } : {}),
    ...(hasLastRow && lastRowFill ? { lastRowFill } : {}),
    ...(hasFirstCol && firstColFill ? { firstColFill } : {}),
    ...(hasLastCol && lastColFill ? { lastColFill } : {}),
    ...(hasHeader && headerStyleText ? { headerTextColor: headerStyleText } : {}),
    ...(hasFirstCol && firstColText ? { firstColTextColor: firstColText } : {}),
  };
  return table;
}

/**
 * Render a chart's cached image (when one is shipped alongside the chart
 * part) as an ImageElement. PowerPoint authoring tools embed a rasterised
 * preview either as a related image part on `ppt/charts/chartN.xml` or
 * inside the chart XML's `<c:plotArea>`/`<c:extLst>` — both code paths
 * land here. Returns null when no usable raster is found; the caller
 * falls back to UnknownElement.
 *
 * Live chart rendering (parse series → ECharts) is a deliberate follow-up;
 * see docs/plans/pptx-tables-charts-emf.md.
 */
async function parseChartCachedImage(
  gf: any,
  chart: any,
  ctx: ParseContext,
  outer: GroupTransform
): Promise<ImageElement | null> {
  const xfrm = gf?.["p:xfrm"] || gf?.["p:spPr"]?.["a:xfrm"];
  const geom = readGeometry(xfrm, ctx.fit, outer);
  if (!geom) return null;

  const chartRef: string | undefined = chart?.["@_r:id"];
  if (!chartRef) return null;
  const chartTarget = ctx.slideRels.byId.get(chartRef)?.target;
  if (!chartTarget) return null;
  const chartPath = normalisePath(chartTarget, dirOf(ctx.slidePath));
  const chartRels = await readRels(ctx.zip, relsPathFor(chartPath));

  // Image rels off the chart part — image1.png next to chart1.xml is the
  // common shape, but we accept any `…/relationships/image` entry.
  const imageTargets: string[] = [];
  for (const { target, type } of chartRels.byId.values()) {
    if (type.endsWith("/image")) imageTargets.push(target);
  }

  for (const target of imageTargets) {
    const fullPath = normalisePath(target, dirOf(chartPath));
    const file = ctx.zip.file(fullPath);
    if (!file) continue;
    const ext = (fullPath.split(".").pop() || "png").toLowerCase();
    if (!RASTER_EXTS.has(ext)) continue;
    const base64 = await file.async("base64");
    const mime = mimeForExt(ext);
    return {
      id: nanoid(8),
      type: "image",
      ...geom,
      z: 0,
      src: `data:${mime};base64,${base64}`,
      fit: "contain",
      alt: "Chart",
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Live chart parsing (bar / column / line / pie / doughnut / area)
// ---------------------------------------------------------------------------

const CHART_TAG_TO_KIND: Record<string, ChartElement["kind"]> = {
  "c:barChart": "bar", // direction (col vs bar) refines later
  "c:bar3DChart": "bar",
  "c:lineChart": "line",
  "c:line3DChart": "line",
  "c:pieChart": "pie",
  "c:pie3DChart": "pie",
  "c:doughnutChart": "doughnut",
  "c:areaChart": "area",
  "c:area3DChart": "area",
};

/**
 * Parse the chart part referenced by a `<c:chart>` into a ChartElement. The
 * source `<p:graphicFrame>` XML is preserved on the element so save
 * round-trips re-emit it verbatim (we don't yet write chart XML back from
 * editor edits). Returns null when the chart part is missing, has no
 * recognisable plot, or has no series data.
 */
async function parseLiveChart(
  gf: any,
  chart: any,
  ctx: ParseContext,
  outer: GroupTransform
): Promise<ChartElement | null> {
  const xfrm = gf?.["p:xfrm"] || gf?.["p:spPr"]?.["a:xfrm"];
  const geom = readGeometry(xfrm, ctx.fit, outer);
  if (!geom) return null;

  const chartRef: string | undefined = chart?.["@_r:id"];
  if (!chartRef) return null;
  const chartTarget = ctx.slideRels.byId.get(chartRef)?.target;
  if (!chartTarget) return null;
  const chartPath = normalisePath(chartTarget, dirOf(ctx.slidePath));
  const chartXml = await readXml(ctx.zip, chartPath);
  const plotArea = chartXml?.["c:chartSpace"]?.["c:chart"]?.["c:plotArea"];
  if (!plotArea) return null;

  // Find the first recognised plot tag. PowerPoint allows multiple charts
  // co-plotted (e.g. combo bar+line) but the first plot usually dominates;
  // we render that and fall through to UnknownElement if nothing fits.
  let plotNode: any | undefined;
  let kindTag: string | undefined;
  for (const tag of Object.keys(CHART_TAG_TO_KIND)) {
    if (plotArea[tag]) {
      plotNode = plotArea[tag];
      kindTag = tag;
      break;
    }
  }
  if (!plotNode || !kindTag) return null;

  let kind = CHART_TAG_TO_KIND[kindTag];
  // <c:barChart><c:barDir val="bar"/> means horizontal bars; "col" is the
  // vertical default. We distinguish so the renderer can pick orientation.
  const barDir = plotNode?.["c:barDir"]?.["@_val"];
  if (kindTag.startsWith("c:bar") && barDir === "col") kind = "column";

  const groupingVal = plotNode?.["c:grouping"]?.["@_val"];
  const grouping: ChartElement["grouping"] | undefined =
    groupingVal === "stacked"
      ? "stacked"
      : groupingVal === "percentStacked"
        ? "percentStacked"
        : groupingVal === "clustered" || groupingVal === "standard"
          ? "standard"
          : undefined;

  const sers = asArray(plotNode["c:ser"]);
  if (!sers.length) return null;

  // Categories come from the first series' <c:cat>; PPTX requires every
  // series to share the same category axis so this is safe.
  const categories: string[] = extractCategories(sers[0]);

  const series: ChartSeries[] = [];
  let valueFormat: string | undefined;
  let showDataLabels = false;
  for (const ser of sers) {
    const name = extractSeriesName(ser);
    const values = extractSeriesValues(ser, categories.length);
    if (!values.length && !name) continue;
    // PPTX series colours: explicit `<c:spPr><a:solidFill>` wins; otherwise
    // PowerPoint uses the theme accent palette indexed by `<c:idx>` modulo
    // 6, cycling accent1..accent6. (Order is the visual position; idx is
    // the colour-picker key — they often differ, e.g. the second-drawn
    // series can have idx=0 to inherit accent1.)
    const explicitFill = ser?.["c:spPr"]?.["a:solidFill"];
    const idx = Number(ser?.["c:idx"]?.["@_val"] ?? 0);
    const color =
      resolveColor(explicitFill, ctx.theme) ?? seriesAccentColor(idx, ctx.theme);
    series.push({ name, values, ...(color ? { color } : {}) });
    if (!valueFormat) {
      const num = ser?.["c:val"]?.["c:numRef"]?.["c:numCache"]?.["c:formatCode"];
      const code = typeof num === "string" ? num : num?.["#text"];
      if (typeof code === "string" && code !== "General") valueFormat = code;
    }
    if (!showDataLabels && ser?.["c:dLbls"]?.["c:showVal"]?.["@_val"] === "1") {
      showDataLabels = true;
    }
  }
  if (!series.length) return null;

  const title = extractChartTitle(chartXml?.["c:chartSpace"]?.["c:chart"]?.["c:title"]);
  const ooxmlXml = xmlBuilder.build({ "p:graphicFrame": gf });

  const element: ChartElement = {
    id: nanoid(8),
    type: "chart",
    ...geom,
    z: 0,
    kind,
    ...(grouping ? { grouping } : {}),
    categories,
    series,
    ...(showDataLabels ? { showDataLabels: true } : {}),
    ...(title ? { title } : {}),
    ...(valueFormat ? { valueFormat } : {}),
    ooxmlXml,
  };
  return element;
}

function extractCategories(ser: any): string[] {
  const cat = ser?.["c:cat"] ?? ser?.["c:xVal"];
  if (!cat) return [];
  const strCache = cat?.["c:strRef"]?.["c:strCache"] ?? cat?.["c:strCache"];
  const numCache = cat?.["c:numRef"]?.["c:numCache"] ?? cat?.["c:numCache"];
  const cache = strCache ?? numCache;
  if (!cache) return [];
  const ptCount = Number(cache?.["c:ptCount"]?.["@_val"] ?? 0);
  const pts = asArray(cache?.["c:pt"]);
  const arr = new Array<string>(ptCount).fill("");
  for (const p of pts) {
    const idx = Number(p?.["@_idx"] ?? -1);
    if (idx < 0 || idx >= ptCount) continue;
    const v = p?.["c:v"];
    arr[idx] = typeof v === "string" ? v : (v?.["#text"] ?? "");
  }
  return arr;
}

function extractSeriesName(ser: any): string {
  const tx = ser?.["c:tx"];
  if (!tx) return "";
  const cache = tx?.["c:strRef"]?.["c:strCache"];
  if (cache) {
    const pt = asArray(cache["c:pt"])[0];
    const v = pt?.["c:v"];
    return typeof v === "string" ? v : (v?.["#text"] ?? "");
  }
  const v = tx?.["c:v"];
  return typeof v === "string" ? v : "";
}

function extractSeriesValues(ser: any, expected: number): (number | null)[] {
  const val = ser?.["c:val"] ?? ser?.["c:yVal"];
  if (!val) return [];
  const cache = val?.["c:numRef"]?.["c:numCache"] ?? val?.["c:numCache"];
  if (!cache) return [];
  const ptCount = Number(cache?.["c:ptCount"]?.["@_val"] ?? expected);
  const length = Math.max(ptCount, expected);
  const out = new Array<number | null>(length).fill(null);
  for (const p of asArray(cache["c:pt"])) {
    const idx = Number(p?.["@_idx"] ?? -1);
    if (idx < 0 || idx >= length) continue;
    const v = p?.["c:v"];
    const raw = typeof v === "string" ? v : v?.["#text"];
    const n = raw === undefined ? NaN : Number(raw);
    out[idx] = Number.isFinite(n) ? n : null;
  }
  return out;
}

/**
 * PowerPoint default series colour: `theme.accent{(idx % 6) + 1}`. Matches
 * the visual order the colour picker cycles when an author never overrides
 * a series fill — for the Dickinson sample, series-with-idx-0 picks up
 * accent1 (red).
 */
function seriesAccentColor(idx: number, theme: ThemeColors): string {
  const slot = ((idx % 6) + 6) % 6; // safe modulo for negatives
  const key = (`accent${slot + 1}`) as keyof ThemeColors;
  return theme[key];
}

function extractChartTitle(title: any): string | undefined {
  if (!title) return undefined;
  const paragraphs = asArray(title?.["c:tx"]?.["c:rich"]?.["a:p"]);
  const parts: string[] = [];
  for (const p of paragraphs) {
    for (const r of asArray(p?.["a:r"])) {
      const t = r?.["a:t"];
      if (typeof t === "string") parts.push(t);
      else if (t?.["#text"]) parts.push(t["#text"]);
    }
  }
  const joined = parts.join("").trim();
  return joined || undefined;
}

function normaliseGuid(raw: string): string {
  return raw.trim().replace(/[{}]/g, "").toUpperCase();
}

function extractText(node: any): string | undefined {
  if (!node) return undefined;
  if (typeof node === "string") return node;
  if (typeof node === "object" && typeof node["#text"] === "string") {
    return node["#text"];
  }
  return undefined;
}

/**
 * Resolve a table-style `<a:fillRef>`/`<a:fill>` into a CSS colour against
 * the current slide's theme. Style entries use `<a:fillRef idx="…">`
 * pointing at the theme's fillStyleLst, or carry an inline `<a:fill>` with
 * a `<a:solidFill>`. We only handle solid fills here — gradient / pattern
 * styles fall through to the table's default row fill.
 */
function resolveTableStyleFill(
  part: TableStylePart,
  ctx: ParseContext
): string | undefined {
  const node = part.fill;
  if (!node) return undefined;
  // Inline solid fill.
  const solid = node?.["a:solidFill"];
  if (solid) {
    return resolveColor(substitutePhClr(solid, undefined), ctx.theme);
  }
  // <a:fillRef idx="N"><a:schemeClr…/></a:fillRef> — N is 1-based into
  // fillStyleLst. We use the schemeClr inside as the colour, ignoring the
  // referenced fill style itself (gradients aren't modelled on tables).
  const fillRef = node?.["a:fillRef"] ?? node;
  if (fillRef && (fillRef["a:schemeClr"] || fillRef["a:srgbClr"])) {
    return resolveColor(fillRef, ctx.theme);
  }
  return undefined;
}

function resolveTableStyleTextColor(
  part: TableStylePart,
  ctx: ParseContext
): string | undefined {
  if (!part.textColor) return undefined;
  return resolveColor(part.textColor, ctx.theme);
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
  const base = readBaseHex(inner, theme);
  if (!base) return undefined;
  let { r, g, b, a } = hexToRgba(base);

  const modParent = pickColorChildEnvelope(node) ?? inner;
  const lumMod = numFromVal(modParent?.["a:lumMod"]);
  const lumOff = numFromVal(modParent?.["a:lumOff"]);
  const shade = numFromVal(modParent?.["a:shade"]);
  const tint = numFromVal(modParent?.["a:tint"]);
  const alphaN = numFromVal(modParent?.["a:alpha"]);

  // lumMod / lumOff operate in HSL on the luminance channel. tint / shade
  // operate per-RGB-channel per ECMA-376 §20.1.2.3 (mix with white / black
  // respectively). Conflating the two — as a single HSL-luminance shift —
  // over-saturates pastel tints like Office's "Medium Style 2 — Accent 1"
  // table style.
  if (lumMod !== undefined || lumOff !== undefined) {
    let { h, s, l } = rgbToHsl(r, g, b);
    if (lumMod !== undefined) l = clamp(l * lumMod);
    if (lumOff !== undefined) l = clamp(l + lumOff);
    ({ r, g, b } = hslToRgb(h, s, l));
  }
  if (tint !== undefined) {
    // tint=1 → unchanged; tint=0 → white. final = base*tint + 255*(1-tint).
    r = r * tint + 255 * (1 - tint);
    g = g * tint + 255 * (1 - tint);
    b = b * tint + 255 * (1 - tint);
  }
  if (shade !== undefined) {
    // shade=1 → unchanged; shade=0 → black. final = base * shade.
    r = r * shade;
    g = g * shade;
    b = b * shade;
  }
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
    // <a:fillToRect> giving the focus rectangle. l/t/r/b are percentage
    // insets from each edge of the shape; the rect's centre is the focus
    // point. OOXML radial stops use the SAME convention as CSS — pos=0 at
    // the centre, pos=100% at the outer boundary — so we keep the stop
    // positions verbatim. The visual blob lands where fillToRect sits;
    // on a tall, narrow panel the same radial reads almost vertical, on a
    // 16:9 slide it reads as the expected red orb fading to purple.
    const pathNode = gf["a:path"];
    if (pathNode) {
      const pathType = pathNode["@_path"];
      const ftr = pathNode["a:fillToRect"];
      const lIn = Number(ftr?.["@_l"] ?? 0) / 1000;
      const tIn = Number(ftr?.["@_t"] ?? 0) / 1000;
      const rIn = Number(ftr?.["@_r"] ?? 0) / 1000;
      const bIn = Number(ftr?.["@_b"] ?? 0) / 1000;
      const focusX = clampPct((lIn + (100 - rIn)) / 2);
      const focusY = clampPct((tIn + (100 - bIn)) / 2);
      // path="circle" — a true geometric circle in CSS terms (so the blob
      // stays round on rectangular shapes); path="rect" — anisotropic
      // ellipse stretched with the shape's aspect ratio.
      const shape = pathType === "circle" ? "circle" : "ellipse";
      const stopsCss = stops
        .map((s) => `${s.color} ${s.pos.toFixed(2)}%`)
        .join(", ");
      return `radial-gradient(${shape} at ${focusX.toFixed(2)}% ${focusY.toFixed(2)}%, ${stopsCss})`;
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

async function extractBackground(
  bg: any,
  ctx: ParseContext,
  rels: Rels,
  basePath: string
): Promise<string | undefined> {
  if (!bg) return undefined;
  const bgPr = bg["p:bgPr"];
  if (bgPr) {
    if (bgPr["a:noFill"] !== undefined) return "transparent";
    const solid = resolveColor(bgPr["a:solidFill"], ctx.theme);
    if (solid) return solid;
    const grad = extractShapeFill({ "a:gradFill": bgPr["a:gradFill"] }, ctx.theme);
    if (grad) return grad;
    const blip = bgPr["a:blipFill"]?.["a:blip"];
    if (blip) {
      const url = await blipDataUrl(blip, ctx, rels, basePath);
      if (url) return `center / cover no-repeat url("${url}")`;
    }
  }
  const bgRef = bg["p:bgRef"];
  if (bgRef) return resolveBgRef(bgRef, ctx);
  return undefined;
}

async function blipDataUrl(
  blip: any,
  ctx: ParseContext,
  rels: Rels,
  basePath: string
): Promise<string | undefined> {
  // Prefer the vector embed when present (dual-blip SVG pattern); fall
  // back to the raster.
  const svgRef = findSvgBlipRef(blip);
  const rid = svgRef ?? blip?.["@_r:embed"];
  if (!rid) return undefined;
  const target = rels.byId.get(rid)?.target;
  if (!target) return undefined;
  const full = normalisePath(target, dirOf(basePath));
  const file = ctx.zip.file(full);
  if (!file) return undefined;
  const base64 = await file.async("base64");
  const ext = (full.split(".").pop() || "png").toLowerCase();
  return `data:${mimeForExt(ext)};base64,${base64}`;
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
  // Track the current pen position so <a:arcTo> (which doesn't carry an
  // explicit end point) can compute its SVG `A` endpoint from start +
  // sweep angle, just like PowerPoint does at render time.
  let penX = 0;
  let penY = 0;
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
        const cmdClose = inner.indexOf(`</a:${name}>`, close + 1);
        if (cmdClose < 0) break;
        const body = inner.slice(close + 1, cmdClose);
        const pts: Array<[number, number]> = [];
        const ptRe = /<a:pt\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>/g;
        let m: RegExpExecArray | null;
        while ((m = ptRe.exec(body))) {
          pts.push([Number(m[1]), Number(m[2])]);
        }
        if (pts.length) {
          const letter =
            name === "moveTo"
              ? "M"
              : name === "lnTo"
                ? "L"
                : name === "cubicBezTo"
                  ? "C"
                  : "Q";
          out += ` ${letter} ${pts.map(([x, y]) => `${x} ${y}`).join(" ")}`;
          const last = pts[pts.length - 1];
          penX = last[0];
          penY = last[1];
        }
        i = cmdClose + `</a:${name}>`.length;
        continue;
      } else if (name === "arcTo") {
        // <a:arcTo wR="" hR="" stAng="" swAng="" /> — elliptical arc
        // starting at the current pen position. wR/hR are the axis radii;
        // stAng/swAng are start/sweep angles measured in 60000ths of a
        // degree (OOXML convention). The start point on the ellipse is
        // (centre.x + wR·cos(stAng), centre.y + hR·sin(stAng)); the
        // centre is therefore (pen.x − wR·cos(stAng), pen.y − hR·sin(stAng)).
        // SVG `A` takes the END point instead of an angle, so we compute
        // the end from start + swAng.
        const wR = Number(/\bwR="(-?\d+)"/.exec(tag)?.[1] ?? 0);
        const hR = Number(/\bhR="(-?\d+)"/.exec(tag)?.[1] ?? 0);
        const stAng = Number(/\bstAng="(-?\d+)"/.exec(tag)?.[1] ?? 0) / 60000;
        const swAng = Number(/\bswAng="(-?\d+)"/.exec(tag)?.[1] ?? 0) / 60000;
        if (wR > 0 && hR > 0) {
          const rad = (deg: number) => (deg * Math.PI) / 180;
          const cx = penX - wR * Math.cos(rad(stAng));
          const cy = penY - hR * Math.sin(rad(stAng));
          const endAng = stAng + swAng;
          const ex = cx + wR * Math.cos(rad(endAng));
          const ey = cy + hR * Math.sin(rad(endAng));
          const largeArc = Math.abs(swAng) > 180 ? 1 : 0;
          const sweep = swAng > 0 ? 1 : 0;
          out += ` A ${wR} ${hR} 0 ${largeArc} ${sweep} ${ex.toFixed(2)} ${ey.toFixed(2)}`;
          penX = ex;
          penY = ey;
        }
      }
      // Unknown commands are skipped — the rest of the path stays valid.
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
  annotateSpTreeElementRawSrc(parsed, rawText);
}

/**
 * Attach `_rawSrc: string` to every `<p:sp>`, `<p:pic>`, `<p:cxnSp>`, and
 * `<p:graphicFrame>` node carrying the verbatim XML for that element.
 * Used by the per-element source-XML preservation in the serializer so
 * the OOXML for any imported element survives untouched until the user
 * actually edits it. Same depth-aware scan as
 * `annotateSpTreeChildOrder`, paired to the parsed nodes in document
 * order.
 */
function annotateSpTreeElementRawSrc(parsed: any, rawText: string): void {
  for (const tag of ["p:sp", "p:pic", "p:cxnSp", "p:graphicFrame"] as const) {
    if (!rawText.includes(`<${tag}`)) continue;
    const blocks = findAllRawBlocks(rawText, tag);
    if (!blocks.length) continue;
    const nodes: any[] = [];
    collectNamedDfs(parsed, tag, nodes);
    const n = Math.min(blocks.length, nodes.length);
    for (let i = 0; i < n; i++) {
      Object.defineProperty(nodes[i], "_elementRawSrc", {
        value: blocks[i],
        enumerable: false,
        configurable: true,
      });
    }
  }
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
      // Skip non-object values — fast-xml-parser deserialises some
      // self-closing or whitespace-only elements as empty strings, and
      // later property attachment passes call `Object.defineProperty` on
      // these entries.
      for (const v of asArray(node[k])) {
        if (v && typeof v === "object") acc.push(v);
      }
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
      for (const p of asArray(node[k])) {
        if (p && typeof p === "object") acc.push(p);
      }
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

/**
 * Parse `ppt/tableStyles.xml` once at the top of a deck import. The file
 * is referenced from `ppt/_rels/presentation.xml.rels` with relationship
 * type `…/relationships/tableStyles`. Returns a map keyed by uppercased,
 * unbraced GUID plus the file-level default GUID (from
 * `<a:tblStyleLst def="…">`) when present.
 *
 * Only solid-fill style parts are captured; gradient / pattern parts and
 * border styling aren't modelled yet. Each `<a:tblStyle>` may have any of
 * the part regions; missing ones simply leave the field undefined and
 * fall back to the table's row/header defaults at apply time.
 */
async function readTableStyles(
  zip: JSZip,
  presentationRels: Rels
): Promise<{ styles: Map<string, TableStyleRaw>; defaultId?: string }> {
  const styles = new Map<string, TableStyleRaw>();
  let target: string | undefined;
  for (const { target: t, type } of presentationRels.byId.values()) {
    if (type.endsWith("/tableStyles")) {
      target = t;
      break;
    }
  }
  const path = target
    ? normalisePath(target, "ppt")
    : "ppt/tableStyles.xml";
  const xml = await readXml(zip, path);
  if (!xml) return { styles };
  const lst = xml?.["a:tblStyleLst"];
  if (!lst) return { styles };
  const defaultId = lst["@_def"] ? normaliseGuid(lst["@_def"]) : undefined;
  for (const s of asArray(lst["a:tblStyle"])) {
    const guidAttr: string | undefined = s?.["@_styleId"];
    if (!guidAttr) continue;
    const guid = normaliseGuid(guidAttr);
    styles.set(guid, extractTableStyle(s));
  }
  return { styles, defaultId };
}

function extractTableStyle(node: any): TableStyleRaw {
  const part = (name: string): TableStylePart | undefined => {
    const region = node?.[name];
    if (!region) return undefined;
    const tcStyle = region["a:tcStyle"];
    const tcTxStyle = region["a:tcTxStyle"];
    const fill = tcStyle?.["a:fill"] ?? tcStyle?.["a:fillRef"];
    const out: TableStylePart = {};
    if (fill) out.fill = fill;
    if (tcTxStyle) {
      out.textColor = pickColorChild(tcTxStyle) ?? tcTxStyle;
      const b = tcTxStyle["@_b"];
      if (b === "on" || b === "1" || b === "true") out.bold = true;
    }
    return out.fill || out.textColor ? out : undefined;
  };
  return {
    wholeTbl: part("a:wholeTbl"),
    firstRow: part("a:firstRow"),
    lastRow: part("a:lastRow"),
    firstCol: part("a:firstCol"),
    lastCol: part("a:lastCol"),
    band1H: part("a:band1H"),
    band2H: part("a:band2H"),
    band1V: part("a:band1V"),
    band2V: part("a:band2V"),
  };
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
