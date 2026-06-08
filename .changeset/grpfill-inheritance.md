---
"@textcortex/slidewise": patch
---

fix(pptx): render `<a:grpFill/>` shapes by inheriting the group's fill

Decorative line-art (e.g. the swoosh graphic on a title slide) is often
authored as many `<a:custGeom>` segments inside a single `<p:grpSp>`, with every
segment declaring `<a:grpFill/>` so they share the group's one translucent
colour. `parsePptx` had no `grpFill` branch, so each segment fell through to
`transparent` and the entire graphic disappeared on import — present in the
source but invisible in the deck.

The group's resolved fill is now threaded down to descendants, and a shape with
`<a:grpFill/>` paints with it (walking up the group chain when an inner group
defines no fill of its own). Geometry was already preserved; only the paint was
being dropped.
