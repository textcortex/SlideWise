---
"@textcortex/slidewise": minor
---

feat(render): headless `renderDeckToImages` + `deck.fontUsage` font transparency

**Headless render-to-image (visual-QA loop).** New browser-free renderer that
draws **what the editor draws** — native charts (`buildChartOption` + ECharts
SSR), diagrams (`layoutDiagram`), text/shapes/images/backgrounds in z-order —
*not* the OOXML raster fallbacks. No Playwright/Chromium/DOM.

- `renderDeckToSvg(deck, opts?)` → one composed SVG per slide (ECharts is
  loaded on demand, so it never bloats the editor bundle).
- `renderDeckToImages(deck, opts?)` / `renderSlideToImage(deck, i, opts?)` /
  `renderPptxToImages(bytes, opts?)` → raster bytes. Rasterisation is an
  injected hook (`opts.rasterizeSvg`, e.g. `@resvg/resvg-js`); when omitted the
  default tries a dynamic `@resvg/resvg-js` import and throws a clear error if
  it isn't installed — so there's no hard native dependency.
- `opts`: `slides` (1-based subset), `dpi` (canvas scales by `dpi/96`),
  `format`, `maxWidth` (thumbnail cap). Deterministic (no animation).

Enables the host's render → fresh-eyes inspect → targeted `applyEdits` fix →
re-render cycle, rendering a final `applyEdits` output directly.

**Font transparency.** `parsePptx` now stamps `deck.fontUsage:
{ family, embedded }[]` — every font family the deck's text uses, flagged
whether the source PPTX actually **embeds** it (`<p:embeddedFontLst>` → a real
`ppt/fonts/*` part) or merely **references** it (system-fallback risk on
viewers that don't ship the brand font). Hosts use it to warn at generation
time ("missing fonts for some ppts"). It's a read-only diagnostic, distinct from
`deck.fonts` (the embeddable payloads).
