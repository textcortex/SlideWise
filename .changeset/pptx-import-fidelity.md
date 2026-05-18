---
"@textcortex/slidewise": patch
---

Improve PPTX import fidelity across master shapes, parametric presets, gradients, and bulleted lists.

**Master / slide composition**

- Honour `showMasterSp="0"` on `<p:sld>` and `<p:sldLayout>`. PowerPoint hides slide-master shapes for title slides and other layouts that opt out; we were always merging them in, so master tick-marks and corner motifs were bleeding through.
- Clip the slide canvas to its `1920×1080` rectangle. Slide-master decorations are routinely positioned outside the slide bounds (e.g. `y=-46px`, `x=-40px`) as bleed-area trim; without clipping they sat on top of the actual slide.

**Parametric preset shapes**

- Render `prst="arc"` as an SVG elliptical arc using `<a:avLst>` `adj1`/`adj2`.
- Render `prst="chevron"`, `"homePlate"`, and `"pentagon"` as polygons with the `adj`-driven notch depth.
- Render `prst="cube"` as a three-face isometric box (front + top + right sub-paths in one `<path>`).
- Render `prst="ellipse"` / `"circle"` via a backing ellipse path when the shape carries text (matches the chevron/cube/arc backing channel).
- Apply `flipH` / `flipV` to all the above by baking them into path coordinates.

**Text-bearing shapes**

- When a shape with `<p:txBody>` also has a path-based silhouette (chevron, cube, arc, ellipse, `<a:custGeom>`), attach the path as the text element's `backingPath` instead of dropping the shape. The 7-S diagram's central oval, process-bar chevrons, and 3D-cube grids now keep their visual.
- Apply each shape's inscribed `txRect` for chevron/homePlate/pentagon — text wraps inside the polygon's body rather than the bounding rectangle, so long labels no longer overflow into the arrow tip / icon column.

**Bullets and paragraphs**

- Surface per-paragraph `marL` / `indent` / `algn` / `<a:spcBef>` on the text element and render each paragraph in its own block. PPTX hanging-indent bullets (`marL > 0` with negative `indent`) now place wrapped lines under the text-after-bullet column instead of collapsing back to column 0, and `spcBef` adds the authored vertical air between items.
- Restore `<a:br/>` hard line breaks in paragraphs whose raw XML wasn't preserved (defensive fallback). Previously `"FOO" <br/> "BAR"` could collapse into `"FOOBAR"`.
- Resolve `<a:fld type="slidenum">` to the slide's 1-based index. Master/layout slidenum placeholders were rendering the literal `‹#›` design-time token.

**Stroke and fill**

- Read `<a:prstDash>` (`dot`, `dash`, `dashDot`, …) on shape strokes and emit the appropriate `border-style` or `stroke-dasharray`. Previously only line-element connectors honoured dash styles; shape strokes were always solid.
- Parse `<a:fillToRect>` attributes that use the `"0%" / "100%"` literal form (PowerPoint emits both that and the 1000ths-of-percent integer form). `Number("0%")` is `NaN`, which was collapsing radial-gradient focus points to `0% 0%`.

**Connectors**

- Apply `flipH` to `<p:cxnSp>` and `<p:sp prst="line" / "straightConnector1">`. Previously only `flipV` was honoured, so diagonal connectors in diagrams like the 7-S model drew in the wrong direction.
