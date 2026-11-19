---
"@textcortex/slidewise": patch
---

fix(pptx): decode XML character references; chart import and rendering basics

**XML character references.** The importer parsed attribute values with
`processEntities` handled by the XML library, which left numeric character
references untouched: pptxgenjs writes every bullet as
`<a:buChar char="&#x2022;"/>`, which showed up as the literal text `&#x2022;`.
The parser now leaves entities alone and a single-pass `decodeXmlEntities()`
decodes `&#N;`, `&#xH;` and the five predefined entities wherever attribute
values or text are read (an escaped `&amp;#x2022;` stays literal text).

**Charts.**
- Pie / doughnut slices take their own colours (`c:varyColors`, per-point
  `c:dPt` fills, theme accent rotation) instead of one colour for every slice.
- Stacked and percent-stacked bars are drawn stacked, with the correct value
  axis (`c:min` / `c:max`; percent-stacked axes run 0–100 %).
- Category-axis labels are read for bar, line and area charts (pptxgenjs writes
  them as `c:multiLvlStrRef`), including the reversed `maxMin` orientation.
- Combo charts: several plots in one `c:plotArea` (e.g. bar + line) with a
  secondary value axis.
- New model fields: `ChartSeries.kind`, `secondaryAxis`, `pointColors`,
  `ChartElement.categoryAxis`, `valueAxis`, `secondaryValueAxis`; the chart
  writer emits them too. Percent-stacked data labels show the source values.

Tests: `xml-entities`, `chart-parsing`, `chart-roundtrip`, `chartOption`.
