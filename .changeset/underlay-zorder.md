---
"@textcortex/slidewise": patch
---

fix(pptx): preserve document order of layout/master underlay decorations

Layout and master visuals are rendered behind slide content as an "underlay",
but the walker emitted them grouped by tag (all `<p:sp>`, then all `<p:pic>`)
instead of in document order. PPTX z-index follows source order, so a template
that lists a full-slide background `<p:pic>` *before* a translucent gradient
`<p:sp>` drawn over it got the layers flipped: the opaque picture painted on top,
hiding the gradient and washing out the slide's title text.

`walkUnderlay` now iterates children in document order via the same
`_childOrder` annotation `parseSpTree` uses, so the background picture stays
behind its overlay. The fallback keeps the legacy tag-grouped order for
hand-built trees that lack the annotation.
