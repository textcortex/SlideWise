---
"@textcortex/slidewise": minor
---

First-class **diagram** element (P3 / F3). A new `DiagramElement` models
process / timeline / funnel / matrix / cycle / list visuals as an ordered set
of labelled `nodes` instead of a hand-placed cluster of shapes and lines. The
renderer and the PPTX writer share one layout function (`layoutDiagram`, also
exported), so the on-canvas preview and the saved file can't drift. On export a
diagram serialises to a single labelled `<p:grpSp>` of real shapes + connectors
— so it stays grouped and editable in PowerPoint (move/resize as one unit)
rather than collapsing to anonymous floating shapes. Exposed via the
`DiagramElement` / `DiagramNode` / `DiagramKind` types and the `layoutDiagram`
helper.
