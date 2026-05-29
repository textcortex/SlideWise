# @textcortex/slidewise

## 1.15.2

### Patch Changes

- b3f083a: fix(pptx): preserve groups (and the custGeom / radial-gradient children inside them) on import instead of flattening

  The PPTX importer flattened `<p:grpSp>` on the way in — it parsed the group's children and spliced them in as loose top-level elements, so no `GroupElement` ever reached the editor. The group structure was lost, and because the flattened children were registered with their own _child-coordinate-space_ `<p:sp>` XML, they re-injected at the slide's top level with the wrong coordinates on round-trip. custGeom logos and radial-gradient panels — which in real decks almost always live inside groups — went down with the group. The schema, renderer, and export writer already supported all three; only the importer dropped them.

  The importer now builds a real `GroupElement` (children keep slide-absolute coordinates, z re-stamped in document order, bounding box from the group's `<a:xfrm>` with a child-union fallback) and registers the whole `<p:grpSp>` for verbatim replay, so an unedited group round-trips byte-for-byte. `snapshotElement` now recurses into group children, so editing any descendant flips the group off verbatim-replay onto the synth path (which re-emits custGeom, gradients, and nested groups) rather than re-emitting stale source XML.

  **Deferred (unchanged from before):** text/image children inside an _edited_ group still round-trip lossy through the synth path, and group-level in-canvas selection/drag remains a follow-up.

## 1.15.1

### Patch Changes

- d2529c3: fix(pptx): preserve per-stop and solid-fill alpha from 8-digit hex colors

  `parseFill` truncated `#RRGGBBAA` / `#RGBA` colors to 6 digits via `hexBare`,
  dropping the alpha channel before it could reach `<a:alpha>`. Translucent
  gradient stops (and flat translucent fills) were therefore serialized opaque.
  `parseFill` now extracts alpha from 4- and 8-digit hex, so gradient stops carry
  their `<a:alpha>` and solid shape fills map alpha to pptxgenjs `transparency`.

## 1.15.0

### Minor Changes

- d1744b9: Full-fidelity PPTX export — seven additive writer extensions so AI-authored and JSON-fed decks round-trip without losing structural content. Pristine source-XML preservation is unchanged; everything below only kicks in for edited / synthesised content the previous emitter would have silently dropped.

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

## 1.14.1

### Patch Changes

- a14645a: Improve PPTX import fidelity across master shapes, parametric presets, gradients, and bulleted lists.

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

## 1.14.0

### Minor Changes

- 9ceb038: Add `jsonDeck` prop and expose `resolveJsonDeck` — the AI-facing entry point for feeding model-generated decks into the editor.

  **`SlidewiseEditor` / `Slidewise.Root`**

  - New top-level `jsonDeck?: Deck | string` prop. Pass either a parsed `Deck` object or a JSON string and Slidewise will `JSON.parse` (when needed) and run the value through `migrate()` before mounting — no manual normalisation required. Takes precedence over `deck` when both are provided.
  - `deck` is now optional; one of `deck` or `jsonDeck` must be supplied. Existing callers passing only `deck` are unaffected.

  **Why**

  This is the contract LLMs target when generating slides. The exported `Deck` TypeScript type is the JSON schema: hosts can prompt their model to emit a `Deck`-shaped object (or stringified JSON) and pipe it straight into `<SlidewiseEditor jsonDeck={...} />` without writing glue.

  **New export: `resolveJsonDeck(input: Deck | string): Deck`**

  Same parse + migrate helper Slidewise uses internally. Use it to validate AI output before passing it to the editor, or when building tools that emit `Deck` JSON outside of React.

  ```tsx
  import { SlidewiseEditor, resolveJsonDeck } from "@textcortex/slidewise";

  // Pass JSON directly:
  <SlidewiseEditor jsonDeck={aiGeneratedJsonString} />;

  // Or validate first:
  const deck = resolveJsonDeck(aiGeneratedJsonString);
  <SlidewiseEditor deck={deck} />;
  ```

## 1.13.0

### Minor Changes

- a0f1511: Add `mode="preview" | "edit"` preset and granular customization props for hosts that want a viewer-only embed or a custom side-rail layout.

  **`SlidewiseEditor` / `SlidewiseFileEditor`**

  - `mode="preview"` — fully inert viewer chrome: top bar shows only the title and play button (Save / Undo / Redo / ThemeToggle / Export hidden), the side rail's "New Slide" button is hidden, the bottom tool selector is hidden, the Smart pill is hidden, and `readOnly` is set. Per-flag props still override the preset.
  - `hideAddButton` — hide the side rail's "New Slide" button.
  - `hideSlideNumbers` — hide the per-thumbnail number badge.
  - `hideSmart` — hide the leading Smart pill in the top bar title.

  **`readOnly` is now enforced at the canvas**

  Previously `readOnly` only hid chrome (Save / Undo / Redo / AddButton) but the canvas itself still allowed selection, drag, text edit, resize handles, and keyboard shortcuts. With this change, `readOnly` (and therefore `mode="preview"`) blocks every canvas-level mutation entry point: keyboard shortcuts (Delete / Backspace / Enter / Escape / Cmd-Z / Cmd-Y / Arrow nudge), pointer-down on the surface and elements, double-click to text-edit, and drag-to-create. Selection chrome (`SelectionFrame`, `FloatingToolbar`) and the grid overview's "+ New Slide" tile are also skipped.

  **`SlideRail`**

  - `hideNumbers` — hide all per-thumbnail number badges from the default arrangement.
  - `thumbnailWidth` — pixel width for each slide thumbnail (defaults to 132). Pair with the rail's `width` to build wide preview-style sidebars.

  **`SlideRail.List`**

  - `hideNumber` — same flag, exposed at the subpart for hosts using deeper compound composition.
  - `thumbnailWidth` — forwarded to the default `<Thumbnail />`.

  **`TopBar` / `TopBar.Title`**

  - `hideSmart` — hide the leading Smart pill, both on the default `<TopBar />` arrangement and the `<TopBar.Title />` subpart.

## 1.12.1

### Patch Changes

- e5c7860: **Fix: chrome / EMF / slide-bg preservation getting silently dropped after the first edit.**

  1.12.0 shipped the verbatim master / layout / theme / font / EMF / slide-bg preservation pipeline — but it never fired in practice. The pipeline relied on a non-enumerable `__slidewiseSourcePptx` attachment on the deck, which `structuredClone` (used by the store's `snap()` for history) AND every `{ ...deck, ... }` reducer spread silently strips. So the moment a user edited anything, `serializeDeck` had no source bytes to inject from and fell back to pptxgenjs's lossy emitter — exactly the regression the prior PR was supposed to fix.

  Fix: `parsePptx` now stamps the deck with an enumerable `Deck.sourcePptxId` and stashes the source bytes in a module-level cache keyed by that id. `serializeDeck` looks the bytes up by id when the caller didn't pass `options.source`. The id is a plain string field, so it survives `structuredClone`, object spread, and `JSON.parse(JSON.stringify(deck))` — any reducer-driven host (Zustand, Redux, useState, Immer) keeps the preservation pipeline alive across edits.

  The cache is in-memory only; for cross-session round-trips (page reload → rehydrate from localStorage) hosts still need to re-attach source bytes via `serializeDeck(deck, { source })`.

  New regression test in `chrome-preservation.test.ts` mirrors the broken scenario — `parsePptx` → `structuredClone` + spread → `serializeDeck()` with no explicit source — and asserts all 28 eon-deck layouts and 5 embedded fonts still make it into the saved file.

## 1.12.0

### Minor Changes

- 26c1b2d: **Stop losing slide masters, layouts, themes, embedded fonts, slide backgrounds, and EMF-bearing slides on save.**

  Three stacked regressions made client decks lose huge chunks of content after a single text edit:

  - pptxgenjs regenerates its own `ppt/slideMasters/`, `ppt/slideLayouts/`, `ppt/theme/`, and never emits `ppt/fonts/`. On save the original chrome was thrown out — taking master-level backgrounds, brand bars, page numbers, footers, theme palettes, and embedded brand fonts with it. `preserveUnknowns` now copies these directories (plus `notesMasters`, `handoutMasters`, `tags`) from the source PPTX into the generated zip, splices the source's `<p:sldMasterIdLst>` / `<p:notesMasterIdLst>` / `<p:embeddedFontLst>` into `presentation.xml`, rewrites `presentation.xml.rels` and each slide's rels to point at the original layouts, updates `[Content_Types].xml`, and copies referenced master/layout media (renamed on collision with pptxgenjs's own media). Bails safely when source and output slide-size aspect ratios differ so 4:3 sources don't get their masters stretched onto a 16:9 canvas.

  - pptxgenjs's `slide.background` only emits a flat-hex `<a:solidFill>`, collapsing gradient / image-fill / theme-referenced backgrounds (e.g. `<a:schemeClr val="tx1"/>` → `<a:srgbClr val="151515"/>`). A new per-slide pass copies the source slide's `<p:bg>` element verbatim into the output, rewriting r:id references for image-fill backgrounds and dropping the output's flat-hex stand-in when the source inherits from layout / master.

  - EMF/WMF decode failures used to return `null` from the picture parser. Combined with upstream catches, a single un-decodable metafile could wipe every other element on the same slide (Dickinson sample slides 2, 3, 9 — title + subtitle + logo all gone after one text edit). The fallback now returns an `UnknownElement` so the source `<p:pic>` is re-injected verbatim and the EMF reference survives for PowerPoint to render natively.

  Validated on `Dickinson_Sample_Slides.pptx` (9/9 slides retain content + slide 2's `<a:schemeClr val="tx1"/>` theme bg survives, vs 5/9 empty slides before) and `eon-deck.pptx` (28 layouts, 5 embedded fonts, and 3 themes preserved, vs 1/0/1 before).

## 1.11.0

### Minor Changes

- f26d777: **PPTX importer round 2: table styles, cached charts, EMF/WMF raster fallback.**

  Three deferred items from PR #36 land together so real-world client decks stop dropping recognisable content on import.

  - **Table styles.** The importer now reads `ppt/tableStyles.xml` once per deck and resolves a table's `<a:tblPr><a:tableStyleId>` against the referenced style. Header / first-column / last-row emphasis and banded-row fills come through; the `<a:tblPr>` flags (`firstRow`, `firstCol`, `lastRow`, `lastCol`, `bandRow`) decide which parts apply, and cell-level `<a:tcPr><a:solidFill>` still wins as an override. A file-level `<a:tblStyleLst def="…">` default is honoured when a table has no explicit style id. `TableElement` gains `rowAltFill`, `firstColFill`, `lastColFill`, `lastRowFill`, `hasHeader`, `bandRows`, plus per-region text-colour overrides; the renderer applies them in PPTX-faithful precedence order.
  - **Charts: cached image + live rendering.** `<p:graphicFrame>` with a `<c:chart>` child now (1) emits an `ImageElement` when the chart part ships a cached raster preview (`ppt/charts/_rels/chartN.xml.rels` → `…/image`), or (2) parses the chart XML into a new `ChartElement` (bar / column / line / area / pie / doughnut, with stacked + percent-stacked grouping, series colours, value labels, and number-format codes) and renders it live via a lazy-loaded Apache ECharts import. The source `<p:graphicFrame>` OOXML is preserved on the chart element so save round-trips re-emit the source chart part verbatim (including its embedded `xlsx` workbook).
  - **EMF / WMF decoding.** When a `<p:pic>` references EMF/WMF, the importer first looks for a raster sibling (alt blip in `<a:extLst>`, an extra rels entry on the picture, or a same-basename PNG/JPEG/SVG in the slide rels). When no sibling exists, the metafile is decoded in-browser via `emf-converter` (Canvas-based EMF/WMF replayer) and rendered as PNG — brand wordmarks shipped only as EMF (Dickinson sample slide 2 etc.) now appear instead of dropping. Headless environments without Canvas fall back to the legacy diagnostic-skip.

  No public API changes; all three items improve fidelity automatically when an existing deck is re-imported.

## 1.10.1

### Patch Changes

- 570d659: **Preserve native-typed elements (gradients, custGeom paths, brand marks, …) verbatim across saves.**

  The 1.10.0 release fixed `UnknownElement` (charts, SmartArt, OLE) preservation, but native-typed elements with newer fidelity fields — CSS `radial-gradient` fills, `ShapeElement.path` custom geometries, layout-derived decoration — still ran through pptxgenjs on every save and lost everything pptxgenjs can't emit. Brand-heavy decks (gradient chapter panels, custGeom logos) degraded on the first save and stayed lost on subsequent ones.

  `serializeDeck` now captures the verbatim `<p:sp>`/`<p:pic>`/`<p:cxnSp>`/`<p:graphicFrame>` XML for every imported element with explicit `<a:xfrm>`, plus a semantic snapshot. On save, each element's current fields are compared to the snapshot:

  - **Unchanged** → the element is skipped in pptxgenjs's emit loop and replayed verbatim from its source XML in the post-process spTree injection. Gradient fills, custom paths, brand-style decoration survive losslessly across any number of edit-save cycles.
  - **Edited** → the element falls through to pptxgenjs as before (still best-effort for fidelity, but at least the user's edit lands).

  Pristine fragments inject at the _start_ of `<p:spTree>` (decoration layer, low z); `UnknownElement` payloads still append at the end (chart / SmartArt content layer, high z). Per-fragment source paths resolve `r:id` references against the right archive entry (slide / layout / master), so layout-derived gradient panels and brand marks bring their referenced media along correctly.

  **New API**: `serializeDeck` now accepts `{ source }` (`Blob | ArrayBuffer | Uint8Array`) so editor hosts can pass the original archive bytes through state churn (Zustand snapshots, immutable updates, localStorage rehydrate) that strips non-enumerable attachments. The website demo wires this through via a `useRef` for the loaded archive.

  **End-to-end verified**:

  - eon brand deck: 5/5 gradient panels + 5/5 custGeom marks preserved across two consecutive parse → serialize → re-parse cycles.
  - Dickinson sample: bar chart `UnknownElement` still preserved (1 → 1); no spurious extras from layout-shape injection.

  **Known limitation**: `TextElement.backingPath` / `background` (decoration fields baked from overridden layout placeholders) still don't round-trip — those fields don't have an isolated source `<p:sp>` to replay, and re-injecting the layout placeholder caused geom-resolution + stub-text issues on re-parse. Tracked as a follow-up; raw OOXML emission for text elements with decoration fields is the next step.

## 1.10.0

### Minor Changes

- e78ce35: **Stop silently dropping `UnknownElement` on save.**

  Slidewise's importer wraps OOXML it can't model — charts, SmartArt, group shapes, OLE, math, complex tables — into an `UnknownElement` carrying the raw XML (`ooxmlXml`). Until this release the serializer ignored that XML and emitted nothing for unknown elements, so every parse → save cycle silently destroyed those parts of the deck.

  The serializer now post-processes the zip pptxgenjs writes and injects every preserved fragment back into the matching slide's `<p:spTree>`. Media and relationships referenced by the fragment (chart XML, image data, SmartArt parts, …) are pulled from the original archive and copied into the output, with rIds renumbered to avoid clashes and target paths uniquely prefixed (`slidewise_preserved_N_…`) to avoid colliding with media pptxgenjs allocated.

  - `parsePptx` now also accepts `Uint8Array` (in addition to `Blob` and `ArrayBuffer`) so the server-side `serialize → arrayBuffer → parsePptx` loop works without an extra allocation.
  - The original archive bytes are stashed on the returned `Deck` (non-enumerable) so `serializeDeck` can reach them later. Hosts that synthesise a `Deck` from scratch are unaffected — preservation only runs when a source archive is present _and_ the deck has `UnknownElement` content.
  - New regression test in `roundtrip.test.ts` covers the full
    parse → modify → serialize → re-parse loop on a synthetic deck with a SmartArt diagram fragment.

  For users this fixes silent data loss on every "Save" with a deck that contains charts / SmartArt / group shapes / video / audio / complex tables. The post-process is a no-op when the deck has no unknown elements, so there's no overhead for clean decks.

## 1.9.0

### Minor Changes

- 7b5924d: PPTX importer overhaul: render real-world decks the way authors meant them.

  ### Layout & master visuals

  - Walk slide layout and slide master spTrees as a low-z underlay so brand bars,
    side gradients, tinted body boxes, numbered chips, logo pictures, and other
    template-level visuals appear behind slide content.
  - Picture placeholders the slide overrides are skipped so the "Insert Picture"
    prompt panel doesn't leak through real images.
  - Resolve `<p:bgRef>` against the theme `bgFillStyleLst` (with `phClr`
    substitution) for slide / layout / master backgrounds. Solid fills, linear
    gradients, and now `<a:blipFill>` image backgrounds all flow through.
  - Resolve `<a:fillRef>` against the theme `fillStyleLst` so `custGeom` and
    other un-prst shapes pick up their styled fill instead of going transparent.
  - Prefer `<asvg:svgBlip>` over the raster fallback in dual-blip pictures.
  - `parsePic` inherits geometry from the matching layout / master placeholder
    when the slide's `<p:pic>` omits `xfrm`.
  - Preserve `<p:spTree>` document order (recovered from raw XML, since
    fast-xml-parser groups children by tag name) so a slide whose `<p:pic>` is
    listed before its `<p:sp>` keeps the picture at the correct (lower) z.

  ### Theme typography & colours

  - Resolve OOXML major/minor font tokens (`+mj-lt`, `+mn-lt`, `+mj-ea`, …)
    against the theme's `<a:fontScheme>`.
  - Read the master's `<p:clrMap>` (with optional slide `<p:clrMapOvr>`) and
    bake `bg1`/`bg2`/`tx1`/`tx2` into the theme so scheme tokens resolve against
    the actual mapping rather than the hardcoded default.
  - Pull placeholder defaults from `<a:lstStyle><a:lvl1pPr><a:defRPr>` rather
    than empty inline `<a:rPr>` stubs.
  - Merge the layout → master → txStyles rPr chain field by field so a layout
    that specifies only the typeface still inherits the master's colour.
  - Per-field alignment inheritance + type-only placeholder lookup so the
    slide-number / footer pick up the master's `algn="r"` even when the slide
    uses a different `idx`.
  - Honour `<a:br/>` as a hard line break inside paragraphs; cross-tag order is
    recovered from raw XML.
  - Honour `<a:fld>` field placeholders (datetime1, slidenum, …) at the right
    position within a paragraph, alongside runs and breaks.
  - Append a `sans-serif` generic fallback to imported font family stacks so
    brand typefaces that aren't installed locally degrade to a sans face
    instead of the browser's default serif.

  ### Lists, autofit, padding

  - Per-level bullet resolution with per-field fall-through:
    `<a:buNone/>`, `<a:buChar>`, `<a:buAutoNum>` (arabicPeriod / ParenR /
    ParenBoth, alphaLc / Uc, romanLc / Uc, …) render as a bullet prefix with a
    two-spaces-per-level indent.
  - Carry inter-paragraph breaks into the `runs[]` array so multi-paragraph
    placeholders with mixed formatting still render each paragraph on its own
    line.
  - Apply `<a:bodyPr><a:normAutofit fontScale lnSpcReduction>`: scale every
    run's font size and reduce paragraph line height so PowerPoint's authored
    shrink-to-fit survives import.
  - `<a:bodyPr lIns/tIns/rIns/bIns>` becomes inner padding on the text element
    (with per-field inheritance through slide → layout → master), so tinted
    body boxes don't render with text flush to their edges.

  ### Custom geometry

  - Translate `<a:custGeom>` shapes (brand logos, hand-drawn silhouettes) into
    SVG paths with even-odd fill rule.
  - Track pen position across path commands and translate `<a:arcTo>` into the
    SVG `A` command (start/sweep angles → end-point + large-arc / sweep flags).
  - Non-placeholder `custGeom` shapes with an empty `<p:txBody>` are kept as
    shapes (with their path attached) instead of being promoted to empty text
    elements that would drop the silhouette.
  - A layout placeholder's `<a:custGeom>` carries onto the slide's hosted text
    element as a `backingPath` so brand-logo plates render in the right place
    even when the slide owns the text.

  ### Per-element fill overrides

  - The slide's own `<p:spPr>` fill is honoured on placeholder text hosts, so
    per-element fill overrides (e.g. an "active step" chip painted accent-red
    with white text) take effect.
  - Layout placeholder fill rides on `TextElement.background` (and fills the
    whole element wrapper, not just the text content) so a slide with a
    full-bleed image doesn't cover the placeholder's coloured plate.

  ### Gradients

  - Detect `<a:gradFill><a:path>` and emit a CSS `radial-gradient(circle …)`
    using the literal `fillToRect` focus and OOXML stop positions verbatim.
  - Same OOXML data renders as a vertical brand ramp on a narrow chapter-slide
    side panel and as the expected red orb fading to purple on a 16:9 full
    chapter slide.

  ### Tables

  - Draw a faint 1px stroke between cells (right + bottom on each non-edge
    cell, plus an inset outline for the outer frame) so imported tables show
    the grid lines that PowerPoint draws.
  - `TableElement.borderColor` is settable for future explicit-style overrides.

  ### Misc

  - EMF / WMF pictures (Microsoft vector metafiles, which browsers can't render
    natively) are dropped with a diagnostic instead of surfacing a broken-image
    icon. Real EMF rendering will land in a follow-up PR alongside chart
    support.

## 1.8.0

### Minor Changes

- e61136d: **`canvas` config + host-driven slide background.** New prop on `<Slidewise.Root>` / `<SlidewiseEditor>` / `<SlidewiseFileEditor>` that lets hosts tame the viewport so a bold deck fill doesn't paint the entire workspace.

  ```tsx
  <Slidewise.Root
    canvas={{
      padding: { x: 48, y: 32 },    // breathing room around the slide
      defaultZoom: 0.7,             // initial zoom (or "fit" via fitMode)
      fitMode: "manual",
      slideRadius: 12,              // rounded slide corners
      slideShadow:
        "0 1px 2px rgba(0,0,0,0.25), 0 24px 60px rgba(0,0,0,0.45)",
      forceSlideBackground: "#ffffff",      // override every slide's bg
      // …or resolve per slide:
      resolveSlideBackground: (slide) =>
        hostTheme === "neutral" ? "#fafafa" : undefined,
    }}
    surfaces={{
      canvasFrom: "#1a1b1c",
      canvasTo: "#1a1b1c",          // backdrop around the slide
    }}
  >
  ```

  Pair with the existing `surfaces` prop (or the `--slidewise-bg-canvas-from`/`-canvas-to` CSS tokens) to control the backdrop _around_ the slide. Together they produce the centered-card aesthetic with a host-controlled backdrop.

  ### What's configurable

  | Key                      | Default               | Notes                                                                                                    |
  | ------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------- |
  | `padding`                | `{ x: 32, y: 148 }`   | Pass a number for uniform padding. Used in the auto-fit calc and as visible whitespace around the slide. |
  | `fitMode`                | unchanged store value | `"fit"` / `"fill"` / `"manual"`. Applied once on mount.                                                  |
  | `defaultZoom`            | unchanged store value | Initial absolute zoom (1 = 100%). Clamped to [0.1, 4].                                                   |
  | `slideRadius`            | `8`                   | Slide paper border-radius.                                                                               |
  | `slideShadow`            | `var(--slide-shadow)` | Slide paper box-shadow.                                                                                  |
  | `forceSlideBackground`   | —                     | Hard override of `slide.background`.                                                                     |
  | `resolveSlideBackground` | —                     | Per-slide function; returning `undefined` falls through to `slide.background`.                           |

  `forceSlideBackground` takes precedence over `resolveSlideBackground` when both are passed.

  ### New exports

  ```ts
  import {
    type SlidewiseCanvasConfig,
    type ResolvedCanvasConfig,
    DEFAULT_CANVAS_CONFIG,
    useCanvasConfig,
    resolveSlideBackground,
  } from "@textcortex/slidewise";
  ```

  `useCanvasConfig()` reads the merged config from anywhere inside `<Slidewise.Root>`; `resolveSlideBackground(config, slide)` is the shared helper that the internal Canvas + SlideView (rail thumbnails, grid view) use to honor the config consistently.

## 1.7.0

### Minor Changes

- 7c2456c: **SlideRail compound primitives.** Decompose the slide rail into named subparts so hosts can inject per-row UI (context menus, status badges, duplicate buttons), reorder elements, or replace the header / add-button without forking.

  ```tsx
  <Slidewise.SlideRail.Root>
    <Slidewise.SlideRail.Header />
    <Slidewise.SlideRail.List>
      {(slide, index) => (
        <Slidewise.SlideRail.Item slide={slide}>
          <Slidewise.SlideRail.Thumbnail />
          <Slidewise.SlideRail.Number />
          <MyContextMenu slide={slide} />
        </Slidewise.SlideRail.Item>
      )}
    </Slidewise.SlideRail.List>
    <Slidewise.SlideRail.AddButton />
  </Slidewise.SlideRail.Root>
  ```

  `<Slidewise.SlideRail>` keeps working as the default arrangement, now with a `hideHeader` / `hideAddButton` prop pair for the most-common tweak. Read more in the README.

  ### Subparts shipped

  - `SlideRail.Root` — container + width/surface styling
  - `SlideRail.Header` — default has grid-view button + counter; pass `children` to replace
  - `SlideRail.List` — iterates `deck.slides`; optional render-prop for custom row layout
  - `SlideRail.Item` — wires click → `selectSlide`, provides slide via `useSlideRailItem()` context
  - `SlideRail.Thumbnail` — slide preview, reads slide from context
  - `SlideRail.Number` — slide index badge with a `format(index)` override
  - `SlideRail.AddButton` — wires to `addSlide()`, hidden in read-only mode

  ### New exports

  ```ts
  import {
    SlideRail,
    useSlideRailItem,
    type SlideRailItemContextValue,
    // plus all subpart prop types
  } from "@textcortex/slidewise";
  ```

  The internal `components/editor/SlideRail.tsx` is removed; the compound subparts own the rendering now. Existing v1.x consumers using `<SlidewiseEditor>` or `<Slidewise.SlideRail />` directly see no behavior change.

## 1.6.0

### Minor Changes

- c509102: **Animation control.** Hosts can now retune the editor's motion or disable it entirely without forking.

  ### New props on `<Slidewise.Root>` / `<SlidewiseEditor>` / `<SlidewiseFileEditor>`

  ```ts
  reduceMotion?: boolean | "system";   // default "system"
  transition?: Transition;             // framer-motion type
  ```

  - `reduceMotion="system"` (default) — respects the OS `prefers-reduced-motion` preference.
  - `reduceMotion={true}` — force all CSS animations + transitions off; framer-motion's `MotionConfig` reports `reducedMotion="always"`.
  - `reduceMotion={false}` — force motion on even when the OS reports reduced-motion (for testing).
  - `transition` — passed through to a wrapping `<MotionConfig>`, so every motion component inside the editor inherits it.

  ### New CSS tokens

  Override in the `style` prop on `<Slidewise.Root>` or a wrapping stylesheet:

  ```css
  /* Durations */
  --slidewise-duration-instant: 0ms;
  --slidewise-duration-fast: 120ms;
  --slidewise-duration-base: 200ms;
  --slidewise-duration-slow: 320ms;

  /* Easings */
  --slidewise-easing-standard: cubic-bezier(0.2, 0, 0, 1);
  --slidewise-easing-emphasized: cubic-bezier(0.05, 0.7, 0.1, 1);
  --slidewise-easing-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Per-region enable flags (multiply with durations to disable a region) */
  --slidewise-anim-topbar: 1;
  --slidewise-anim-rail: 1;
  --slidewise-anim-canvas: 1;
  --slidewise-anim-floating-toolbar: 1;
  --slidewise-anim-play-mode: 1;
  ```

  The library's internal CSS will incrementally adopt these tokens; today they're available for hosts to consume in their own subclasses + injected content (e.g. `<Slidewise.RightPanel>` children).

## 1.5.0

### Minor Changes

- f374686: **i18n + a11y + expanded theming surface.** Three host-feedback items batched together since they all live in the same context-and-CSS layer.

  ### `labels` prop on Root / SlidewiseEditor / SlidewiseFileEditor

  Every visible string in the chrome is overridable. Pass any subset; missing entries fall back to English defaults. Hosts in non-English locales no longer have to fork.

  ```tsx
  <Slidewise.Root
    labels={{
      save: { idle: "Speichern", saving: "Wird gespeichert…", saved: "Gespeichert" },
      play: "Wiedergabe",
      themeToggle: { toDark: "Dunkler Modus", toLight: "Heller Modus" },
      fileLoadError: (msg) => `Datei konnte nicht geöffnet werden: ${msg}`,
    }}
  >
  ```

  Threaded through a small `LabelsContext` — exported `useLabels()` so host components anywhere under `<Slidewise.Root>` can read the resolved table. The `DEFAULT_LABELS` constant is exported too for hosts that want to merge their own translation table against the canon.

  ### aria-label per built-in button

  Each TopBar subpart now accepts an `ariaLabel` prop that overrides the default (which now comes from `labels`). Combined with the existing `icons` prop, hosts can fully control both the visual and the screen-reader text of every chrome button.

  ### Full `--slidewise-bg-*` token set + `surfaces` prop

  22 new public CSS variables covering every internal surface (app, topbar, rail, rail-item, rail-item-active, canvas-frame, canvas-from/to, bottom-toolbar, right-panel, menu, tooltip, popover, dialog, slide, selection, hover, active, input, button, button-hover, pill, unsaved-badge). Internal CSS falls back through these to the existing internal vars, so existing v1.x overrides keep working.

  Typed `surfaces` prop on `<Slidewise.Root>` for JS-driven theming without writing CSS:

  ```tsx
  <Slidewise.Root
    surfaces={{
      app: "linear-gradient(180deg, #0b0d10, #0f0f12)",
      rail: "#1c1c22",
      canvasFrom: "#16181c",
      canvasTo: "#0f0f12",
      button: "transparent",
      buttonHover: "rgba(255,255,255,0.06)",
    }}
  >
  ```

  `<Slidewise.RightPanel>` and `<Slidewise.TopBar.Root>` already read from the new tokens. Internal regions (SlideRail, Canvas, BottomToolbar) still cascade via the existing internal vars; their token integration ships incrementally — overriding the unprefixed internal vars continues to work in the meantime.

  ### README CSS variable reference

  The README now has a full table of every public CSS variable, what it controls, and its default. Plus a `Localization` section showing the `labels` prop in use.

  ### New exports

  - `SlidewiseLabels`, `ResolvedLabels`, `DEFAULT_LABELS`, `useLabels`
  - `SlidewiseSurfaces`, `useSurfaces`, `surfacesToCssVars`

## 1.4.0

### Minor Changes

- a31b3f3: **Extended imperative API + lifecycle callbacks.** Hosts can now drive navigation, zoom, and slide CRUD programmatically, and observe more of the editor's lifecycle without subscribing to the store directly.

  ### New imperative methods

  On `SlidewiseRootHandle` and `SlidewiseFileEditorApi`:

  ```ts
  // Navigation
  goToSlide(slideId: string): void;
  nextSlide(): void;
  prevSlide(): void;

  // Zoom
  zoomIn(): void;            // ×1.25, clamped to [0.1, 4]
  zoomOut(): void;           // ×0.8
  setZoom(scale: number): void;

  // Slide CRUD
  addSlide(afterId?: string): string;            // returns new id
  duplicateSlide(slideId: string): string | null; // null if not found
  deleteSlide(slideId: string): void;

  // Selection
  getSelection(): SelectionSnapshot;   // { slideId, elementIds }
  ```

  ### New callbacks

  On `<Slidewise.Root>`, `<SlidewiseEditor>`, `<SlidewiseFileEditor>`:

  - `onActiveSlideChange?: (slideId: string) => void`
  - `onSelectionChange?: (selection: SelectionSnapshot) => void`
  - `onZoomChange?: (scale: number) => void`
  - `onSaveStart?: () => void` — before the host's `onSave` is invoked
  - `onSaveSuccess?: () => void` — after `onSave` resolves successfully
  - `onSaveError?: (err: Error) => void` — when `onSave` throws (error still propagates)

  ### Store-level changes

  - `addSlide` and `duplicateSlide` actions now return the new slide id (`string` / `string | null`). The previous signatures returned `void`. Hosts using `useEditor((s) => s.addSlide)` directly need to update if they were relying on the void return.
  - New `zoomIn` and `zoomOut` store actions, exposed alongside the existing `setZoom`.

  ### New exported type

  - `SelectionSnapshot` — `{ slideId: string; elementIds: string[] }`.

## 1.3.0

### Minor Changes

- 76a01cc: **TopBar decomposed into compound subparts, with `hide` and store hooks for everything else.**

  `<Slidewise.TopBar>` is now both a callable component (renders the default arrangement) AND a namespace of subparts. Hosts can either tweak the default tree or drop down to full compound composition with their own buttons mixed in.

  ```tsx
  // Default (unchanged behavior)
  <Slidewise.TopBar />

  // Hide individual buttons without going full compound
  <Slidewise.TopBar hide={["export", "play"]} />

  // Full compound — reorder, replace, mix host UI
  <Slidewise.TopBar.Root>
    <MyExitButton />
    <Slidewise.TopBar.Group>
      <Slidewise.TopBar.Undo />
      <Slidewise.TopBar.Redo />
    </Slidewise.TopBar.Group>
    <Slidewise.TopBar.Title />
    <Slidewise.TopBar.Spacer />
    <Slidewise.TopBar.Save />
    <Slidewise.TopBar.Play />
    <Slidewise.TopBar.ThemeToggle />
    <Slidewise.TopBar.Export />
    <MyShareButton />
  </Slidewise.TopBar.Root>
  ```

  **Subparts shipped:** `TopBar.Root`, `TopBar.Title`, `TopBar.Undo`, `TopBar.Redo`, `TopBar.Save`, `TopBar.Play`, `TopBar.ThemeToggle`, `TopBar.Export`, `TopBar.Spacer`, `TopBar.Group`.

  `Undo` and `Redo` now reactively disable when the history stack is empty. `Save` / `Undo` / `Redo` continue to hide in read-only mode. Each subpart accepts `className`, `style`, and an `ariaLabel` override.

  **Store hooks exported.** Host components anywhere inside `<Slidewise.Root>` can now read editor state without prop drilling:

  ```ts
  import {
    useEditor, // generic selector — pass any state → slice fn
    useEditorStore, // raw store ref, for manual subscribe / getState
    useSlides, // Slide[]
    useActiveSlide, // Slide
    useActiveSlideId, // string
    useSelection, // string[] of selected element ids
    useSelectedElements,
    useTheme, // "light" | "dark"
    useZoom, // number
    usePlaying, // boolean
    useDirty, // boolean — reactive dirty flag
    useHistory, // { canUndo, canRedo, undoSize, redoSize }
  } from "@textcortex/slidewise";
  ```

  These are minimal wrappers over the existing zustand store — internal `useEditor` and `useEditorStore` are now part of the public API.

## 1.2.0

### Minor Changes

- 0d47370: **Fix undo/redo + add history APIs.** The bug: `updateElement` and `setTitle` mutated the deck without pushing a history step, so pressing Undo after typing or moving an element walked back to the previous _structural_ change (last add/delete) — usually nothing visible, matching the host repro.

  Both now push history. To avoid 1 history step per keystroke / per drag pixel, mutations coalesce by `(elementId, patch keys)` within a 500ms idle window:

  - Typing into a text element collapses into one undo step per typing burst (~word boundary).
  - Dragging an element from mousedown → mouseup is a single step.
  - Switching the patch shape (drag → resize), the slide, or the element starts a fresh step.
  - Hosts can call `api.endCoalesce()` on natural commit boundaries (mouseup, blur) to force-end the burst earlier than the 500ms idle.

  **New imperative API on `SlidewiseRootHandle` and `SlidewiseFileEditorApi`:**

  - `canUndo(): boolean`
  - `canRedo(): boolean`
  - `getHistorySize(): { undo: number; redo: number }`
  - `endCoalesce(): void`

  **New callback on `<Slidewise.Root>`, `<SlidewiseEditor>`, and `<SlidewiseFileEditor>`:**

  - `onHistoryChange?: (state: { canUndo, canRedo, undoSize, redoSize }) => void` — fires whenever stack depths change so hosts can disable/enable Undo/Redo buttons reactively without polling.

  **Confirmed already correct:**

  - `setDeck` clears history (no leakage from previous deck).
  - Undo/redo replace the deck reference, so `onChange` fires and the dirty flag flips back when undoing past the last save.
  - Imperative `api.undo()` / `api.redo()` go through the same store action as the TopBar buttons (same dirty/onChange/onHistoryChange emission path).

## 1.1.0

### Minor Changes

- d0856b4: Add a compound-component API so hosts can replace, wrap, omit, or reorder any region of the editor without forking.

  ```tsx
  import * as Slidewise from "@textcortex/slidewise";
  import "@textcortex/slidewise/style.css";

  <Slidewise.Root deck={deck} onChange={setDeck} onSave={persist}>
    <Slidewise.TopBar />
    <Slidewise.Body>
      <Slidewise.SlideRail />
      <Slidewise.CanvasFrame>
        <Slidewise.Canvas />
        <Slidewise.BottomToolbar />
      </Slidewise.CanvasFrame>
      <Slidewise.RightPanel>
        <MyAIPanel />
      </Slidewise.RightPanel>
    </Slidewise.Body>
  </Slidewise.Root>;
  ```

  `<SlidewiseEditor>` keeps working — it's now a thin convenience wrapper over the compound parts. New `showBottomToolbar` prop (default `true`) on `<SlidewiseEditor>` lets hosts hide the floating tool selector without dropping to the compound API.

  Themed surface tokens introduced — `--surface-bg`, `--surface-ring`, `--surface-shadow`, `--surface-hover-bg`, `--surface-hover-ring`, `--surface-hover-shadow`, `--loading-overlay-bg`. Dark defaults adopt the charcoal-purple kit from textcortex/platform#7428 (`#1c1c22` base, `#241834` hover with plum-tinted shadow). Hosts override any of these via the `style` prop on `<Slidewise.Root>`.

- d0856b4: Close the host-integration gaps surfaced by first platform-side use.

  **New props on `SlidewiseEditor` and `SlidewiseFileEditor`:**

  - `icons?: SlidewiseIcons` — per-action icon overrides (`undo`, `redo`, `save`, `play`, `themeLight`, `themeDark`, `export`, `smart`). Pass any subset; missing slots fall back to the bundled lucide-react icons. Lets hosts skin Slidewise with Nucleo, Heroicons, custom SVGs, etc. without forking.
  - `readOnly?: boolean` (also `editable?: boolean` on `SlidewiseFileEditor`) — actually enforced now. When `true`/`false`, the top bar's save / undo / redo buttons are hidden and the title input is locked.

  **Parity for `SlidewiseFileEditor`** (these existed on `SlidewiseEditor` and were never forwarded):

  - `onChange?: (deck) => void`
  - `onDirtyChange?: (dirty) => void` — replaces 150 ms polling against `api.isDirty()` with reactive change events
  - `onLoadError?: (err) => void` — fires when `loadBlob` or `parse` throws so hosts can surface their own error UI instead of waiting for the in-editor message
  - `initialSlideId`, `showTopBar`, `showBottomToolbar`, `fontFamily`, `icons`
  - `api.getDeck()` — returns the live deck snapshot for header badges (slide counts, etc.) without re-parsing the blob

  **Public CSS variables** with `--slidewise-` prefix that hosts can override via `<Slidewise.Root style>`:

  - `--slidewise-radius` — primary border-radius for chrome buttons (default 10px)
  - `--slidewise-bar-bg` — top-bar background (default tracks `--app-bg`)
  - `--slidewise-accent` — accent color (default tracks `--accent`)

  The existing `--surface-*` token family from the previous release continues to cover panels and cards.
