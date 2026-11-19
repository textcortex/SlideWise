import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import pptxgen from "pptxgenjs";
import { parsePptx } from "../index";
import type { ChartElement } from "@/lib/types";

/**
 * Live-chart import (`<c:chart>` → ChartElement). Source decks are built with
 * pptxgenjs, which writes the same chart XML as many generators: category
 * labels in `<c:multiLvlStrRef>`, per-slice `<c:dPt>` fills, stacked groupings
 * with explicit axis bounds, and multi-plot (combo) plot areas. Some cases
 * then rewrite the chart part to cover XML pptxgenjs never emits.
 */

type Slide = ReturnType<pptxgen["addSlide"]>;

async function buildDeck(addCharts: (pptx: pptxgen, slide: Slide) => void): Promise<JSZip> {
  const pptx = new pptxgen();
  const slide = pptx.addSlide();
  addCharts(pptx, slide);
  const buffer = (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return JSZip.loadAsync(buffer);
}

async function chartsOf(zip: JSZip): Promise<ChartElement[]> {
  const deck = await parsePptx(await zip.generateAsync({ type: "arraybuffer" }));
  return deck.slides[0].elements.filter((e): e is ChartElement => e.type === "chart");
}

/** Rewrite the (single) chart part in `zip`. */
async function editChartXml(zip: JSZip, edit: (xml: string) => string): Promise<void> {
  const path = Object.keys(zip.files).find((p) => /^ppt\/charts\/chart\d+\.xml$/.test(p));
  if (!path) throw new Error("no chart part");
  zip.file(path, edit(await zip.file(path)!.async("string")));
}

/** accent1..accent6 from the deck's theme part, as `#RRGGBB`. */
async function themeAccents(zip: JSZip): Promise<string[]> {
  const path = Object.keys(zip.files).find((p) => /^ppt\/theme\/theme\d+\.xml$/.test(p));
  const xml = await zip.file(path!)!.async("string");
  return [1, 2, 3, 4, 5, 6].map((n) => {
    const m = new RegExp(`<a:accent${n}>\\s*<a:srgbClr val="([0-9A-Fa-f]{6})"`).exec(xml);
    return `#${m![1].toUpperCase()}`;
  });
}

const upper = (colors: (string | null | undefined)[] | undefined) =>
  colors?.map((c) => (c ? c.toUpperCase() : c));

describe("pptx importer — live charts", () => {
  it("reads multi-level category labels (pptxgenjs) for bar, line and area charts", async () => {
    const zip = await buildDeck((pptx, slide) => {
      const data = [{ name: "Points", labels: ["Ali", "Zeynep", "Mehmet"], values: [1500, 1320, 1180] }];
      slide.addChart(pptx.ChartType.bar, data, { x: 0, y: 0, w: 4, h: 3, barDir: "bar" });
      slide.addChart(pptx.ChartType.line, data, { x: 4, y: 0, w: 4, h: 3 });
      slide.addChart(pptx.ChartType.area, data, { x: 0, y: 3, w: 4, h: 3 });
    });
    const charts = await chartsOf(zip);
    expect(charts.map((c) => c.kind)).toEqual(["bar", "line", "area"]);
    for (const c of charts) {
      expect(c.categories).toEqual(["Ali", "Zeynep", "Mehmet"]);
      expect(c.series[0].values).toEqual([1500, 1320, 1180]);
    }
  });

  it("keeps the stacked grouping and the value-axis bounds that are set", async () => {
    const zip = await buildDeck((pptx, slide) => {
      slide.addChart(
        pptx.ChartType.bar,
        [
          { name: "Correct", labels: ["Q1", "Q2"], values: [100, 100] },
          { name: "Speed", labels: ["Q1", "Q2"], values: [45, 38] },
          { name: "Streak", labels: ["Q1", "Q2"], values: [30, 10] },
        ],
        { x: 0, y: 0, w: 6, h: 4, barDir: "col", barGrouping: "stacked", valAxisMaxVal: 200 }
      );
    });
    const [chart] = await chartsOf(zip);
    expect(chart.kind).toBe("column");
    expect(chart.grouping).toBe("stacked");
    expect(chart.categories).toEqual(["Q1", "Q2"]);
    expect(chart.series).toHaveLength(3);
    expect(chart.valueAxis?.max).toBe(200);
    // No <c:min> in the source → the minimum stays automatic.
    expect(chart.valueAxis?.min).toBeUndefined();
  });

  it("reads the category-axis orientation and a hidden value axis", async () => {
    const zip = await buildDeck((pptx, slide) => {
      slide.addChart(
        pptx.ChartType.bar,
        [{ name: "Points", labels: ["Ali", "Zeynep"], values: [1500, 1320] }],
        {
          x: 0,
          y: 0,
          w: 6,
          h: 4,
          barDir: "bar",
          catAxisOrientation: "maxMin" as "minMax",
          valAxisHidden: true,
        }
      );
    });
    const [chart] = await chartsOf(zip);
    expect(chart.categoryAxis?.reversed).toBe(true);
    expect(chart.categoryAxis?.hidden).toBeFalsy();
    expect(chart.valueAxis?.hidden).toBe(true);
  });

  it("gives every pie / doughnut slice its own <c:dPt> fill", async () => {
    const colors = ["5B7CFF", "3FBF7F", "FFD23F", "C9D3FF"];
    const zip = await buildDeck((pptx, slide) => {
      const data = [{ name: "Answers", labels: ["A", "B", "C", "D"], values: [3, 9, 2, 1] }];
      slide.addChart(pptx.ChartType.pie, data, { x: 0, y: 0, w: 4, h: 4, chartColors: colors });
      slide.addChart(pptx.ChartType.doughnut, data, { x: 5, y: 0, w: 4, h: 4, chartColors: colors });
    });
    const charts = await chartsOf(zip);
    expect(charts.map((c) => c.kind)).toEqual(["pie", "doughnut"]);
    for (const c of charts) {
      expect(upper(c.series[0].pointColors)).toEqual(colors.map((h) => `#${h}`));
    }
  });

  it("rotates the deck's theme accents over pie slices without <c:dPt>", async () => {
    const zip = await buildDeck((pptx, slide) => {
      slide.addChart(
        pptx.ChartType.pie,
        [{ name: "Share", labels: ["A", "B", "C"], values: [1, 2, 3] }],
        { x: 0, y: 0, w: 4, h: 4 }
      );
    });
    // Drop the per-point fills and <c:varyColors> (absent = vary for pies).
    await editChartXml(zip, (xml) =>
      xml.replace(/<c:dPt>[\s\S]*?<\/c:dPt>/g, "").replace(/<c:varyColors[^>]*\/>/g, "")
    );
    const accents = await themeAccents(zip);
    const [chart] = await chartsOf(zip);
    expect(upper(chart.series[0].pointColors)).toEqual(accents.slice(0, 3));
  });

  it("paints every slice in the series colour when <c:varyColors val=\"0\"/>", async () => {
    const zip = await buildDeck((pptx, slide) => {
      slide.addChart(
        pptx.ChartType.pie,
        [{ name: "Share", labels: ["A", "B", "C"], values: [1, 2, 3] }],
        { x: 0, y: 0, w: 4, h: 4 }
      );
    });
    await editChartXml(zip, (xml) =>
      xml
        .replace(/<c:dPt>[\s\S]*?<\/c:dPt>/g, "")
        .replace(/<c:varyColors[^>]*\/>/g, '<c:varyColors val="0"/>')
    );
    const [chart] = await chartsOf(zip);
    const seriesColor = chart.series[0].color?.toUpperCase();
    expect(seriesColor).toBeTruthy();
    expect(upper(chart.series[0].pointColors)).toEqual([seriesColor, seriesColor, seriesColor]);
  });

  it("keeps every plot of a bar + line combo chart, with the secondary value axis", async () => {
    const labels = ["Mon", "Tue", "Wed"];
    const zip = await buildDeck((pptx, slide) => {
      // Multi-type charts take the chart options as the second argument.
      const options = {
        x: 0,
        y: 0,
        w: 8,
        h: 4,
        valAxes: [{ showValAxisTitle: true, valAxisTitle: "Players" }, { valAxisMaxVal: 1000 }],
        catAxes: [{ catAxisTitle: "Day" }, { catAxisHidden: true }],
      };
      slide.addChart(
        [
          {
            type: pptx.ChartType.bar,
            data: [{ name: "Players", labels, values: [4, 6, 8] }],
            options: { barDir: "col", chartColors: ["2F54EB"] },
          },
          {
            type: pptx.ChartType.line,
            data: [{ name: "Average score", labels, values: [610, 720, 800] }],
            options: { chartColors: ["FFD23F"], secondaryValAxis: true, secondaryCatAxis: true },
          },
        ],
        options as unknown as unknown[]
      );
    });
    const [chart] = await chartsOf(zip);
    expect(chart.kind).toBe("column");
    expect(chart.categories).toEqual(labels);
    expect(chart.series.map((s) => s.name)).toEqual(["Players", "Average score"]);
    // The bar series uses the chart's own kind; only the line is marked.
    expect(chart.series[0].kind).toBeUndefined();
    expect(chart.series[0].secondaryAxis).toBeFalsy();
    expect(chart.series[1].kind).toBe("line");
    expect(chart.series[1].secondaryAxis).toBe(true);
    expect(chart.series[1].values).toEqual([610, 720, 800]);
    expect(chart.series[1].color?.toUpperCase()).toBe("#FFD23F");
    expect(chart.secondaryValueAxis?.max).toBe(1000);
    expect(chart.valueAxis?.max).toBeUndefined();
  });
});
