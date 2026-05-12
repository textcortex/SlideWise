---
"@textcortex/slidewise": minor
---

PPTX importer: render the deck the way authors meant it.

- Walk slide layout and slide master spTrees as a low-z underlay so brand
  bars, side gradients, tinted body boxes, numbered chips, logo pictures,
  and other template-level visuals appear behind slide content. Picture
  placeholders the slide overrides are skipped so the "Insert Picture"
  prompt panel doesn't leak through.
- Resolve `<p:bgRef>` against the theme `bgFillStyleLst` (with `phClr`
  substitution) so slide / layout / master backgrounds pick up the actual
  theme fill instead of defaulting to white. Resolve `<a:fillRef>` against
  `fillStyleLst` so `custGeom` and other un-prst shapes get their styled
  fill. Prefer `<asvg:svgBlip>` over the raster fallback when present.
  Inherit `<p:pic>` geometry from the matching layout placeholder when the
  slide's `<p:pic>` omits `xfrm`.
- Resolve theme typography: `+mj-lt` / `+mn-lt` map to the theme's major
  and minor Latin typefaces. Bake the master `<p:clrMap>` (and any slide
  `<p:clrMapOvr>`) into the theme so `bg1`/`tx1`/`bg2`/`tx2` scheme tokens
  resolve correctly. Pull placeholder defaults from
  `<a:lstStyle><a:lvl1pPr><a:defRPr>` rather than empty inline `<a:rPr>`
  stubs, and merge the layout → master → txStyles rPr chain field by
  field so each layer can contribute its own attributes.
- Honour `<a:br/>` hard line breaks and `<a:fld>` field placeholders
  (`datetime1`, `slidenum`, …) at the right position within a paragraph.
  Cross-tag document order is recovered from raw XML because
  fast-xml-parser groups children by tag name.
- Import bullets and numbered lists from per-level placeholder /
  `txStyles` defaults: `<a:buNone/>`, `<a:buChar>`, and `<a:buAutoNum>`
  (arabicPeriod / ParenR / ParenBoth, alphaLc / Uc, romanLc / Uc, …)
  render as a bullet prefix with per-level indent. Apply
  `<a:normAutofit fontScale lnSpcReduction>` so PowerPoint's authored
  shrink-to-fit survives import.
- Translate `<a:custGeom>` shapes (brand logos, hand-drawn silhouettes)
  into SVG paths with even-odd fill rule, so logos render as vector art
  instead of as a flat rectangle.
- Append a `sans-serif` generic fallback to imported font family stacks
  so brand typefaces that aren't installed locally degrade to a sans face
  instead of the browser's default serif.
