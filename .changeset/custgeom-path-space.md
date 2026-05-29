---
"@textcortex/slidewise": patch
---

fix(pptx): custGeom export — map path coords to the shape's EMU extent and drop the bogus `fill="darken"`

Two correctness issues in `svgPathToOoxml` (custGeom emission):

- **Wrong `fill="darken"` on even-odd paths.** OOXML's `<a:path fill="…">` is a *shading* hint (none / norm / lighten / darken), **not** a winding rule — custGeom has no even-odd flag at all. Emitting `fill="darken"` for `fillRule: "evenodd"` silently darkened the shape and tripped some renderers (LibreOffice) without ever producing the hole. We now leave the default `norm` shading; holes are carried by the subpath directions already encoded in `d`.

- **Path coordinate space didn't match the shape box.** `<a:path w/h>` was emitted at the source viewBox dimensions while the points stayed in that space. PowerPoint itself emits custGeom with `w/h` equal to the shape's EMU extent, and LibreOffice only maps the path onto the shape correctly when the two line up. `svgPathToOoxml` now takes the target EMU extent and rescales the points so `<a:path w/h>` matches the shape — improving cross-renderer fidelity for vectors whose viewBox differs from their box.
