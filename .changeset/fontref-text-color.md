---
"@textcortex/slidewise": patch
---

fix(pptx): colour uncoloured runs from the shape's `<a:fontRef>`

A run that sets no colour inherits it from the shape's `<p:style><a:fontRef>` in
PowerPoint. The importer ignored that, so such a run fell back to the default
dark colour. On cards whose fontRef is `lt1` (white) — a label meant to read
against the fill — this surfaced as stray dark text overlapping the card
(e.g. a leftover "CCC" label that should be invisible white).

`makeTextElement` now resolves the `<a:fontRef>` colour and uses it as a run
colour fallback. For a non-placeholder shape it outranks the master's generic
"otherStyle" default (the fontRef is the shape's authoritative base colour);
for a placeholder it stays the last resort, below the placeholder's own colour.
Explicit run/paragraph colours are unaffected.
