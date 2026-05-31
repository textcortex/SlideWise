---
"@textcortex/slidewise": patch
---

fix(pptx): carry verbatim custGeom OOXML in the deck JSON so vector shapes survive cross-process serialize

The high-fidelity replay of imported elements relies on two **module-global** registries (`sourceBufferCache`, `elementSourceRegistry`) populated only by `parsePptx` and never written to the deck JSON. In a pipeline that parses in one process and serializes in another (parse client-side → store deck JSON → serialize server-side), those registries are empty, so every element is re-synthesised from its deck fields. Synthesis can't represent OOXML even-odd / winding, so complex `custGeom` vectors (e.g. a bicycle diagram) render blank even though simpler ones (the brand logo) happen to survive.

The importer now stamps the verbatim `<p:sp>` of **self-contained** custGeom shapes (no `r:embed` / `r:id` / `a:schemeClr` references) onto the element as `pristineOoxml = { xml, snapshot }`, which rides along in the deck JSON. On serialize, an unedited such shape (snapshot still matches) is replayed verbatim — exact source geometry and winding — instead of being re-synthesised; its `cNvPr/@id` is rewritten to avoid spTree collisions. Edited shapes fall back to synthesis. This is the same persist-in-JSON pattern already used for embedded fonts (`deck.fonts`), scoped to vector shapes to keep JSON bloat negligible (~a few KB per deck).
