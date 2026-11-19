import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parsePptx, serializeDeck } from "../index";
import { CURRENT_DECK_VERSION } from "@/lib/schema/migrate";
import type { ChartElement, Deck } from "@/lib/types";

/**
 * In-app charts (no source OOXML) are written by `synthesiseChart`. Whatever
 * the chart model carries — combo series, the secondary value axis, per-point
 * colours, axis bounds and orientation — must survive a save + re-import.
 */

const base = { rotation: 0, z: 1, x: 100, y: 100, w: 800, h: 400 };

async function roundTrip(elements: ChartElement[]): Promise<ChartElement[]> {
  const deck: Deck = {
    version: CURRENT_DECK_VERSION,
    title: "Charts",
    slides: [{ id: "s", background: "#FFFFFF", elements }],
  };
  const blob = await serializeDeck(deck);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const parsed = await parsePptx(await zip.generateAsync({ type: "arraybuffer" }));
  return parsed.slides[0].elements.filter((e): e is ChartElement => e.type === "chart");
}

const upper = (colors: (string | null | undefined)[] | undefined) =>
  colors?.map((c) => (c ? c.toUpperCase() : c));

describe("in-app chart round-trip", () => {
  it("keeps combo series, the secondary axis and axis settings", async () => {
    const [chart] = await roundTrip([
      {
        ...base,
        id: "combo",
        type: "chart",
        kind: "column",
        grouping: "stacked",
        categories: ["Mon", "Tue"],
        series: [
          { name: "A", values: [1, 2], color: "#2F54EB" },
          { name: "B", values: [3, 4], color: "#FFD23F" },
          { name: "Avg", values: [600, 700], color: "#FF6B6B", kind: "line", secondaryAxis: true },
        ],
        categoryAxis: { reversed: true },
        valueAxis: { min: 0, max: 10 },
        secondaryValueAxis: { max: 1000 },
      },
    ]);
    expect(chart.kind).toBe("column");
    expect(chart.grouping).toBe("stacked");
    expect(chart.categories).toEqual(["Mon", "Tue"]);
    expect(chart.series.map((s) => s.name)).toEqual(["A", "B", "Avg"]);
    expect(chart.series.map((s) => s.kind)).toEqual([undefined, undefined, "line"]);
    expect(chart.series.map((s) => !!s.secondaryAxis)).toEqual([false, false, true]);
    expect(chart.series[2].values).toEqual([600, 700]);
    expect(chart.series[2].color?.toUpperCase()).toBe("#FF6B6B");
    expect(chart.categoryAxis).toEqual({ reversed: true });
    expect(chart.valueAxis).toEqual({ min: 0, max: 10 });
    expect(chart.secondaryValueAxis).toEqual({ max: 1000 });
  });

  it("keeps per-point colours and hidden axes", async () => {
    const charts = await roundTrip([
      {
        ...base,
        id: "pie",
        type: "chart",
        kind: "pie",
        categories: ["A", "B", "C"],
        series: [
          { name: "Share", values: [1, 2, 3], pointColors: ["#5B7CFF", "#3FBF7F", "#FFD23F"] },
        ],
      },
      {
        ...base,
        id: "bars",
        type: "chart",
        kind: "bar",
        categories: ["A", "B"],
        series: [{ name: "S", values: [5, 6], color: "#2F54EB", pointColors: ["#111111", null] }],
        valueAxis: { hidden: true },
      },
    ]);
    const pie = charts.find((c) => c.kind === "pie");
    const bars = charts.find((c) => c.kind === "bar");
    expect(upper(pie?.series[0].pointColors)).toEqual(["#5B7CFF", "#3FBF7F", "#FFD23F"]);
    expect(upper(bars?.series[0].pointColors)).toEqual(["#111111", null]);
    expect(bars?.valueAxis).toEqual({ hidden: true });
  });
});
