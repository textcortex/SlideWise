---
"@textcortex/slidewise": patch
---

fix(pptx): respect z-order for synthesised content (charts, custGeom shapes, connectors)

Synthesised spTree content was always inserted at the back of the slide, so an
in-app chart / custGeom "SVG" / connector with a higher z than its background
card was buried behind that card (and its shadow) and rendered invisible. Each
synth item now anchors directly on top of the pptxgenjs node it sits above
(matched by shape name), preserving the deck's z-order, and only falls to the
back when it is genuinely below every model element.
