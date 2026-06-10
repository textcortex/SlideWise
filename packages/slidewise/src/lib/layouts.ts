import { nanoid } from "nanoid";
import type {
  Deck,
  DeckLayout,
  Slide,
  SlideElement,
  TextElement,
  LayoutPlaceholder,
} from "@/lib/types";

/**
 * Placeholder roles that carry text. Everything else (pictures, tables,
 * charts, diagrams, and footer chrome like date / slide-number / footer) is
 * skipped when instantiating — those are filled by the host with real
 * elements, or inherited from the master.
 */
const TEXT_PLACEHOLDER_TYPES = new Set([
  "",
  "title",
  "ctrTitle",
  "subTitle",
  "body",
  "obj",
]);

export interface AddSlideFromLayoutOptions {
  /**
   * Text to drop into placeholders, keyed by placeholder `type` (e.g.
   * `"title"`), or `"type:idx"` when a layout repeats a type (e.g.
   * `"body:1"`), or the bare `idx` as a string. Placeholders without a match
   * become empty, editable text boxes. Only text placeholders are fillable —
   * see {@link placeholderKey} for the canonical key of a slot and
   * {@link summarizeLayouts} for the fillable keys a layout accepts.
   */
  fills?: Record<string, string>;
  /** Slide background; defaults to `"transparent"` so the layout/master
   *  background shows through on export. */
  background?: string;
  /** Insertion index (0-based). Appends when omitted or out of range. */
  index?: number;
}

/**
 * Create a fresh slide bound to one of the deck's master layouts and return a
 * NEW deck with that slide added — the unlock for generating decks longer than
 * the template's hand-authored slide set without repeating a layout. The slide
 * is stamped with `sourceLayoutId` so the serializer points its layout
 * relationship at the original layout part, and its text placeholders become
 * editable text elements positioned per the layout.
 *
 * Pure: `deck` is not mutated.
 *
 * @throws if `deck.layouts` is missing or has no layout with `layoutId`.
 */
export function addSlideFromLayout(
  deck: Deck,
  layoutId: string,
  options: AddSlideFromLayoutOptions = {}
): Deck {
  const layout = deck.layouts?.find((l) => l.id === layoutId);
  if (!layout) {
    const available = (deck.layouts ?? []).map((l) => l.id).join(", ") || "none";
    throw new Error(
      `addSlideFromLayout: no layout "${layoutId}" in deck.layouts (have: ${available})`
    );
  }

  const elements: SlideElement[] = [];
  let z = 1;
  for (const ph of layout.placeholders) {
    if (!TEXT_PLACEHOLDER_TYPES.has(ph.type)) continue;
    elements.push(placeholderToText(ph, fillFor(ph, options.fills), z++));
  }

  const slide: Slide = {
    id: nanoid(8),
    background: options.background ?? "transparent",
    elements,
    sourceLayoutId: layout.id,
  };

  const slides = [...deck.slides];
  const at =
    options.index != null && options.index >= 0 && options.index <= slides.length
      ? options.index
      : slides.length;
  slides.splice(at, 0, slide);
  return { ...deck, slides };
}

function fillFor(
  ph: LayoutPlaceholder,
  fills: Record<string, string> | undefined
): string {
  if (!fills) return "";
  const byTypeIdx = ph.idx != null ? fills[`${ph.type}:${ph.idx}`] : undefined;
  const byIdx = ph.idx != null ? fills[String(ph.idx)] : undefined;
  return byTypeIdx ?? fills[ph.type] ?? byIdx ?? "";
}

/**
 * The `fills` key that addresses this placeholder most specifically, matching
 * the resolution order in `fillFor`: prefer `type:idx`, then bare `type`, then
 * the bare index. This is the key a host should pass in
 * `AddSlideFromLayoutOptions.fills` to populate the slot deterministically.
 */
export function placeholderKey(ph: LayoutPlaceholder): string {
  if (ph.type && ph.idx != null) return `${ph.type}:${ph.idx}`;
  if (ph.type) return ph.type;
  if (ph.idx != null) return String(ph.idx);
  return "";
}

/** Coarse content category for a placeholder, for host-side menus. */
export type PlaceholderCategory =
  | "text"
  | "picture"
  | "table"
  | "chart"
  | "media"
  | "diagram"
  | "chrome"
  | "other";

function categoryFor(type: string): PlaceholderCategory {
  if (TEXT_PLACEHOLDER_TYPES.has(type)) return "text";
  switch (type) {
    case "pic":
    case "clipArt":
      return "picture";
    case "tbl":
      return "table";
    case "chart":
      return "chart";
    case "media":
      return "media";
    case "dgm":
      return "diagram";
    case "dt":
    case "ftr":
    case "sldNum":
      return "chrome";
    default:
      return "other";
  }
}

/**
 * Friendly purpose label per raw OOXML `<p:sldLayout type>`. The host can show
 * these in a model-facing layout menu instead of the cryptic OOXML tokens.
 */
const ROLE_BY_TYPE: Record<string, string> = {
  title: "Title slide",
  ctrTitle: "Title slide",
  secHead: "Section header",
  obj: "Title and content",
  objTx: "Content with caption",
  txAndObj: "Content with caption",
  objAndTx: "Content with caption",
  tx: "Title and text",
  twoObj: "Two content",
  twoTxTwoObj: "Comparison",
  twoObjAndTx: "Comparison",
  twoObjAndObj: "Comparison",
  objAndTwoObj: "Comparison",
  twoColTx: "Two columns of text",
  fourObj: "Four content",
  titleOnly: "Title only",
  blank: "Blank",
  pic: "Picture with caption",
  picTx: "Picture with caption",
  tbl: "Table",
  chart: "Chart",
  dgm: "Diagram",
  clipArt: "Clip art and text",
  media: "Media and text",
  vertTx: "Vertical text",
  vertTitleAndTx: "Vertical title and text",
};

/**
 * Derive a role label without a `type` attribute by inspecting which kinds of
 * placeholder the layout carries.
 */
function roleFromPlaceholders(phs: LayoutPlaceholder[]): string {
  const types = new Set(phs.map((p) => p.type));
  const hasTitle = types.has("title") || types.has("ctrTitle");
  const bodyish = phs.filter((p) =>
    ["body", "obj", "subTitle", ""].includes(p.type)
  ).length;
  if (types.has("ctrTitle") || types.has("subTitle")) return "Title slide";
  if (hasTitle && bodyish >= 2) return "Two content";
  if (hasTitle && bodyish === 1) return "Title and content";
  if (hasTitle) return "Title only";
  if (phs.length === 0) return "Blank";
  return "Content";
}

/** Compact per-placeholder summary for a host-facing layout menu. */
export interface LayoutSlotSummary {
  /** The `fills` key to address this slot (see {@link placeholderKey}). */
  key: string;
  /** OOXML placeholder role (`title`, `body`, `pic`, …). */
  type: string;
  /** Placeholder index, when the layout disambiguates same-type slots. */
  idx?: number;
  /** Coarse content category. */
  category: PlaceholderCategory;
  /**
   * Whether `addSlideFromLayout` turns this slot into an editable, fillable
   * text element. Non-fillable slots (pictures, tables, charts, footer
   * chrome) are inherited from the master or supplied by the host as real
   * elements.
   */
  fillable: boolean;
  /** Canvas-px geometry (same coordinate space as `BaseElement`). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Compact per-layout summary for a host-facing (model-facing) layout menu. */
export interface LayoutSummary {
  id: string;
  name?: string;
  /** Friendly purpose label (e.g. "Title and content", "Section header"). */
  role: string;
  /** Raw OOXML `<p:sldLayout type>`, when present. */
  type?: string;
  /** The `fills` keys this layout accepts, in document order. */
  fillable: string[];
  /** Every placeholder slot, in document order. */
  placeholders: LayoutSlotSummary[];
}

/**
 * Summarise a deck's instantiable layouts into a compact menu a host can hand
 * to a model when choosing which layout to instantiate for each slide. Returns
 * a structured shape (not a string) so the host can trim it to its
 * context-budget — e.g. drop geometry, or keep only `{id, role, fillable}` —
 * before serialising. Pair each chosen `id` + `fills` with
 * `addSlideFromLayout`.
 *
 * Returns `[]` when the deck has no layouts (not parsed from a real PPTX).
 */
export function summarizeLayouts(deck: Deck): LayoutSummary[] {
  return (deck.layouts ?? []).map(summarizeLayout);
}

function summarizeLayout(layout: DeckLayout): LayoutSummary {
  const placeholders: LayoutSlotSummary[] = layout.placeholders.map((ph) => ({
    key: placeholderKey(ph),
    type: ph.type,
    ...(ph.idx != null ? { idx: ph.idx } : {}),
    category: categoryFor(ph.type),
    fillable: TEXT_PLACEHOLDER_TYPES.has(ph.type),
    x: ph.x,
    y: ph.y,
    w: ph.w,
    h: ph.h,
  }));
  return {
    id: layout.id,
    ...(layout.name ? { name: layout.name } : {}),
    role:
      (layout.type ? ROLE_BY_TYPE[layout.type] : undefined) ??
      roleFromPlaceholders(layout.placeholders),
    ...(layout.type ? { type: layout.type } : {}),
    fillable: placeholders.filter((p) => p.fillable).map((p) => p.key),
    placeholders,
  };
}

function placeholderToText(
  ph: LayoutPlaceholder,
  text: string,
  z: number
): TextElement {
  const isTitle = ph.type === "title" || ph.type === "ctrTitle";
  return {
    id: nanoid(8),
    type: "text",
    x: ph.x,
    y: ph.y,
    w: ph.w,
    h: ph.h,
    rotation: 0,
    z,
    text,
    fontFamily: ph.fontFamily ?? "Inter",
    fontSize: ph.fontSize ?? (isTitle ? 40 : ph.type === "subTitle" ? 24 : 18),
    fontWeight: isTitle ? 600 : 400,
    italic: false,
    underline: false,
    strike: false,
    color: ph.color ?? "#000000",
    align: ph.align ?? (isTitle ? "center" : "left"),
    vAlign: "top",
    lineHeight: 1.2,
    letterSpacing: 0,
  };
}
