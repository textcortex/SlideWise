---
"@textcortex/slidewise": minor
---

Capture per-cell text colour, fill, bold, italic, font size, font family, and horizontal alignment on PPTX table import. The previous `TableElement.rows: string[][]` shape collapsed every cell to plain text, so tables that authored per-cell styling (Gantt timelines with "Phase 1/2/3" red bold labels, banded rows with cell-level fills) lost all of it on import. Phase 2 / Phase 3 cells rendered as white-on-white in the editor, the months header was invisible, and any subsequent edit propagated the wrong representation downstream.

**Schema:** `TableElement.rows` is now `(string | TableCell)[][]`. `TableCell` carries the per-cell overrides:

```ts
interface TableCell {
  text: string;
  color?: string;       // resolved hex, overrides the table's textColor
  fill?: string;        // resolved hex, overrides any row/header/banded fill
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;    // canvas px, post-fit-scaling
  fontFamily?: string;
  align?: "left" | "center" | "right";
  colSpan?: number;
  rowSpan?: number;
}
```

Plain-string cells (legacy decks, AI-authored decks that don't need styling) still work — the renderer + writer normalise them to `{ text }` at the call site. No schema-version bump, no migration step.

**Importer:** `parseTable` in `pptxToDeck.ts` now reads `<a:tcPr><a:solidFill>` for the cell fill and the first run's `<a:rPr>` for colour / bold / italic / size / typeface, plus `<a:pPr algn="…">` for horizontal alignment.

**Renderer:** `TableView` applies per-cell properties on top of the existing row/header/column rules. Cell-level values win; the table-level fallbacks (`headerFill`, `rowFill`, `textColor`, etc.) remain as the default for cells that don't override.

**Writer:** `addTable` in `deckToPptx.ts` emits per-cell `fill` / `color` / `bold` / `italic` / `fontSize` / `fontFace` / `align` to pptxgenjs so the export round-trips the styling.

**New exports:** `TableCell`, `TableRow` from the package root.
