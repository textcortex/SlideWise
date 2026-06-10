import { nanoid } from "nanoid";
import type {
  Deck,
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
   * become empty, editable text boxes.
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
