---
"@textcortex/slidewise": patch
---

fix(pptx): preserve per-stop and solid-fill alpha from 8-digit hex colors

`parseFill` truncated `#RRGGBBAA` / `#RGBA` colors to 6 digits via `hexBare`,
dropping the alpha channel before it could reach `<a:alpha>`. Translucent
gradient stops (and flat translucent fills) were therefore serialized opaque.
`parseFill` now extracts alpha from 4- and 8-digit hex, so gradient stops carry
their `<a:alpha>` and solid shape fills map alpha to pptxgenjs `transparency`.
