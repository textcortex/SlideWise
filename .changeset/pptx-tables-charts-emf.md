---
"@textcortex/slidewise": minor
---

**PPTX importer round 2: table styles, cached charts, EMF/WMF raster fallback.**

Three deferred items from PR #36 land together so real-world client decks stop dropping recognisable content on import.

- **Table styles.** The importer now reads `ppt/tableStyles.xml` once per deck and resolves a table's `<a:tblPr><a:tableStyleId>` against the referenced style. Header / first-column / last-row emphasis and banded-row fills come through; the `<a:tblPr>` flags (`firstRow`, `firstCol`, `lastRow`, `lastCol`, `bandRow`) decide which parts apply, and cell-level `<a:tcPr><a:solidFill>` still wins as an override. A file-level `<a:tblStyleLst def="…">` default is honoured when a table has no explicit style id. `TableElement` gains `rowAltFill`, `firstColFill`, `lastColFill`, `lastRowFill`, `hasHeader`, `bandRows`, plus per-region text-colour overrides; the renderer applies them in PPTX-faithful precedence order.
- **Charts: cached image + live rendering.** `<p:graphicFrame>` with a `<c:chart>` child now (1) emits an `ImageElement` when the chart part ships a cached raster preview (`ppt/charts/_rels/chartN.xml.rels` → `…/image`), or (2) parses the chart XML into a new `ChartElement` (bar / column / line / area / pie / doughnut, with stacked + percent-stacked grouping, series colours, value labels, and number-format codes) and renders it live via a lazy-loaded Apache ECharts import. The source `<p:graphicFrame>` OOXML is preserved on the chart element so save round-trips re-emit the source chart part verbatim (including its embedded `xlsx` workbook).
- **EMF / WMF decoding.** When a `<p:pic>` references EMF/WMF, the importer first looks for a raster sibling (alt blip in `<a:extLst>`, an extra rels entry on the picture, or a same-basename PNG/JPEG/SVG in the slide rels). When no sibling exists, the metafile is decoded in-browser via `emf-converter` (Canvas-based EMF/WMF replayer) and rendered as PNG — brand wordmarks shipped only as EMF (Dickinson sample slide 2 etc.) now appear instead of dropping. Headless environments without Canvas fall back to the legacy diagnostic-skip.

No public API changes; all three items improve fidelity automatically when an existing deck is re-imported.
