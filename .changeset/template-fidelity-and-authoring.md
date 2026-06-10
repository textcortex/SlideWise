---
"@textcortex/slidewise": minor
---

Template-faithful serialization fixes and new authoring primitives for AI deck generation:

- **Per-slide source mapping** — `Slide.sourceSlideIndex` lets a host that clones / reorders / subsets imported slides declare which source slide each output slide replays its background and layout from, instead of mapping by output position (fixes blank/white-on-white slides on reordered decks).
- **Deep chart preservation** — preserved charts now carry their full dependency tree (embedded workbook, colors/style parts, rels, content types), so they no longer trigger a PowerPoint repair and keep "Edit Data" + custom styling.
- **Non-16:9 templates** — a source's real slide size now drives the output (4:3, 16:10, custom), preserving its masters / layouts / theme / fonts and inverting the authoring-canvas fit for emitted elements, instead of silently falling back to a generic 16:9 deck.
- **Instantiable layouts** — `parsePptx` exposes master layouts on `Deck.layouts`, and the new `addSlideFromLayout(deck, layoutId, opts)` mints a fresh slide bound to a layout with its text placeholders ready to fill.
- **Chart-option helpers** — `buildChartOption`, `defaultPaletteColor`, and `makeValueFormatter` are exported so hosts can build the exact ECharts options Slidewise renders (e.g. for server-side previews).
- **Connector primitive** — a first-class `connector` element (straight / bent / curved, arrowheads, flips) with renderer + `<p:cxnSp>` writer support.
