---
"@textcortex/slidewise": patch
---

fix(pptx): vector shapes no longer render blank — gradient paint servers, full-circle arcs, and embedded brand fonts

Three independent fidelity bugs that made imported brand decks render blank or fall back to system fonts:

- **Gradient fills on vector shapes rendered blank.** SVG `<path>` / `<polygon>` `fill=` cannot take a CSS `linear-gradient(...)` / `radial-gradient(...)` string, so any custGeom silhouette or triangle/diamond/star carrying a gradient fill painted nothing. The renderer now builds an SVG paint server (`<linearGradient>` / `<radialGradient>`, including `#RRGGBBAA` alpha → `stop-opacity`) and references it via `fill="url(#…)"`. Solid / `transparent` / `url()` fills are unchanged. Applies to shape paths, the polygon presets, and text backing paths.

- **Full-circle custGeom arcs (e.g. bicycle wheels) imported blank.** A 360° `<a:arcTo>` was converted to a single SVG elliptical-arc whose end point equals its start — which the SVG spec renders as nothing, so wheels/rings vanished. The importer now splits any arc sweep into ≤120° segments, so full circles render.

- **custGeom arcs downgraded to a rect on export.** `svgPathToOoxml` bailed on SVG `A` commands, collapsing the whole shape to a `prstGeom` rect (invisible on line-art). Arcs are now approximated as cubic Béziers (≤90° segments, sub-pixel error) and emitted as `<a:cubicBezTo>`, so arc-bearing vectors survive export.

- **Embedded brand fonts fell back to Calibri in the editor.** The importer populated `Deck.fonts` (the PPTX-embedded payload) but never `Deck.webFonts`, so the canvas had nothing browser-renderable to paint with. It now sniffs each embedded font's signature and, when it's a browser-loadable SFNT/WOFF (which is what PowerPoint embeds), surfaces a `WebFontAsset` so the real typeface renders. Non-renderable payloads are skipped (no regression).
