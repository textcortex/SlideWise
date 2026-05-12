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
  | "unknown";

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
   * Optional rich-text breakdown. When present, the renderer and PPTX writer
   * use these per-run styles; the flat fields above act as defaults for any
   * field a run leaves unset. Editing the text via the contentEditable surface
   * collapses runs back to the flat representation.
   */
  runs?: TextRun[];
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
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
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
  dashed?: boolean;
}

export interface TableElement extends BaseElement {
  type: "table";
  rows: string[][];
  headerFill: string;
  rowFill: string;
  textColor: string;
  fontSize: number;
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

export type SlideElement =
  | TextElement
  | ShapeElement
  | ImageElement
  | LineElement
  | TableElement
  | IconElement
  | EmbedElement
  | UnknownElement;

export interface Slide {
  id: string;
  background: string;
  elements: SlideElement[];
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
}

export type ElementDraft<T extends SlideElement = SlideElement> = T extends SlideElement
  ? Omit<T, "id" | "z">
  : never;
