---
"@textcortex/slidewise": patch
---

fix(pptx): import shape drop shadows so cards don't vanish on a same-colour slide

`parsePptx` never read `<a:effectLst><a:outerShdw>`, so shapes lost their drop
shadow on import. Dashboard cards are frequently white panels on a white slide,
distinguished only by a soft shadow — without it the chart card and the
metric cards beneath it disappeared into the background.

The importer now parses an explicit outer shadow into `ShadowSpec` (offset from
the OOXML distance/direction, blur, and the resolved colour with alpha) for both
plain shapes and shapes that host text (which import as card-backed text
elements). The renderer already supported `shadow`; a card-backed text box now
casts it as a `box-shadow` on the card rather than a `text-shadow` on its
glyphs. Theme `<a:effectRef>` shadow styles are not yet resolved.
