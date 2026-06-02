---
"@textcortex/slidewise": patch
---

Fix several PPTX import-rendering fidelity gaps surfaced by real-world decks:

- **Picture/SVG fills on shapes** — shapes whose fill is an `<a:blipFill>` (the modern Office "icon" pattern, including dual PNG+SVG blips) now render their artwork. Previously these `custGeom` icons (globes, stars, grid textures, brand marks) imported with no fill and showed blank. The image is painted clipped to the shape's silhouette, or as a box-filling background for rect/rounded/circle shapes.
- **Empty picture placeholders** — empty picture placeholders inherited from the slide layout no longer leak onto the slide as grey "Insert Picture" prompt boxes. Picture placeholders the slide actually hosts now inherit their rounded geometry and fill from the layout/master so they render as the template intends.
- **Embedded fonts (EOT / MicroType-Express)** — embedded `.fntdata` fonts now decode to browser-valid TTFs. Two bugs were fixed: composite glyphs that carried `WE_HAVE_INSTRUCTIONS` on a non-first component produced a malformed `glyf` table, and format-12 `cmap` subtables shipped a non-zero `language` field — both caused the browser's font sanitizer (OTS) to reject the whole font and fall back to a system typeface.
- **Weight-named font families** — weight-named embedded families (e.g. "Montserrat Bold", "Montserrat Semi-Bold") are now also aliased to their base family at the matching numeric weight, so bold/semi-bold text bound to the base family renders with the real embedded face instead of a synthetic bold.
