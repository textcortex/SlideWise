import { describe, it, expect } from "vitest";
import {
  buildChartOption,
  defaultPaletteColor,
  makeValueFormatter,
} from "../../../index";
import type { ChartElement } from "@/lib/types";

function chart(overrides: Partial<ChartElement> = {}): ChartElement {
  return {
    id: "c1",
    type: "chart",
    x: 0,
    y: 0,
    w: 400,
    h: 300,
    rotation: 0,
    z: 1,
    kind: "column",
    categories: ["Q1", "Q2"],
    series: [
      { name: "Revenue", values: [10, 20] },
      { name: "Cost", values: [5, 8] },
    ],
    ...overrides,
  };
}

describe("F2: exported chart-option helpers", () => {
  it("builds a column chart option with one series per data series", () => {
    const opt = buildChartOption(chart()) as {
      series: unknown[];
      xAxis: { type: string; data: string[] };
    };
    expect(opt.series).toHaveLength(2);
    expect(opt.xAxis.type).toBe("category");
    expect(opt.xAxis.data).toEqual(["Q1", "Q2"]);
  });

  it("builds a pie option as a single series of slices", () => {
    const opt = buildChartOption(
      chart({ kind: "pie", series: [{ name: "Share", values: [3, 7] }] })
    ) as { series: Array<{ type: string; data: unknown[] }> };
    expect(opt.series).toHaveLength(1);
    expect(opt.series[0].type).toBe("pie");
    expect(opt.series[0].data).toHaveLength(2);
  });

  it("honours explicit series colours and falls back to the palette", () => {
    const opt = buildChartOption(
      chart({
        series: [
          { name: "A", values: [1], color: "#123456" },
          { name: "B", values: [2] },
        ],
      })
    ) as { color: string[] };
    expect(opt.color[0]).toBe("#123456");
    expect(opt.color[1]).toBe(defaultPaletteColor(1));
  });

  it("formats percent and currency values", () => {
    expect(makeValueFormatter(undefined, true)(0.25)).toBe("25%");
    expect(makeValueFormatter("$#,##0.0", false)(1234.5)).toContain("$");
    expect(makeValueFormatter(undefined, false)(NaN)).toBe("");
  });
});
