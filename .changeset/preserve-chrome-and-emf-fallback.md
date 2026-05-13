---
"@textcortex/slidewise": minor
---

**Stop losing slide masters, layouts, themes, embedded fonts, slide backgrounds, and EMF-bearing slides on save.**

Three stacked regressions made client decks lose huge chunks of content after a single text edit:

- pptxgenjs regenerates its own `ppt/slideMasters/`, `ppt/slideLayouts/`, `ppt/theme/`, and never emits `ppt/fonts/`. On save the original chrome was thrown out — taking master-level backgrounds, brand bars, page numbers, footers, theme palettes, and embedded brand fonts with it. `preserveUnknowns` now copies these directories (plus `notesMasters`, `handoutMasters`, `tags`) from the source PPTX into the generated zip, splices the source's `<p:sldMasterIdLst>` / `<p:notesMasterIdLst>` / `<p:embeddedFontLst>` into `presentation.xml`, rewrites `presentation.xml.rels` and each slide's rels to point at the original layouts, updates `[Content_Types].xml`, and copies referenced master/layout media (renamed on collision with pptxgenjs's own media). Bails safely when source and output slide-size aspect ratios differ so 4:3 sources don't get their masters stretched onto a 16:9 canvas.

- pptxgenjs's `slide.background` only emits a flat-hex `<a:solidFill>`, collapsing gradient / image-fill / theme-referenced backgrounds (e.g. `<a:schemeClr val="tx1"/>` → `<a:srgbClr val="151515"/>`). A new per-slide pass copies the source slide's `<p:bg>` element verbatim into the output, rewriting r:id references for image-fill backgrounds and dropping the output's flat-hex stand-in when the source inherits from layout / master.

- EMF/WMF decode failures used to return `null` from the picture parser. Combined with upstream catches, a single un-decodable metafile could wipe every other element on the same slide (Dickinson sample slides 2, 3, 9 — title + subtitle + logo all gone after one text edit). The fallback now returns an `UnknownElement` so the source `<p:pic>` is re-injected verbatim and the EMF reference survives for PowerPoint to render natively.

Validated on `Dickinson_Sample_Slides.pptx` (9/9 slides retain content + slide 2's `<a:schemeClr val="tx1"/>` theme bg survives, vs 5/9 empty slides before) and `eon-deck.pptx` (28 layouts, 5 embedded fonts, and 3 themes preserved, vs 1/0/1 before).
