---
"@textcortex/slidewise": minor
---

Harden layout instantiation for AI deck generation (P1 / F1):

- **Layout-instantiated slides now inherit their layout's background.** A slide minted by `addSlideFromLayout` with the default `transparent` background no longer serialises an explicit `<a:noFill/>` `<p:bg>` — that empty background was overriding the layout/master/theme inheritance, so instantiated slides lost their on-brand background. They now stay `<p:bg>`-less and paint from their `sourceLayoutId` layout's chrome (matching the source-slide guarantee for cloned/reordered slides).
- **Layout-selection metadata.** `DeckLayout.type` now carries the raw OOXML `<p:sldLayout type>` role, and the new `summarizeLayouts(deck)` returns a compact, model-context-friendly layout menu (friendly `role` label, fillable `fills` keys, per-placeholder kind/category/geometry) so a host can have a model pick a layout per slide. `placeholderKey(ph)` exposes the exact `fills` key for a placeholder.
