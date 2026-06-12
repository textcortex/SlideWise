---
"@textcortex/slidewise": minor
---

feat(pptx): layout-instantiation in `applyEdits` (lossless scale-with-variety)

`applyEdits` now supports `source: { layoutId, fills? }` in a `PlannedSlide` —
instantiating a fresh slide from one of the template's **own** layouts inside
the lossless byte-patch path. Because the layout is already a part of `source`,
the new slide binds to `ppt/slideLayouts/<layoutId>.xml` (inheriting theme /
master / background chrome) while every other part stays byte-identical. This
unlocks lossless **and** scale-with-variety in one deck: clone slides where you
want the exact thing, instantiate from layouts where you want variety.

Each layout placeholder is materialised as an addressable, positioned element
with a deterministic id — `layoutSlotElementId(layoutId, key)` (exported) where
`key` is the `placeholderKey` / `summarizeLayouts` slot key. Text/`obj` slots
are populated from `fills` and editable via `setText`; picture slots become a
`<p:pic>` with a transparent placeholder blip so `setImage` can repoint them;
chart/table/other slots expose their geometry so the host fills them with
`addChart` / `addDiagram`. Placeholder geometry is read EMU-native from the
layout (falling back to the matching master slot), so it stays correct without a
canvas-px round-trip. An unresolvable `layoutId` is surfaced via `onWarning` and
the slide is skipped rather than shipped wrong.
