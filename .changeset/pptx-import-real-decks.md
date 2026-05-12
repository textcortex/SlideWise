---
"@textcortex/slidewise": minor
---

PPTX importer overhaul: render real-world decks the way authors meant them.

### Layout & master visuals

- Walk slide layout and slide master spTrees as a low-z underlay so brand bars,
  side gradients, tinted body boxes, numbered chips, logo pictures, and other
  template-level visuals appear behind slide content.
- Picture placeholders the slide overrides are skipped so the "Insert Picture"
  prompt panel doesn't leak through real images.
- Resolve `<p:bgRef>` against the theme `bgFillStyleLst` (with `phClr`
  substitution) for slide / layout / master backgrounds. Solid fills, linear
  gradients, and now `<a:blipFill>` image backgrounds all flow through.
- Resolve `<a:fillRef>` against the theme `fillStyleLst` so `custGeom` and
  other un-prst shapes pick up their styled fill instead of going transparent.
- Prefer `<asvg:svgBlip>` over the raster fallback in dual-blip pictures.
- `parsePic` inherits geometry from the matching layout / master placeholder
  when the slide's `<p:pic>` omits `xfrm`.
- Preserve `<p:spTree>` document order (recovered from raw XML, since
  fast-xml-parser groups children by tag name) so a slide whose `<p:pic>` is
  listed before its `<p:sp>` keeps the picture at the correct (lower) z.

### Theme typography & colours

- Resolve OOXML major/minor font tokens (`+mj-lt`, `+mn-lt`, `+mj-ea`, …)
  against the theme's `<a:fontScheme>`.
- Read the master's `<p:clrMap>` (with optional slide `<p:clrMapOvr>`) and
  bake `bg1`/`bg2`/`tx1`/`tx2` into the theme so scheme tokens resolve against
  the actual mapping rather than the hardcoded default.
- Pull placeholder defaults from `<a:lstStyle><a:lvl1pPr><a:defRPr>` rather
  than empty inline `<a:rPr>` stubs.
- Merge the layout → master → txStyles rPr chain field by field so a layout
  that specifies only the typeface still inherits the master's colour.
- Per-field alignment inheritance + type-only placeholder lookup so the
  slide-number / footer pick up the master's `algn="r"` even when the slide
  uses a different `idx`.
- Honour `<a:br/>` as a hard line break inside paragraphs; cross-tag order is
  recovered from raw XML.
- Honour `<a:fld>` field placeholders (datetime1, slidenum, …) at the right
  position within a paragraph, alongside runs and breaks.
- Append a `sans-serif` generic fallback to imported font family stacks so
  brand typefaces that aren't installed locally degrade to a sans face
  instead of the browser's default serif.

### Lists, autofit, padding

- Per-level bullet resolution with per-field fall-through:
  `<a:buNone/>`, `<a:buChar>`, `<a:buAutoNum>` (arabicPeriod / ParenR /
  ParenBoth, alphaLc / Uc, romanLc / Uc, …) render as a bullet prefix with a
  two-spaces-per-level indent.
- Carry inter-paragraph breaks into the `runs[]` array so multi-paragraph
  placeholders with mixed formatting still render each paragraph on its own
  line.
- Apply `<a:bodyPr><a:normAutofit fontScale lnSpcReduction>`: scale every
  run's font size and reduce paragraph line height so PowerPoint's authored
  shrink-to-fit survives import.
- `<a:bodyPr lIns/tIns/rIns/bIns>` becomes inner padding on the text element
  (with per-field inheritance through slide → layout → master), so tinted
  body boxes don't render with text flush to their edges.

### Custom geometry

- Translate `<a:custGeom>` shapes (brand logos, hand-drawn silhouettes) into
  SVG paths with even-odd fill rule.
- Track pen position across path commands and translate `<a:arcTo>` into the
  SVG `A` command (start/sweep angles → end-point + large-arc / sweep flags).
- Non-placeholder `custGeom` shapes with an empty `<p:txBody>` are kept as
  shapes (with their path attached) instead of being promoted to empty text
  elements that would drop the silhouette.
- A layout placeholder's `<a:custGeom>` carries onto the slide's hosted text
  element as a `backingPath` so brand-logo plates render in the right place
  even when the slide owns the text.

### Per-element fill overrides

- The slide's own `<p:spPr>` fill is honoured on placeholder text hosts, so
  per-element fill overrides (e.g. an "active step" chip painted accent-red
  with white text) take effect.
- Layout placeholder fill rides on `TextElement.background` (and fills the
  whole element wrapper, not just the text content) so a slide with a
  full-bleed image doesn't cover the placeholder's coloured plate.

### Gradients

- Detect `<a:gradFill><a:path>` and emit a CSS `radial-gradient(circle …)`
  using the literal `fillToRect` focus and OOXML stop positions verbatim.
- Same OOXML data renders as a vertical brand ramp on a narrow chapter-slide
  side panel and as the expected red orb fading to purple on a 16:9 full
  chapter slide.

### Tables

- Draw a faint 1px stroke between cells (right + bottom on each non-edge
  cell, plus an inset outline for the outer frame) so imported tables show
  the grid lines that PowerPoint draws.
- `TableElement.borderColor` is settable for future explicit-style overrides.

### Misc

- EMF / WMF pictures (Microsoft vector metafiles, which browsers can't render
  natively) are dropped with a diagnostic instead of surfacing a broken-image
  icon. Real EMF rendering will land in a follow-up PR alongside chart
  support.
