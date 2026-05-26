---
"@textcortex/slidewise": minor
---

Full-fidelity PPTX export — seven additive writer extensions so AI-authored and JSON-fed decks round-trip without losing structural content. Pristine source-XML preservation is unchanged; everything below only kicks in for edited / synthesised content the previous emitter would have silently dropped.

**PR 1 — `<a:custGeom>` writer.** Shapes with `el.path` are now emitted as `<p:sp>` containing a real `<a:custGeom><a:pathLst>` reconstructed from the SVG `d` string. M, L, H, V, C, Q, Z (absolute + relative) are translated into `<a:moveTo>` / `<a:lnTo>` / `<a:cubicBezTo>` / `<a:quadBezTo>` / `<a:close>` primitives; unsupported commands (arcs, smooth shorthands) fall through to a `<a:prstGeom prst="rect">` so the writer never throws.

**PR 2 — Gradient + image fills on shapes.** Shape `fill` strings of the form `linear-gradient(...)`, `radial-gradient(...)`, and `url(data:image/...)` now serialize to `<a:gradFill>` (with `<a:lin ang>` mapped back from CSS angle, plus `<a:path path="circle">` + `<a:fillToRect>` for radials) or `<a:blipFill>` with the bytes copied into `ppt/media/` and a fresh slide-rels entry. Solid `#hex` fills are unchanged.

**PR 3 — Slide background from JSON.** When `slide.background` is a gradient / `url(...)` string and there's no source PPTX to replay from, the writer overrides pptxgenjs's flat-hex `<p:bg>` with the synthesised gradient / image fill. Source-bytes preservation continues to win when present — no double-writes.

**PR 4 — In-app chart writer (partial).** `ChartElement` instances without `ooxmlXml` now generate a `ppt/charts/chartSW_<id>.xml` part covering bar / column / line / pie / doughnut / area with `grouping` support, plus the matching `<p:graphicFrame>` in the slide, the slide-rels entry, and the `[Content_Types].xml` override. Series + categories ship in `<c:numCache>` / `<c:strCache>` so PowerPoint renders the chart on open. **Deferred:** the embedded `xlsx` workbook — PowerPoint's "Edit Data" right-click won't show editable data until that lands. Charts re-imported from the saved PPTX still parse correctly since the importer reads the caches.

**PR 5 — `GroupElement` (writer + renderer).** New element `type: "group"` with `children: SlideElement[]`. The PPTX writer emits `<p:grpSp>` with `nvGrpSpPr` + `grpSpPr` and recurses on children; the renderer draws the group as a positioned wrapper that children render inside. **Deferred:** group-level drag / selection / resize (children remain individually draggable), and group children of element types other than `shape` / `group` round-trip lossy to PPTX (the renderer still draws them; the writer drops them) — that's the next slice of work.

**PR 6 — Embedded fonts in JSON.** New optional `Deck.fonts: FontAsset[]`. When set and no source PPTX is attached, the writer copies each font's bytes (data URL or http URL) into `ppt/fonts/`, registers the `.fntdata` extension in `[Content_Types].xml`, adds font rels to `presentation.xml.rels`, and writes a `<p:embeddedFontLst>` into `presentation.xml`. When a source PPTX with its own fonts is attached, chrome preservation carries the source's fonts through verbatim and `Deck.fonts` is ignored to avoid duplicate entries.

**PR 7 — Shadow / glow / dashed lines.** New optional fields on `ShapeElement`, `TextElement`, `LineElement`:

```ts
shadow?: { color: string; blur: number; offsetX: number; offsetY: number };
glow?: { color: string; radius: number };
dashType?: "solid" | "dash" | "dot" | "dashDot" | "lgDash" | "sysDash";  // shape + line
```

The renderer applies CSS `box-shadow` / `text-shadow` / `filter: drop-shadow` and `stroke-dasharray` / `border-style` accordingly. The writer emits `<a:effectLst><a:outerShdw>` / `<a:glow>` and `<a:prstDash val>` — for shapes that go through the synth path (gradients, paths) these are woven into the synthesised XML directly; for shapes still going through pptxgenjs, the post-processor splices the effect XML in by matching the `cNvPr/@name` we stamp on output.

**API additions** (additive, non-breaking):

- `SlideElement` union now includes `GroupElement`.
- `ShapeElement`: `shadow?`, `glow?`, `dashType?` added.
- `TextElement`: `shadow?`, `glow?` added.
- `LineElement`: `shadow?`, `glow?`, `dashType?` added (`dashed?` retained).
- `Deck.fonts?: FontAsset[]` added; `FontAsset` exported.
- `ShadowSpec`, `GlowSpec`, `DashType` exported from types.

Schema version is unchanged — all additions are optional. Existing decks parse, validate, render, and round-trip without modification.

**Companion fixes:**

- **`addText` now emits `TextElement.background` as a `fill`** on the pptxgenjs text frame. Tinted body boxes, boxed-bullet cards, and any layout-derived placeholder fill that used to disappear on export (because pptxgenjs got no `fill` option) now round-trip as a coloured rect behind the text.
- **Synth shapes inject at the low-z insertion point** (right after `<p:grpSpPr/>`) instead of being appended before `</p:spTree>`. Gradient panels, custGeom backdrops, and any other synth shape now sit beneath the text/images pptxgenjs already wrote, so "text above gradient" actually renders above the gradient instead of being covered by it.
- **`[Content_Types].xml` is pruned of dangling overrides** on every export path. pptxgenjs declares `slideMaster1..N` for every slide but only writes `slideMaster1.xml`; PowerPoint enforces the manifest strictly and refuses to open the file when declared parts are missing ("PowerPoint found a problem with content"). Keynote was lenient and just warned. The new `pruneDanglingContentTypes` pass drops `<Override>` entries whose `PartName` doesn't correspond to a real entry in the zip. Fires on the no-source / no-synth path, the no-source / with-synth path, and after `preserveDeckChrome` on the source-bytes path.
