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
  | "connector"
  | "group"
  | "diagram"
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
  /**
   * Optional text highlight colour (CSS background behind the glyphs), from
   * OOXML `<a:rPr><a:highlight>`. PowerPoint renders this like a highlighter
   * pen — common in think-cell decks for yellow callouts.
   */
  highlight?: string;
  /**
   * Optional letter-case transform from OOXML `<a:rPr cap="…">`: `"all"`
   * (all-caps) or `"small"` (small caps). PowerPoint applies this at render
   * time without changing the stored characters, so it's often inherited from
   * a placeholder's list style rather than set on the run.
   */
  cap?: "all" | "small";
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
   * Optional box outline / corner radius for a text-bearing preset shape
   * (e.g. a roundRect "speech bubble" containing bullets). The PPTX importer
   * sets these from the shape's `<a:ln>` and `roundRect` adjust value so the
   * box renders its border and rounded corners behind the text — otherwise a
   * white-filled bordered shape with text would vanish into the slide.
   */
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  /**
   * When true the text renders on a single line without wrapping. Set by the
   * PPTX importer for `<a:bodyPr><a:spAutoFit/>` / `wrap="none"` boxes whose
   * bounds were fitted to a single line — prevents a substitute font from
   * wrapping content the original kept on one line.
   */
  noWrap?: boolean;
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
    /**
     * Optional outline for the silhouette (from the shape's `<a:ln>`). Needed
     * for outline-only shapes — e.g. a white-filled chevron with a coloured
     * border that holds text; without the stroke it would vanish on a white
     * slide.
     */
    stroke?: string;
    strokeWidth?: number;
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
  /**
   * Verbatim `<p:sp>` OOXML captured at import for a self-contained custGeom
   * (vector) shape, carried *in the deck JSON* so a serialize running in a
   * different process from the import (parse client-side → store JSON →
   * serialize server-side) can replay the exact source geometry rather than
   * re-synthesising from `path.d`. Synthesis can't express OOXML even-odd /
   * winding faithfully, so complex vectors blank when the process-global
   * source registry isn't available. Only populated for shapes whose source
   * XML has no external references (`r:embed` / `r:id` / `a:schemeClr`), so it
   * stays valid without the source archive or theme. `snapshot` is the element
   * snapshot at import; the serializer replays the XML only while the element
   * is unedited (snapshot still matches), otherwise it falls back to synthesis.
   * Host-opaque — do not author by hand.
   */
  pristineOoxml?: { xml: string; snapshot: string };
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

/** One side of a table cell border. */
export interface CellBorderSide {
  /** CSS colour of the line. */
  color: string;
  /** Line width in canvas pixels. */
  width: number;
}

/**
 * Per-side borders for a single table cell. A side set to a {@link CellBorderSide}
 * draws that line; `null` is an explicit "no line" (`<a:noFill>`); an absent
 * side means the cell didn't specify it (fall back to neighbour / default).
 */
export interface CellBorders {
  t?: CellBorderSide | null;
  r?: CellBorderSide | null;
  b?: CellBorderSide | null;
  l?: CellBorderSide | null;
}

/**
 * Span metadata for a table cell, indexed alongside `rows`. An origin cell
 * carries `colSpan`/`rowSpan` (> 1) when it merges neighbours; a cell that has
 * been merged away carries `covered: true` and is not rendered (its grid slot
 * is occupied by the spanning origin).
 */
export interface CellSpan {
  colSpan?: number;
  rowSpan?: number;
  covered?: boolean;
}

export interface TableElement extends BaseElement {
  type: "table";
  rows: string[][];
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
  /**
   * Optional per-cell fill overrides, indexed `[row][col]` parallel to `rows`.
   * A non-null entry wins over headerFill / rowFill / banding for that cell.
   * PPTX tables — especially think-cell Gantt charts — colour individual cells
   * (the bars, milestones, and header strips are cell fills); the row-class
   * fills above are only the fallback for cells left null. `"transparent"`
   * represents an explicit `<a:noFill>`.
   */
  cellFills?: (string | null)[][];
  /**
   * Optional per-cell text-colour overrides, indexed `[row][col]` parallel to
   * `rows`. Falls back to headerTextColor / firstColTextColor / textColor.
   */
  cellTextColors?: (string | null)[][];
  /**
   * Optional per-cell rich runs, indexed `[row][col]` parallel to `rows`. Set
   * when a cell carries formatting the flat `rows` string can't express —
   * highlight (think-cell yellow callouts), per-run fonts, bullet line breaks,
   * or mapped symbol glyphs (✓). When present the renderer/serializer use
   * these; cells without rich runs fall back to the plain string.
   */
  cellRuns?: (TextRun[] | null)[][];
  /**
   * Optional per-cell vertical alignment from `<a:tcPr anchor>`, indexed
   * `[row][col]`. `null` means unspecified (renderer falls back to its
   * header/body default). PPTX table cells default to top anchor; cells with
   * `anchor="ctr"`/`"b"` must centre / bottom-align their content.
   */
  cellVAligns?: (("top" | "middle" | "bottom") | null)[][];
  /**
   * Optional per-cell borders, indexed `[row][col]` parallel to `rows`. Each
   * cell names up to four sides; a side is a line (`{color,width}`), `null`
   * for an explicit `<a:noFill>` (no line), or absent when the cell doesn't
   * specify that side. PPTX tables (think-cell especially) draw only a few
   * coloured edges and leave the rest blank — modelling sides individually is
   * what stops the renderer from painting a full grey grid.
   */
  cellBorders?: (CellBorders | null)[][];
  /**
   * Optional per-cell span metadata, indexed `[row][col]` parallel to `rows`.
   * Present only when the table merges cells (`<a:tc gridSpan>`/`hMerge`/
   * `rowSpan`/`vMerge`). Lets a merged cell (e.g. a full-width band) cover the
   * columns it spans instead of stopping after one column.
   */
  cellSpans?: (CellSpan | null)[][];
  /**
   * Optional relative column widths from `<a:tblGrid><a:gridCol w>` (EMU). Used
   * proportionally as CSS grid track sizes so a narrow number column and a wide
   * label column keep their shape. Falls back to equal columns when absent.
   */
  colWidths?: number[];
  /**
   * Optional relative row heights from `<a:tr h>` (EMU). Used proportionally as
   * CSS grid track sizes — PPTX tables (think-cell Gantts especially) rely on
   * uneven row heights. Falls back to equal rows when absent.
   */
  rowHeights?: number[];
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

/**
 * Connector geometry families. Mirrors OOXML connector preset shapes:
 * `straightConnector1`, `bentConnector3`, `curvedConnector3`. A connector is
 * a first-class line that can carry arrowheads on either end and (unlike a
 * loose `LineElement`) round-trips to a `<p:cxnSp>`, so process / timeline /
 * flow arrows stay editable as connectors in PowerPoint instead of collapsing
 * to anonymous shapes.
 */
export type ConnectorKind = "straight" | "bent" | "curved";

/** Arrowhead style for a connector end. Mirrors `<a:headEnd>/<a:tailEnd>`. */
export type ArrowheadKind = "none" | "triangle" | "stealth" | "arrow" | "oval" | "diamond";

/**
 * A connector / line primitive. The bounding box (`x/y/w/h`) defines the two
 * anchor corners the connector spans; `flipH` / `flipV` pick which diagonal of
 * that box the line actually runs along (this is exactly how OOXML encodes a
 * connector's direction). Optional `startId` / `endId` bind the ends to other
 * elements on the slide so a process diagram stays connected when nodes move.
 */
export interface ConnectorElement extends BaseElement {
  type: "connector";
  kind: ConnectorKind;
  stroke: string;
  strokeWidth: number;
  dashType?: DashType;
  /** Arrowhead at the start (the connector's begin point). Defaults to none. */
  startArrow?: ArrowheadKind;
  /** Arrowhead at the end (the connector's end point). Defaults to none. */
  endArrow?: ArrowheadKind;
  /** Mirror horizontally — flips which corners of the bbox the line spans. */
  flipH?: boolean;
  /** Mirror vertically. */
  flipV?: boolean;
  /** Optional id of the element this connector starts at. */
  startId?: string;
  /** Optional id of the element this connector ends at. */
  endId?: string;
  shadow?: ShadowSpec;
  glow?: GlowSpec;
}

/**
 * Diagram families. A diagram is a *semantic* structure — an ordered set of
 * labelled nodes the renderer lays out by `kind` (boxes + arrows for a
 * process, stacked bars for a funnel, a 2×N grid for a matrix, …). Unlike a
 * hand-placed cluster of shapes + lines, it stays editable as one unit and
 * serialises to a single labelled `<p:grpSp>` of real shapes/connectors so
 * PowerPoint keeps it grouped (move/resize as a whole) rather than as
 * anonymous floating shapes.
 */
export type DiagramKind =
  | "process"
  | "timeline"
  | "funnel"
  | "matrix"
  | "cycle"
  | "list";

/** One labelled node in a {@link DiagramElement}. */
export interface DiagramNode {
  id: string;
  /** Node label. */
  text: string;
  /** Optional per-node fill (CSS hex); falls back to the diagram palette. */
  fill?: string;
  /** Optional per-node label color (CSS hex); falls back to the diagram. */
  color?: string;
}

/**
 * A first-class, editable diagram. The renderer and the PPTX writer share one
 * layout function (`layoutDiagram`) keyed off `kind`, so the on-canvas preview
 * and the saved `<p:grpSp>` match. The unlock for AI-generated process /
 * timeline / funnel / matrix / cycle visuals that round-trip as a grouped,
 * editable object instead of a flat pile of shapes.
 */
export interface DiagramElement extends BaseElement {
  type: "diagram";
  kind: DiagramKind;
  /** Ordered nodes; the layout per `kind` decides how they're arranged. */
  nodes: DiagramNode[];
  /**
   * Node fill palette (CSS hex), cycled across nodes when a node sets no
   * `fill` of its own. Defaults to a built-in accent palette.
   */
  palette?: string[];
  /** Default label color (CSS hex) for nodes that set none. */
  color?: string;
  /** Label font family for all nodes. */
  fontFamily?: string;
  /** Label font size (canvas px). */
  fontSize?: number;
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
  | ConnectorElement
  | GroupElement
  | DiagramElement
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
  /**
   * Which source slide this slide's chrome (background + layout reference)
   * should be replayed from, as a 0-based index into the attached `source`
   * PPTX's slide list (presentation order). Set this when the host clones,
   * reorders, or subsets the imported slides so output position no longer
   * matches source position — an AI generator that emits source slide 20 as
   * output slide 10, reuses a layout twice, or drops slides.
   *
   * The importer does NOT stamp this (it relies on a non-enumerable
   * per-slide attachment for the untouched parse→serialize path); hosts that
   * track the mapping should set it explicitly, since it's enumerable and
   * therefore survives `structuredClone` / `JSON` round-trips that strip the
   * attachment. When unset, the serializer falls back to positional mapping
   * (output slide i ← source slide i). See `serializeDeck`'s
   * `preserveSlideBackgrounds` / `rewriteSlideLayoutRefs`.
   */
  sourceSlideIndex?: number;
  /**
   * Which master layout a host-instantiated slide is bound to, as a layout
   * id from `Deck.layouts` (see `addSlideFromLayout`). When set, the
   * serializer points this slide's layout relationship at that source layout
   * instead of inferring one from `sourceSlideIndex`. Slides cloned from an
   * existing source slide leave this unset and resolve their layout through
   * `sourceSlideIndex` / positional fallback.
   */
  sourceLayoutId?: string;
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

/**
 * A placeholder slot on a master layout — the design intent the template
 * carries that isn't visible until a slide is instantiated from the layout.
 * Geometry is in canvas pixels (same coordinate space as `BaseElement`).
 */
export interface LayoutPlaceholder {
  /**
   * Placeholder role from OOXML `<p:ph type="…">`: title / body / ctrTitle /
   * subTitle / pic / tbl / chart / dt / ftr / sldNum / etc. `body` when the
   * source omits the type (OOXML's default).
   */
  type: string;
  /** Placeholder index from `<p:ph idx="…">`, disambiguates same-type slots. */
  idx?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Default font family resolved from the layout/master list style, if any. */
  fontFamily?: string;
  /** Default font size (canvas px) resolved from the list style, if any. */
  fontSize?: number;
  /** Default text colour (CSS hex) resolved from the list style, if any. */
  color?: string;
  /** Default horizontal alignment, if the list style fixes one. */
  align?: "left" | "center" | "right";
}

/**
 * A master slide layout exposed as an instantiable template. The importer
 * populates `Deck.layouts` from `ppt/slideLayouts/*.xml`; hosts call
 * `addSlideFromLayout(deck, layout.id, fills)` to mint a fresh slide whose
 * placeholders are ready to fill — the unlock for generating decks longer
 * than the template's hand-authored slide set without repeating a layout.
 */
export interface DeckLayout {
  /** Stable id (the layout's source part basename, e.g. "slideLayout7"). */
  id: string;
  /** Human-readable name from `<p:cSld name="…">`, when present. */
  name?: string;
  /**
   * Raw OOXML layout role from `<p:sldLayout type="…">` (e.g. `"title"`,
   * `"obj"`, `"twoObj"`, `"secHead"`, `"pic"`, `"blank"`). The design intent
   * of the layout, independent of its placeholder inventory. Absent when the
   * source omits the attribute. `summarizeLayouts` maps this to a friendlier
   * `role` label for model-facing layout menus.
   */
  type?: string;
  /** Placeholder slots this layout defines, in document order. */
  placeholders: LayoutPlaceholder[];
  /**
   * Source archive path of the layout part (e.g.
   * `ppt/slideLayouts/slideLayout7.xml`). The serializer points a
   * layout-instantiated slide's relationship at this part.
   */
  sourcePath: string;
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
   * Master layouts parsed from the source PPTX, exposed as instantiable
   * templates. Populated by `parsePptx`; consumed by `addSlideFromLayout`.
   * Absent for decks not created from a real PPTX.
   */
  layouts?: DeckLayout[];
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
