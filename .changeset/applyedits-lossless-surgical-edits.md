---
"@textcortex/slidewise": minor
---

feat(pptx): `applyEdits` — lossless surgical-edit API

Add `applyEdits(source, plan, options?)`: a patch on the original `.pptx` bytes
rather than a full re-serialize. The create flow can now emit an `EditPlan`
(subset/reorder/repeat of template slides, each with edits) and get back a valid
package where everything not named by an edit is byte-identical to the source —
masters, layouts, theme, embedded fonts, `ppt/tags/*`, notes, embeddings, and
any untouched element. This removes the lossy round-trip that produced the
`custGeom`/SVG-fallback/dangling-rel fidelity bugs and lets hosts drop their
defensive cleanup. `serializeDeck` stays for the live editor / from-scratch decks.

Edits address elements by the same stable ids `parsePptx` returns; slides by
1-based template index. Supported ops: `setText`/`clearText` (preserve the
template box + run styling, or rebuild from supplied runs), `setChartData`
(repopulate a native chart in place — type/colours kept, caches **and** the
embedded `xlsx` workbook updated so Edit-Data still works), `setTableData`,
`setImage`, `removeElement`, `addChart`, `addDiagram`, plus per-slide
`background` and deck `title`. Removed slides and any parts that become
exclusive to them are reclaimed by a package-wide reachability sweep, then
dangling relationships and content-types are reconciled. Unresolved element ids
and unsupported layout-instantiation are surfaced via `onWarning` instead of
throwing.
