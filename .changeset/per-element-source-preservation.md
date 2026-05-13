---
"@textcortex/slidewise": patch
---

**Preserve native-typed elements (gradients, custGeom paths, brand marks, …) verbatim across saves.**

The 1.10.0 release fixed `UnknownElement` (charts, SmartArt, OLE) preservation, but native-typed elements with newer fidelity fields — CSS `radial-gradient` fills, `ShapeElement.path` custom geometries, layout-derived decoration — still ran through pptxgenjs on every save and lost everything pptxgenjs can't emit. Brand-heavy decks (gradient chapter panels, custGeom logos) degraded on the first save and stayed lost on subsequent ones.

`serializeDeck` now captures the verbatim `<p:sp>`/`<p:pic>`/`<p:cxnSp>`/`<p:graphicFrame>` XML for every imported element with explicit `<a:xfrm>`, plus a semantic snapshot. On save, each element's current fields are compared to the snapshot:

- **Unchanged** → the element is skipped in pptxgenjs's emit loop and replayed verbatim from its source XML in the post-process spTree injection. Gradient fills, custom paths, brand-style decoration survive losslessly across any number of edit-save cycles.
- **Edited** → the element falls through to pptxgenjs as before (still best-effort for fidelity, but at least the user's edit lands).

Pristine fragments inject at the *start* of `<p:spTree>` (decoration layer, low z); `UnknownElement` payloads still append at the end (chart / SmartArt content layer, high z). Per-fragment source paths resolve `r:id` references against the right archive entry (slide / layout / master), so layout-derived gradient panels and brand marks bring their referenced media along correctly.

**New API**: `serializeDeck` now accepts `{ source }` (`Blob | ArrayBuffer | Uint8Array`) so editor hosts can pass the original archive bytes through state churn (Zustand snapshots, immutable updates, localStorage rehydrate) that strips non-enumerable attachments. The website demo wires this through via a `useRef` for the loaded archive.

**End-to-end verified**:

- eon brand deck: 5/5 gradient panels + 5/5 custGeom marks preserved across two consecutive parse → serialize → re-parse cycles.
- Dickinson sample: bar chart `UnknownElement` still preserved (1 → 1); no spurious extras from layout-shape injection.

**Known limitation**: `TextElement.backingPath` / `background` (decoration fields baked from overridden layout placeholders) still don't round-trip — those fields don't have an isolated source `<p:sp>` to replay, and re-injecting the layout placeholder caused geom-resolution + stub-text issues on re-parse. Tracked as a follow-up; raw OOXML emission for text elements with decoration fields is the next step.
