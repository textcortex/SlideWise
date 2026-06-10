---
"@textcortex/slidewise": minor
---

Host deck-generation ergonomics (review follow-ups for layout instantiation):

- **`summarizeLayouts(deck, options)`** — `{ compact: true }` returns the minimal
  `{ id, name?, role, fillable }` shape (no geometry) for a tight model-context
  budget; `{ dedupe: true }` collapses layouts that share a role + fillable
  signature into one representative carrying the rest as `aliases`, so an
  85-layout template surfaces as its handful of distinct kinds. Composable.
- **Robust `sourceLayoutId` resolution** — a host-authored slide's
  `sourceLayoutId` now resolves from `deck.layouts` **or**, when the host didn't
  carry the layouts array, by the `ppt/slideLayouts/<id>.xml` id convention
  against the `{ source }` archive. When it resolves to nothing, `serializeDeck`
  emits a structured `{ code: "layout-unresolved", slideIndex, layoutId }`
  warning instead of silently falling back.
- **Richer `chrome-skipped` warning** — now carries the detected `sourceAspect`
  and `outputAspect` so a host can explain *why* chrome was dropped.

Plus README: the host "author-a-slide" contract (`{ sourceLayoutId,
background: "transparent", elements }` without a JS call), the recipe for
placing non-text slots from `summarizeLayouts` geometry, and the server-side
`layoutDiagram` render recipe with its DOM-free guarantee.
