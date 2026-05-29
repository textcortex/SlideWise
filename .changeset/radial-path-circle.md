---
"@textcortex/slidewise": patch
---

fix(pptx): emit radial gradients as `path="circle"` so they render in LibreOffice/Gotenberg

Radial gradients were emitted as `<a:path path="shape">` for the CSS `ellipse`
case. OOXML's `ST_PathShadeType` has no "ellipse" value, and LibreOffice
(Gotenberg's renderer) collapses `path="shape"` radials to a flat fill — so
radial brand decorations came out flattened on server-side export. PowerPoint
itself always emits `path="circle"` (with a `fillToRect`) for radials; we now do
the same for every radial, which renders as a true radial across PowerPoint,
Keynote, and LibreOffice.
