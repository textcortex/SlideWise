---
"@textcortex/slidewise": minor
---

**Edits keep their context.** Two changes that make a small edit feel like editing the real PowerPoint, not regenerating it from a stripped model.

1. **Patch-mode saves** — when an edit only touches fields the importer knows how to splice back into the source OOXML (text content, geometry), the source `<p:sp>` / `<p:pic>` / `<p:graphicFrame>` is patched in place instead of being regenerated via pptxgenjs. Everything else on that element — themed colors (`<a:schemeClr>`), brand fonts (`<a:latin>` / `<a:ea>` / `<a:cs>`), gradient and image fills, `<a:custGeom>` silhouettes, body padding, autofit hints, line styling, `<a:effectLst>` shadows — survives verbatim because it was never touched. Modelled after Univer's "edit the source doc tree, never round-trip through a lossy intermediate model" approach.

   - Text content edits: splice the new text into the source `<p:txBody>` preserving the first paragraph's `<a:pPr>` and the first run's `<a:rPr>` so themed colors / fonts / bullets / alignment carry through. Multi-line text becomes multi-paragraph; mixed-style runs still fall back to pptxgenjs (future work).
   - Geometry edits (drag / resize / rotate): splice `<a:xfrm>` (or `<p:xfrm>` for `<p:graphicFrame>`) and keep everything else verbatim. Works on `<p:sp>`, `<p:pic>`, `<p:cxnSp>`, `<p:graphicFrame>`.
   - Placeholder-inherited shapes (no explicit xfrm in source) are now registered too. Patch-mode handles them by always splicing the current geometry into the patched output, so text edits on title / body / content placeholders keep their themed styling.

   pptxgenjs remains the fallback emitter for unpatchable cases (newly added elements, font / color changes via the editor's pickers, mixed-style run restyling, shape kind changes).

2. **IndexedDB-backed source persistence** — `parsePptx` now mirrors source bytes to IndexedDB keyed by `Deck.sourcePptxId`. `serializeDeck`'s source resolution checks the in-memory cache first, then IndexedDB, then the legacy non-enumerable attachment, then the host-supplied `options.source`. This means the chrome / EMF / slide-bg preservation pipeline survives full page reloads on its own — host apps that persist the deck JSON in localStorage and rehydrate on reload no longer need to also re-attach the original bytes by hand. Falls back cleanly in SSR / Node environments where IndexedDB is undefined.

Validated on `KBC-More_sample_slides.pptx`: after `parsePptx → structuredClone + spread → serializeDeck(deck)` (no `source` passed), the saved zip retains all **2 masters, 50 layouts, and 3 themes** vs the 1/1/1 the broken 1.12.1 build produced. New regression tests in `patch-mode.test.ts` confirm a text edit on `eon-deck.pptx` slide 10 column 2 keeps the source `<a:schemeClr val="accent1"/>` fill and the `<a:schemeClr val="bg1"/>` text color, and a position drag preserves both.
