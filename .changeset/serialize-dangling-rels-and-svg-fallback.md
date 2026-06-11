---
"@textcortex/slidewise": patch
---

fix(pptx): emit a structurally valid package on serialize

Three `serializeDeck` bugs corrupted the generated `.pptx` (missing parts /
invalid image bytes) even from clean source templates, triggering a PowerPoint
repair prompt and outright rejection by stricter consumers (Google Slides,
LibreOffice, OOXML validators):

- **Dangling `tags` relationships:** the chrome-preserve path re-pointed a
  slide's tag rel at a `slidewise_preserved_*` name, then clobbered that part by
  re-copying the source tags under their original names. The rel now resolves
  to the de-prefixed part it should always have pointed at.
- **Dangling `notesMaster` relationships:** pptxgenjs writes a notesSlide per
  slide linked to a notes master, which chrome preservation removed without a
  source replacement. The orphaned (implicit, non-body-referenced) relationship
  is now dropped.
- **SVG markup in `.png` raster fallbacks:** dual SVG images (`<a:blip>` raster
  + `<asvg:svgBlip>` vector) had the SVG source written into the `.png`
  fallback. The fallback is now a real rasterized PNG (browser) or a valid
  transparent PNG (SSR/Node); the vector `svgBlip` part is untouched.

Adds a final `reconcileDanglingRels` invariant guard — every internal
relationship target must resolve to a shipped part — that backstops both
dangling-rel shapes (repairing recoverable targets, dropping only
safe-to-remove optional ones, and leaving critical rels untouched). Also runs
`pruneDanglingContentTypes` on the source-preservation path so stale
`[Content_Types]` overrides (pptxgenjs's `slideMaster1..N`, leftover notes
overrides) can't invalidate the package either.
