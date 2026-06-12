---
"@textcortex/slidewise": patch
---

fix(render): emit a valid SVG `<image>` for image-fill backgrounds

`renderDeckToSvg` rendered a slide's image-fill background as a CSS `background`
shorthand inside an SVG `fill="…"` attribute — `fill="center / cover no-repeat
url("data:image…")"`. That is not valid SVG (a non-paint value plus nested
unescaped quotes); browsers tolerate it, but strict rasterisers
(`@resvg/resvg-js`, librsvg, batik) reject it, blocking a Chromium-free
`parsePptx → renderDeckToSvg → resvg → PNG` path.

The pptx importer stores image backgrounds as a CSS shorthand, but the
renderer's image-ref detection only inspected the *start* of the value, so the
shorthand fell through to the `fill` path. The renderer now recognises a
`url(...)` anywhere in the value and emits a real `<image>` element
(`preserveAspectRatio` = `slice` for `cover`, `meet` for `contain`). A lock-in
test asserts every rendered slide is valid SVG a strict XML parser accepts,
with an image-background slide as the regression case.
