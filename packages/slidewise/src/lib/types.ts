export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

export type ElementType =
  | "text"
  | "shape"
  | "image"
  | "line"
  | "table"
  | "icon"
  | "embed"
  | "chart"
  | "group"
  | "unknown";

/**
 * Drop shadow descriptor — emitted as CSS `box-shadow`/`text-shadow` in the
 * renderer and `<a:outerShdw>` inside `<a:effectLst>` on save. Offsets and
 * blur are in canvas pixels.
 */
export interface ShadowSpec {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Outer-glow descriptor — emitted as CSS `filter: drop-shadow(…)` /
 * `text-shadow` (since CSS has no native glow primitive) and `<a:glow>`
 * inside `<a:effectLst>` on save.
 */
export interface GlowSpec {
  color: string;
  radius: number;
}

/**
 * Dash pattern for stroked lines / shape outlines. Mirrors OOXML's
 * `<a:prstDash val="…">` value list — these are the patterns PowerPoint
 * recognises and renders without falling back to a custom dash.
 */
export type DashType =
  | "solid"
  | "dash"
  | "dot"
  | "dashDot"
  | "lgDash"
  | "sysDash";

export type EnterAnim =
  | "none"
  | "fade"
  | "slide-up"
  | "slide-down"
  | "slide-left"
  | "slide-right"
  | "scale"
  | "draw";

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  z: number;
  locked?: boolean;
  enter?: EnterAnim;
  delay?: number;
}

/**
 * One styled fragment within a text element. Any field left undefined falls
 * back to the parent TextElement's flat default. Run text may contain "\n" —
 * which becomes a paragraph break in both renderer and PPTX writer.
 */
export interface TextRun {
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  letterSpacing?: number;
}

export interface TextElement extends BaseElement {
  type: "text";
  /** Optional text shadow — CSS `text-shadow` / OOXML `<a:outerShdw>`. */
  shadow?: ShadowSpec;
  /** Optional outer glow — CSS `text-shadow` / OOXML `<a:glow>`. */
  glow?: GlowSpec;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  align: "left" | "center" | "right";
  vAlign: "top" | "middle" | "bottom";
  lineHeight: number;
  letterSpacing: number;
  /**
   * Optional CSS background applied behind the text box. PPTX importers set
   * this from the layout placeholder's fill when the slide overrides the
   * placeholder (e.g. a tinted body box hosting slide-supplied text). Stays
   * with the text element so it sits at the same z as the text — important
   * when the slide also has a full-bleed image that would otherwise cover
   * the fill if rendered as a separate underlay shape.
   */
  background?: string;
  /**
   * Optional vector glyph drawn behind the text. Set by the PPTX importer
   * when the layout placeholder carried an `<a:custGeom>` (typically a
   * brand logo plate) — the path fills the text box, the text spans render
   * on top. Same renderer contract as ShapeElement.path.
   */
  backingPath?: {
    d: string;
    viewW: number;
    viewH: number;
    fill: string;
    fillRule?: "nonzero" | "evenodd";
  };
  /**
   * Optional inner padding (in canvas pixels) for the text box. The PPTX
   * importer fills this from `<a:bodyPr lIns/tIns/rIns/bIns>` so tinted
   * placeholder boxes don't render with text flush to their edges.
   */
  padding?: { l: number; t: number; r: number; b: number };
  /**
   * Optional rich-text breakdown. When present, the renderer and PPTX writer
   * use these per-run styles; the flat fields above act as defaults for any
   * field a run leaves unset. Editing the text via the contentEditable surface
   * collapses runs back to the flat representation.
   */
  runs?: TextRun[];
  /**
   * Optional per-paragraph layout metadata. PPTX bullets use a hanging-indent
   * pattern (`marL` positive, `indent` negative) so the bullet hangs out to
   * the left of the wrapped text. Splitting the text into paragraphs lets the
   * renderer apply `padding-left` + `text-indent` per paragraph rather than
   * collapsing every wrap line back to column 0.
   */
  paragraphs?: Array<{
    text: string;
    marL?: number;
    indent?: number;
    align?: "left" | "center" | "right";
    runs?: TextRun[];
    /** Space before paragraph in canvas pixels (from PPTX `<a:spcBef>`). */
    spaceBefore?: number;
  }>;
}

export type ShapeKind =
  | "rect"
  | "rounded"
  | "circle"
  | "triangle"
  | "star"
  | "diamond";

export interface ShapeElement extends BaseElement {
  type: "shape";
  shape: ShapeKind;
  /**
   * Solid hex (`#RRGGBB`), `transparent`, a CSS `linear-gradient(...)` /
   * `radial-gradient(...)` string (set by the PPTX importer from
   * `<a:gradFill>` — see `pptxToDeck.ts`), or a `url(data:image/...)` /
   * `url(https://...)` string. The writer detects each form by parsing.
   */
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  /**
   * Typed dash pattern for the stroke — AI-authored and host-supplied
   * decks set this. `strokeDash` is the raw OOXML value coming out of
   * the importer; the renderer accepts either (`strokeDash` wins when
   * both are set, since it preserves the exact PPTX intent).
   */
  dashType?: DashType;
  /**
   * Raw PPTX `<a:prstDash val="…">` style for the stroke (e.g. "dot", "dash",
   * "dashDot", "lgDash", "sysDot"). Only the patterned values are honoured;
   * absent or "solid" renders as a continuous stroke.
   */
  strokeDash?: string;
  radius?: number;
  /** Optional drop shadow — CSS `box-shadow` / OOXML `<a:outerShdw>`. */
  shadow?: ShadowSpec;
  /** Optional outer glow — CSS `filter: drop-shadow` / OOXML `<a:glow>`. */
  glow?: GlowSpec;
  /**
   * Optional vector path, set when the shape was imported from a PPTX
   * `<a:custGeom>` (logos, brand marks, hand-drawn shapes). The renderer
   * draws this as an SVG `<path>` filling the shape's bounding box; the
   * `shape` field remains as a sensible fallback for older renderers.
   */
  path?: ShapePath;
}

export interface ShapePath {
  /** SVG path `d` attribute. */
  d: string;
  /** Path coordinate-system width (mapped onto the element's bounding box). */
  viewW: number;
  /** Path coordinate-system height. */
  viewH: number;
  /** SVG `fill-rule` to apply — defaults to `nonzero`. */
  fillRule?: "nonzero" | "evenodd";
}

export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
  alt?: string;
  fit: "cover" | "contain" | "fill";
  radius?: number;
  /**
   * PPTX <a:srcRect> source crop, expressed as fractions (0..1) of the source
   * image to chop from each edge before placing into the bounding box.
   * Slidewise applies it via background-image / background-position so the
   * final paint matches PowerPoint's "crop + stretch" behaviour.
   */
  crop?: { l: number; r: number; t: number; b: number };
}

export interface LineElement extends BaseElement {
  type: "line";
  stroke: string;
  strokeWidth: number;
  arrow?: boolean;
  /** Legacy convenience flag — equivalent to `dashType: "dash"`. */
  dashed?: boolean;
  /** Detailed dash pattern. When set, takes precedence over `dashed`. */
  dashType?: DashType;
  /** Optional drop shadow. */
  shadow?: ShadowSpec;
  /** Optional outer glow. */
  glow?: GlowSpec;
}

/**
 * Per-cell formatting captured from `<a:tcPr>` (fill, alignment) and the
 * first run's `<a:rPr>` (color, weight, size, family) when the PPTX
 * importer parses a table.
 *
 * The schema is intentionally flat: PowerPoint tables routinely mix
 * per-cell text colors, bold phase-header labels, and per-cell fills,
 * and the previous `string[][]` shape collapsed all of that to the
 * table's defaults. `text` is the visible content; the optional fields
 * override the table-level defaults (`textColor`, `fontSize`, etc.)
 * only when they were explicitly authored at the cell level.
 *
 * Cells provided as a bare string in `TableElement.rows` (legacy decks,
 * AI-authored decks that don't carry styling) are accepted and treated
 * as `{ text }` — no migration step required.
 */
export interface TableCell {
  text: string;
  /** Resolved hex colour for this cell's text, overrides `textColor`. */
  color?: string;
  /** Resolved hex fill for this cell, overrides any row/header/banded fill. */
  fill?: string;
  bold?: boolean;
  italic?: boolean;
  /** Font size in canvas pixels (post-fit-scaling), overrides `fontSize`. */
  fontSize?: number;
  fontFamily?: string;
  align?: "left" | "center" | "right";
  /** Horizontal cell merge (cells to the right are absorbed). */
  colSpan?: number;
  /** Vertical cell merge (cells below are absorbed). */
  rowSpan?: number;
}

export type TableRow = (string | TableCell)[];

export interface TableElement extends BaseElement {
  type: "table";
  /**
   * Each cell is either a plain string (renders with table defaults) or
   * a `TableCell` carrying per-cell overrides. Plain strings are kept as
   * the lossless representation for AI-authored / simple decks.
   */
  rows: TableRow[];
  headerFill: string;
  rowFill: string;
  textColor: string;
  fontSize: number;
  /**
   * Optional cell border colour (CSS). PPTX tables typically draw thin
   * dividers between cells; we render them as a 1px border around each
   * cell. Defaults to a faint grey when omitted.
   */
  borderColor?: string;
  /**
   * Optional alternate-row fill, applied to every other body row when
   * `bandRows` is true. Imported from `<a:tblPr bandRow="1">` paired with
   * the referenced table style's `band1H`/`band2H` definitions.
   */
  rowAltFill?: string;
  /**
   * Optional emphasised fill for the first column (`<a:tblPr firstCol="1">`).
   */
  firstColFill?: string;
  /**
   * Optional emphasised fill for the last column (`<a:tblPr lastCol="1">`).
   */
  lastColFill?: string;
  /**
   * Optional emphasised fill for the totals (last) row (`<a:tblPr lastRow="1">`).
   */
  lastRowFill?: string;
  /** Whether the first row renders with header emphasis. */
  hasHeader?: boolean;
  /** Whether banded-row alternation should be applied. */
  bandRows?: boolean;
  /** Header text colour override. */
  headerTextColor?: string;
  /** First-column text colour override. */
  firstColTextColor?: string;
}

export interface IconElement extends BaseElement {
  type: "icon";
  icon: string;
  color: string;
}

export interface EmbedElement extends BaseElement {
  type: "embed";
  url: string;
  label: string;
}

/**
 * Opaque OOXML element preserved for round-trip when reading a PPTX
 * containing constructs Slidewise does not yet model (charts, SmartArt,
 * embedded media, etc.). Position/size is editable; the inner XML is
 * re-emitted on write so the user does not lose data.
 */
export interface UnknownElement extends BaseElement {
  type: "unknown";
  /** Tag name of the wrapped OOXML node, e.g. "p:graphicFrame". */
  ooxmlTag: string;
  /** Raw OOXML serialized as a string, re-emitted verbatim on save. */
  ooxmlXml: string;
  /** Human-readable label for the editor UI, e.g. "Chart" or "SmartArt". */
  label?: string;
}

/** Discrete chart families the renderer knows how to draw. */
export type ChartKind = "bar" | "column" | "line" | "pie" | "doughnut" | "area";

/** Bar/column grouping mode. PPTX values: standard / stacked / percentStacked. */
export type ChartGrouping = "standard" | "stacked" | "percentStacked";

export interface ChartSeries {
  /** Display name from `<c:tx><c:strRef><c:strCache>` (or "<c:tx><c:v>"). */
  name: string;
  /** Per-category values, parallel to ChartElement.categories. */
  values: (number | null)[];
  /** Per-series fill colour (CSS hex). */
  color?: string;
}

/**
 * A chart imported from `<p:graphicFrame><c:chart>`. The categories + series
 * are parsed out of the chart part so the renderer can draw the chart live
 * (via a lazy-loaded ECharts import). The original OOXML is also stashed on
 * `ooxmlXml` so save round-trips preserve the source chart part verbatim —
 * we don't yet emit chart XML from in-editor edits.
 */
export interface ChartElement extends BaseElement {
  type: "chart";
  kind: ChartKind;
  grouping?: ChartGrouping;
  /** X-axis / pie-slice labels. */
  categories: string[];
  series: ChartSeries[];
  /** Whether the chart was shown with value labels in PowerPoint. */
  showDataLabels?: boolean;
  /** Chart title (when `<c:title>` carries one). */
  title?: string;
  /** Optional axis number-format string (PPTX `formatCode`, e.g. "$#,##0.0"). */
  valueFormat?: string;
  /**
   * Preserved source OOXML for the wrapping `<p:graphicFrame>`. The
   * serializer re-emits it verbatim on save so the chart's binary embedded
   * Excel and styling survive round-trips. Field is optional so charts
   * created in-app (no source XML) still serialize.
   */
  ooxmlXml?: string;
}

/**
 * A grouped collection of slide elements. Position/size describe the group's
 * own bounding box; children carry coordinates relative to the slide (NOT to
 * the group). The renderer treats the group as a single z-stacked unit and
 * the PPTX writer emits a `<p:grpSp>` containing the children's OOXML.
 *
 * NOTE: child drag-resize behaviour is unchanged in this release — selecting
 * a child still moves the child individually. Group-level drag will follow
 * in a later PR.
 */
export interface GroupElement extends BaseElement {
  type: "group";
  children: SlideElement[];
}

export type SlideElement =
  | TextElement
  | ShapeElement
  | ImageElement
  | LineElement
  | TableElement
  | IconElement
  | EmbedElement
  | ChartElement
  | GroupElement
  | UnknownElement;

export interface Slide {
  id: string;
  /**
   * Solid hex (`#RRGGBB`), CSS `linear-gradient(...)` / `radial-gradient(...)`
   * string, or `url(data:image/...)` / `url(https://...)` string. The writer
   * picks the right `<p:bg>` OOXML form by parsing. When a source PPTX is
   * attached, the source's `<p:bg>` replay wins over whatever's in this field.
   */
  background: string;
  elements: SlideElement[];
}

/**
 * A font the deck wants embedded into the saved PPTX so PowerPoint installs
 * it on open. Bytes can be a data URL (`data:font/ttf;base64,...` or any
 * `application/x-font-*` mime) or an http(s) URL the writer can fetch.
 */
export interface FontAsset {
  /** Matches `TextElement.fontFamily` / run `fontFamily`. */
  family: string;
  /** Data URL or http(s) URL. The writer copies the bytes into `ppt/fonts/`. */
  data: string;
  /** Defaults to 400 (regular). */
  weight?: number;
  italic?: boolean;
}

/**
 * A browser-renderable font file for the editor preview.
 *
 * `FontAsset.data` carries the PPTX-embedded payload (typically MTX-compressed
 * EOT) which PowerPoint can render but browsers cannot. `WebFontAsset` is the
 * accompanying TTF / OTF / WOFF / WOFF2 the host supplies so the in-editor
 * canvas renders the actual typeface instead of a system fallback. Optional —
 * when absent the renderer falls back through Google Fonts and then system.
 */
export interface WebFontAsset {
  /** Matches `TextElement.fontFamily` / run `fontFamily`. */
  family: string;
  /**
   * Same-origin URL, http(s) URL, or `data:font/*` data URL pointing at a
   * browser-renderable font file (ttf / otf / woff / woff2).
   */
  src: string;
  /** Defaults to 400 (regular). */
  weight?: number;
  italic?: boolean;
}

export interface Deck {
  /**
   * Schema version this deck conforms to. Stamped by `migrate()` and by
   * internal Deck constructors (seed, PPTX import). Hosts should not set
   * this manually — pass an external deck through `migrate()` and read the
   * version off the result.
   */
  version: number;
  title: string;
  slides: Slide[];
  /**
   * Opaque identifier the importer stamps when a deck is parsed from a real
   * PPTX. Slidewise keeps the source bytes in a module-level cache keyed by
   * this id so verbatim master / layout / theme / font / EMF preservation
   * still works after the host's state library has spread / cloned the deck
   * (which strips non-enumerable attachments). This field is enumerable so
   * it survives `structuredClone` and `JSON.parse(JSON.stringify(deck))`;
   * the cache itself is in-memory only, so cross-session round-trip still
   * needs the host to re-attach source bytes via `serializeDeck({ source })`.
   */
  sourcePptxId?: string;
  /**
   * Optional list of fonts to embed into the saved PPTX. Honoured when no
   * source PPTX is attached — when a source IS attached, chrome preservation
   * carries the source's embedded fonts through verbatim and this field is
   * ignored to avoid duplicate entries.
   */
  fonts?: FontAsset[];
  /**
   * Browser-renderable font files for the editor preview. The PPTX
   * exporter only consults `fonts` (the embedded payload); `webFonts`
   * is for the in-editor canvas. Hosts populate this when they have
   * licensed copies of the brand font in a web-friendly format.
   */
  webFonts?: WebFontAsset[];
}

export type ElementDraft<T extends SlideElement = SlideElement> = T extends SlideElement
  ? Omit<T, "id" | "z">
  : never;
