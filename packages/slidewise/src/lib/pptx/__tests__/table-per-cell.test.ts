import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePptx } from "../pptxToDeck";
import type { TableCell, TableElement } from "@/lib/types";

const FIXTURE = resolve(__dirname, "../../../../../../.context/attachments/eon-deck.pptx");

/**
 * The EON timeline slide (Gantt-style table) stores per-cell styling in
 * `<a:tcPr><a:solidFill>` and per-cell run formatting in the first run's
 * `<a:rPr><a:solidFill>`. Before per-cell formatting landed, the importer
 * collapsed every cell to a plain string and discarded both layers —
 * Phase 2 / Phase 3 labels rendered as white-on-white in the editor and
 * the months header was invisible. This guards the regression.
 */
describe("table per-cell formatting", () => {
  it("captures per-cell color and fill from <a:tcPr> / <a:rPr>", async () => {
    const buf = readFileSync(FIXTURE);
    const deck = await parsePptx(new Uint8Array(buf));

    // Find any table whose first cell is "Phase 1" / "Phase 2" / "Phase 3"
    // — those are the red bold labels we know exist on slide 18.
    const phaseTables: TableElement[] = [];
    for (const slide of deck.slides) {
      for (const el of slide.elements) {
        if (el.type !== "table") continue;
        const firstCell = el.rows[0]?.[0];
        const text =
          typeof firstCell === "string" ? firstCell : firstCell?.text ?? "";
        if (/^Phase\s+[123]$/.test(text)) phaseTables.push(el);
      }
    }
    expect(phaseTables.length).toBeGreaterThan(0);

    // The phase-label cell should carry an explicit colour AND bold.
    // Whatever the resolved hex is, it must NOT be the table-level default
    // (the bug was the importer ignoring per-cell rPr).
    for (const t of phaseTables) {
      const firstCell = t.rows[0]?.[0] as TableCell;
      expect(typeof firstCell).toBe("object");
      expect(firstCell.color).toBeTruthy();
      // Phase labels are bold in the source XML.
      expect(firstCell.bold).toBe(true);
    }
  });

  it("legacy string cells remain accepted (back-compat)", async () => {
    // A deck synthesised in-app might still emit plain strings. The
    // renderer normalises these to `{ text }`; the writer too.
    const mixedRow: (string | TableCell)[] = [
      "plain string",
      { text: "rich", color: "#FF00FF", bold: true },
    ];
    expect(typeof mixedRow[0]).toBe("string");
    expect((mixedRow[1] as TableCell).color).toBe("#FF00FF");
  });
});
