---
"@textcortex/slidewise": patch
---

fix(pptx): resolve theme colours when persisting verbatim custGeom, so brand-coloured vectors qualify for cross-process replay

The cross-process verbatim-replay fix (1.16.1) only stamped a custGeom shape's source `<p:sp>` into the deck JSON when the XML was fully self-contained — and it *excluded* anything referencing a theme colour (`<a:schemeClr>`). Brand marks are almost always filled with a theme accent (e.g. E.ON red is `schemeClr val="accent2"`), so the very shapes this was meant to fix (the bicycle) were skipped and fell back to the lossy synth path — still blank.

The importer now **resolves** `<a:schemeClr>` references to literal `<a:srgbClr>` against the slide's theme before persisting, instead of bailing. Both elements accept the same child transforms (`lumMod`, `alpha`, …) so the swap is lossless — only the colour source changes from a theme reference to a baked hex, making the fragment valid without the source theme. Shapes that still reference media (`r:embed`/`r:id`/`r:link`) or carry a colour token absent from the theme remain on the synth path.
