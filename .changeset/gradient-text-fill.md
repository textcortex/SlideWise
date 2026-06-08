---
"@textcortex/slidewise": patch
---

fix(pptx): render gradient-filled text instead of dropping it to black

A text run can carry a gradient fill (`<a:gradFill>` inside `<a:rPr>`) — common
for multi-colour title words on dark template slides. The importer only read
`<a:solidFill>` for run colour, so a gradient run resolved to the inherited
default (typically black) and vanished on a dark slide (e.g. a "Strategy" title
or a "Presentation Template" eyebrow disappearing entirely).

- `parsePptx` now resolves a run/paragraph `<a:gradFill>` into a CSS
  `linear-gradient(...)` / `radial-gradient(...)` string, reusing the shape-fill
  gradient builder. The run's own fill (solid **or** gradient) takes priority
  over the inherited default, so a gradient word is no longer overpainted by the
  placeholder's default colour.
- The renderer paints a gradient text colour with the `background-clip: text`
  technique, at both element and run level, and re-asserts the fill colour on
  solid runs so a solid run nested in a gradient box isn't hidden by inherited
  `-webkit-text-fill-color`.
- On export, an unedited gradient run keeps its true gradient via verbatim
  source round-trip. An *edited* run takes the synth path, where pptxgenjs only
  writes a solid colour — it now degrades to a representative gradient stop
  instead of emitting the gradient string as a bogus hex colour.
