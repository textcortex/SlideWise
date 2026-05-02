import pptxgen from "pptxgenjs";
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
  IconElement,
  EmbedElement,
} from "@/lib/types";
import { pxToInches, pxToPoints } from "./units";

/**
 * Serialize a Caracas Deck to a real PPTX blob. Round-trips well for the
 * element types Caracas natively supports (text, shape, image, line,
 * table, icon, embed). UnknownElement and entrance animations are dropped
 * with a warning — proper preservation requires bypassing pptxgenjs and
 * is out of scope for v1.
 */
export async function serializeDeck(deck: Deck): Promise<Blob> {
  const pptx = new pptxgen();
  pptx.title = deck.title || "Untitled";
  pptx.layout = "LAYOUT_WIDE"; // 13.333 × 7.5 in

  for (const slide of deck.slides) {
    addSlide(pptx, slide);
  }

  // pptxgenjs returns the requested type; outputType: "blob" → Blob.
  const result = (await pptx.write({ outputType: "blob" })) as Blob;
  return result;
}

function addSlide(pptx: pptxgen, slide: Slide): void {
  const s = pptx.addSlide();
  s.background = { color: hexNoHash(slide.background) };

  const sorted = [...slide.elements].sort((a, b) => a.z - b.z);
  for (const el of sorted) {
    try {
      addElement(s, el);
    } catch (err) {
      console.warn(
        `[caracas/pptx] failed to write element ${el.id} (${el.type}):`,
        err
      );
    }
  }
}

function addElement(s: pptxgen.Slide, el: SlideElement): void {
  switch (el.type) {
    case "text":
      addText(s, el);
      return;
    case "shape":
      addShape(s, el);
      return;
    case "image":
      addImage(s, el);
      return;
    case "line":
      addLine(s, el);
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
    case "unknown":
      // Lossy: pptxgenjs has no public API for raw OOXML injection.
      // Future work: post-process the generated zip to re-inject UnknownElement
      // XML into the appropriate slide files for true round-trip.
      return;
  }
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

function addText(s: pptxgen.Slide, el: TextElement): void {
  s.addText(el.text, {
    ...geometry(el),
    fontFace: el.fontFamily,
    fontSize: pxToPoints(el.fontSize),
    color: hexNoHash(el.color),
    bold: el.fontWeight >= 600,
    italic: el.italic,
    underline: el.underline ? { style: "sng" } : undefined,
    strike: el.strike ? "sngStrike" : undefined,
    align: el.align,
    valign: el.vAlign,
    charSpacing: el.letterSpacing
      ? Math.round(el.letterSpacing * 100)
      : undefined,
    paraSpaceBefore: 0,
    paraSpaceAfter: 0,
  });
}

const SHAPE_MAP: Record<ShapeKind, string> = {
  rect: "rect",
  rounded: "roundRect",
  circle: "ellipse",
  triangle: "triangle",
  diamond: "diamond",
  star: "star5",
};

function addShape(s: pptxgen.Slide, el: ShapeElement): void {
  const shapeName = SHAPE_MAP[el.shape] ?? "rect";
  // pptxgenjs accepts shape names as strings; the typed ShapeType enum is
  // also exposed. Pass via `as unknown as` to bypass strict enum typing.
  s.addShape(shapeName as unknown as Parameters<typeof s.addShape>[0], {
    ...geometry(el),
    fill: { color: hexNoHash(el.fill) },
    line: el.stroke
      ? {
          color: hexNoHash(el.stroke),
          width: el.strokeWidth ?? 1,
        }
      : { type: "none" },
    rectRadius:
      el.shape === "rounded" && el.radius != null
        ? clamp01(el.radius / Math.min(el.w, el.h))
        : undefined,
  });
}

function addImage(s: pptxgen.Slide, el: ImageElement): void {
  const opts: Parameters<typeof s.addImage>[0] = {
    ...geometry(el),
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

function addLine(s: pptxgen.Slide, el: LineElement): void {
  s.addShape(
    "line" as unknown as Parameters<typeof s.addShape>[0],
    {
      ...geometry(el),
      line: {
        color: hexNoHash(el.stroke),
        width: el.strokeWidth,
        dashType: el.dashed ? "dash" : "solid",
        endArrowType: el.arrow ? "triangle" : "none",
      },
    }
  );
}

function addTable(s: pptxgen.Slide, el: TableElement): void {
  if (!el.rows.length) return;
  const rows = el.rows.map((row, ri) =>
    row.map((cell) => ({
      text: cell,
      options: {
        bold: ri === 0,
        fill: { color: hexNoHash(ri === 0 ? el.headerFill : el.rowFill) },
        color: hexNoHash(el.textColor),
        fontSize: pxToPoints(el.fontSize),
        valign: "middle" as const,
      },
    }))
  );
  s.addTable(rows, {
    ...geometry(el),
    border: { type: "none", pt: 0, color: "FFFFFF" },
    fontFace: "Inter",
  });
}

function addIcon(s: pptxgen.Slide, el: IconElement): void {
  // Render the icon as a centered text box with the unicode glyph.
  const fontSize = Math.min(el.w, el.h) * 0.7;
  s.addText(el.icon, {
    ...geometry(el),
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
      fill: { color: "0E1330" },
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    }
  );
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

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
