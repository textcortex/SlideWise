---
"@textcortex/slidewise": minor
---

Round-trip fidelity fixes (P4):

- **Image `crop` / `radius`** now round-trip. Previously an image's `crop`
  (`<a:srcRect>`) was read on import but silently dropped on export, and corner
  `radius` was neither parsed nor written. `serializeDeck` now routes any image
  carrying a `crop` or `radius` through a dedicated `<p:pic>` writer (emitting
  `<a:srcRect>` and `roundRect` geometry) instead of pptxgenjs — whose
  cover/contain sizing emits its own `<a:srcRect>` and would fight a user crop —
  and `parsePptx` reads a rounded picture's corner radius back. Plain
  (uncropped, square-cornered) images keep the existing path unchanged.
- **Text-run letter-case (`cap`)** now round-trips. A run's `cap`
  (`"all"` / `"small"`, OOXML `<a:rPr cap>`) was parsed on import but dropped on
  export (pptxgenjs has no `cap` option). It's now re-applied per run in
  post-process, so all-caps / small-caps styling survives a save.
