import type { EChartsOption } from "echarts";
import type { ChartElement } from "@/lib/types";

/**
 * Chart-option helpers shared by the in-editor renderer (`ChartView` in
 * `ElementView`) and exported from the package's public API so hosts can build
 * the exact same ECharts options for their own previews (e.g. a server-side
 * render-to-image pipeline) without re-implementing — and drifting from — the
 * package's chart translation.
 *
 * These are pure functions: no React, no DOM, no ECharts runtime import (only
 * the option-shape types), so they're safe to call in any environment.
 */

/**
 * Translate a Slidewise {@link ChartElement} into an ECharts option object.
 * Handles bar / column / line / area / pie / doughnut, including stacked +
 * percent-stacked variants. Value labels are surfaced when the source deck had
 * `<c:showVal val="1"/>` on at least one series.
 */
export function buildChartOption(el: ChartElement): EChartsOption {
  const palette = el.series.map((s, i) => s.color ?? defaultPaletteColor(i));
  const isPercent = el.grouping === "percentStacked";
  const valueFormatter = makeValueFormatter(el.valueFormat, isPercent);

  if (el.kind === "pie" || el.kind === "doughnut") {
    const data = el.categories.map((cat, i) => ({
      name: cat || `Slice ${i + 1}`,
      value: el.series[0]?.values[i] ?? 0,
    }));
    return {
      color: palette,
      title: el.title ? { text: el.title, left: "center", top: 4 } : undefined,
      tooltip: { trigger: "item", valueFormatter },
      legend: { bottom: 4 },
      series: [
        {
          type: "pie",
          radius: el.kind === "doughnut" ? ["45%", "75%"] : "70%",
          data,
          label: el.showDataLabels
            ? { formatter: (p: { value: number }) => valueFormatter(p.value) }
            : { show: false },
        },
      ],
    } as EChartsOption;
  }

  const isHorizontal = el.kind === "bar"; // "column" + everything else: vertical
  const xAxis = isHorizontal
    ? { type: "value", axisLabel: { formatter: valueFormatter } }
    : { type: "category", data: el.categories };
  const yAxis = isHorizontal
    ? { type: "category", data: el.categories }
    : { type: "value", axisLabel: { formatter: valueFormatter } };

  const stackKey =
    el.grouping === "stacked" || el.grouping === "percentStacked"
      ? "total"
      : undefined;

  const series = el.series.map((s, i) => {
    const color = s.color ?? defaultPaletteColor(i);
    const base = {
      name: s.name,
      type: el.kind === "line" ? "line" : el.kind === "area" ? "line" : "bar",
      data: s.values.map((v) => (v === null ? 0 : v)),
      // Pin the colour explicitly so ECharts can't reassign via palette
      // cycling when multiple series share the same `name` (PowerPoint
      // decks routinely do this — same label, distinct colour fills).
      itemStyle: { color },
      ...(el.kind === "area" ? { areaStyle: { color } } : {}),
      ...(el.kind === "line"
        ? { lineStyle: { color }, symbol: "circle", symbolSize: 6 }
        : {}),
      ...(stackKey ? { stack: stackKey } : {}),
      label: el.showDataLabels
        ? {
            show: true,
            position: stackKey ? "inside" : "top",
            formatter: (p: { value: number }) => valueFormatter(p.value),
            fontSize: 11,
            color: stackKey ? "#FFFFFF" : "#111111",
          }
        : { show: false },
    };
    return base;
  });

  return {
    color: palette,
    title: el.title ? { text: el.title, left: "center", top: 4 } : undefined,
    tooltip: { trigger: "axis", valueFormatter },
    legend: { bottom: 4, type: "scroll" },
    grid: { left: 56, right: 24, top: el.title ? 36 : 16, bottom: 56 },
    xAxis,
    yAxis,
    series,
  } as EChartsOption;
}

/** Office-ish accent rotation, used when a series omits an explicit fill. */
export function defaultPaletteColor(i: number): string {
  const palette = [
    "#4F81BD",
    "#C0504D",
    "#9BBB59",
    "#8064A2",
    "#4BACC6",
    "#F79646",
  ];
  return palette[i % palette.length];
}

/**
 * Build a value formatter from a PPTX number `formatCode` (e.g. `"$#,##0.0"`).
 * `percent` renders the value as a whole-number percentage (for
 * percent-stacked charts whose values are 0..1 fractions).
 */
export function makeValueFormatter(
  formatCode: string | undefined,
  percent: boolean
): (value: number) => string {
  return (value: number) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "";
    if (percent) return `${Math.round(value * 100)}%`;
    if (formatCode && formatCode.includes("$")) {
      const decimals = (formatCode.match(/0\.(0+)/)?.[1] ?? "").length;
      return `$${value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}`;
    }
    return value.toLocaleString();
  };
}
