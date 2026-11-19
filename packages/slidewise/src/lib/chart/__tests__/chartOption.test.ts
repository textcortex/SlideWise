import { describe, it, expect } from "vitest";
import {
  buildChartOption,
  defaultPaletteColor,
  makeValueFormatter,
} from "../../../index";
import type { ChartElement } from "@/lib/types";
import { resolveJsonDeck } from "@/lib/schema/json";

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

type AxisOpt = {
  type: string;
  data?: string[];
  min?: number;
  max?: number;
  show?: boolean;
  inverse?: boolean;
  position?: string;
};
type SeriesOpt = {
  type: string;
  stack?: string;
  yAxisIndex?: number;
  xAxisIndex?: number;
  data: Array<number | { value: number; itemStyle?: { color?: string } }>;
  label?: { show?: boolean; position?: string; formatter?: (p: unknown) => string };
};
type AxisChartOpt = { xAxis: AxisOpt | AxisOpt[]; yAxis: AxisOpt | AxisOpt[]; series: SeriesOpt[] };

const axes = (a: AxisOpt | AxisOpt[]): AxisOpt[] => (Array.isArray(a) ? a : [a]);
const dataValue = (d: SeriesOpt["data"][number]) => (typeof d === "number" ? d : d.value);

describe("chart option — stacking, axes, slices and combos", () => {
  it("stacks stacked series on one value axis and keeps a set maximum", () => {
    const opt = buildChartOption(
      chart({
        grouping: "stacked",
        showDataLabels: true,
        series: [
          { name: "Correct", values: [100, 100] },
          { name: "Speed", values: [45, 38] },
          { name: "Streak", values: [30, 10] },
        ],
        valueAxis: { max: 200 },
      })
    ) as unknown as AxisChartOpt;
    const stacks = opt.series.map((s) => s.stack);
    expect(stacks[0]).toBeTruthy();
    expect(new Set(stacks).size).toBe(1);
    expect(opt.series.every((s) => s.label?.position === "inside")).toBe(true);
    const [y] = axes(opt.yAxis);
    expect(y.type).toBe("value");
    expect(y.max).toBe(200);
    expect(y.min).toBeUndefined();
  });

  it("leaves the value axis automatic when no bounds are set", () => {
    const opt = buildChartOption(chart({ grouping: "stacked" })) as unknown as AxisChartOpt;
    const [y] = axes(opt.yAxis);
    expect(y.max).toBeUndefined();
    expect(y.min).toBeUndefined();
  });

  it("draws percent-stacked series as shares of each category total", () => {
    const opt = buildChartOption(
      chart({
        grouping: "percentStacked",
        showDataLabels: true,
        series: [
          { name: "A", values: [30, 10] },
          { name: "B", values: [70, 30] },
        ],
      })
    ) as unknown as AxisChartOpt;
    expect(opt.series[0].data.map(dataValue)).toEqual([0.3, 0.25]);
    expect(opt.series[1].data.map(dataValue)).toEqual([0.7, 0.75]);
    const [y] = axes(opt.yAxis);
    expect(y.min).toBe(0);
    expect(y.max).toBe(1);
    // Data labels show the source value, as PowerPoint does.
    expect(opt.series[0].label?.formatter?.({ dataIndex: 1, value: 0.25 })).toBe("10");
  });

  it("puts the categories on the category axis, honouring reversed and hidden axes", () => {
    const column = buildChartOption(chart()) as unknown as AxisChartOpt;
    expect(axes(column.xAxis)[0]).toMatchObject({ type: "category", data: ["Q1", "Q2"] });

    const bar = buildChartOption(
      chart({
        kind: "bar",
        categoryAxis: { reversed: true },
        valueAxis: { hidden: true },
      })
    ) as unknown as AxisChartOpt;
    const [cat] = axes(bar.yAxis);
    expect(cat).toMatchObject({ type: "category", data: ["Q1", "Q2"], inverse: true });
    expect(cat.show).not.toBe(false);
    expect(axes(bar.xAxis)[0].show).toBe(false);
  });

  it("draws combo series with their own type on a secondary value axis", () => {
    const opt = buildChartOption(
      chart({
        categories: ["Mon", "Tue"],
        series: [
          { name: "Players", values: [4, 6] },
          { name: "Score", values: [610, 720], kind: "line", secondaryAxis: true },
        ],
        secondaryValueAxis: { max: 1000 },
      })
    ) as unknown as AxisChartOpt;
    expect(opt.series.map((s) => s.type)).toEqual(["bar", "line"]);
    expect(opt.series[0].yAxisIndex ?? 0).toBe(0);
    expect(opt.series[1].yAxisIndex).toBe(1);
    const ys = axes(opt.yAxis);
    expect(ys).toHaveLength(2);
    expect(ys[1]).toMatchObject({ type: "value", max: 1000, position: "right" });
  });

  it("colours each pie slice from pointColors, else rotates the palette", () => {
    const withColors = buildChartOption(
      chart({
        kind: "doughnut",
        categories: ["A", "B", "C"],
        series: [
          {
            name: "Share",
            values: [3, 2, 1],
            color: "#111111",
            pointColors: ["#5B7CFF", "#3FBF7F", null],
          },
        ],
      })
    ) as unknown as AxisChartOpt;
    const slices = withColors.series[0].data as Array<{ itemStyle?: { color?: string } }>;
    expect(slices.map((d) => d.itemStyle?.color)).toEqual(["#5B7CFF", "#3FBF7F", "#111111"]);

    const plain = buildChartOption(
      chart({ kind: "pie", categories: ["A", "B"], series: [{ name: "S", values: [1, 2] }] })
    ) as unknown as AxisChartOpt;
    const plainSlices = plain.series[0].data as Array<{ itemStyle?: { color?: string } }>;
    expect(plainSlices.map((d) => d.itemStyle?.color)).toEqual([
      defaultPaletteColor(0),
      defaultPaletteColor(1),
    ]);
  });

  it("still loads and draws charts saved before the axis / combo fields", () => {
    // Deck JSON as saved by earlier builds: no categoryAxis / valueAxis /
    // secondaryValueAxis, no per-series kind / secondaryAxis / pointColors.
    const saved = JSON.stringify({
      version: 1,
      title: "Saved",
      slides: [
        {
          id: "s1",
          background: "#FFFFFF",
          elements: [chart({ grouping: "stacked", series: [{ name: "A", values: [1, 2], color: "#123456" }] })],
        },
      ],
    });
    const el = resolveJsonDeck(saved).slides[0].elements[0] as ChartElement;
    const opt = buildChartOption(el) as unknown as AxisChartOpt;
    expect(axes(opt.xAxis)[0]).toMatchObject({ type: "category", data: ["Q1", "Q2"] });
    expect(axes(opt.yAxis)).toHaveLength(1);
    expect(opt.series[0]).toMatchObject({ type: "bar", stack: "total", data: [1, 2] });
  });
});
