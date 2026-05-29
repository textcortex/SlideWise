---
"@textcortex/slidewise": patch
---

fix(pptx): preserve groups (and the custGeom / radial-gradient children inside them) on import instead of flattening

The PPTX importer flattened `<p:grpSp>` on the way in — it parsed the group's children and spliced them in as loose top-level elements, so no `GroupElement` ever reached the editor. The group structure was lost, and because the flattened children were registered with their own *child-coordinate-space* `<p:sp>` XML, they re-injected at the slide's top level with the wrong coordinates on round-trip. custGeom logos and radial-gradient panels — which in real decks almost always live inside groups — went down with the group. The schema, renderer, and export writer already supported all three; only the importer dropped them.

The importer now builds a real `GroupElement` (children keep slide-absolute coordinates, z re-stamped in document order, bounding box from the group's `<a:xfrm>` with a child-union fallback) and registers the whole `<p:grpSp>` for verbatim replay, so an unedited group round-trips byte-for-byte. `snapshotElement` now recurses into group children, so editing any descendant flips the group off verbatim-replay onto the synth path (which re-emits custGeom, gradients, and nested groups) rather than re-emitting stale source XML.

**Deferred (unchanged from before):** text/image children inside an *edited* group still round-trip lossy through the synth path, and group-level in-canvas selection/drag remains a follow-up.
