# @textcortex/slidewise

## 1.21.1

### Patch Changes

- 94e348b: fix(render): emit a valid SVG `<image>` for image-fill backgrounds

  `renderDeckToSvg` rendered a slide's image-fill background as a CSS `background`
  shorthand inside an SVG `fill="…"` attribute — `fill="center / cover no-repeat
url("data:image…")"`. That is not valid SVG (a non-paint value plus nested
  unescaped quotes); browsers tolerate it, but strict rasterisers
  (`@resvg/resvg-js`, librsvg, batik) reject it, blocking a Chromium-free
  `parsePptx → renderDeckToSvg → resvg → PNG` path.

  The pptx importer stores image backgrounds as a CSS shorthand, but the
  renderer's image-ref detection only inspected the _start_ of the value, so the
  shorthand fell through to the `fill` path. The renderer now recognises a
  `url(...)` anywhere in the value and emits a real `<image>` element
  (`preserveAspectRatio` = `slice` for `cover`, `meet` for `contain`). A lock-in
  test asserts every rendered slide is valid SVG a strict XML parser accepts,
  with an image-background slide as the regression case.

## 1.21.0

### Minor Changes

- 652f804: feat(pptx): layout-instantiation in `applyEdits` (lossless scale-with-variety)

  `applyEdits` now supports `source: { layoutId, fills? }` in a `PlannedSlide` —
  instantiating a fresh slide from one of the template's **own** layouts inside
  the lossless byte-patch path. Because the layout is already a part of `source`,
  the new slide binds to `ppt/slideLayouts/<layoutId>.xml` (inheriting theme /
  master / background chrome) while every other part stays byte-identical. This
  unlocks lossless **and** scale-with-variety in one deck: clone slides where you
  want the exact thing, instantiate from layouts where you want variety.

  Each layout placeholder is materialised as an addressable, positioned element
  with a deterministic id — `layoutSlotElementId(layoutId, key)` (exported) where
  `key` is the `placeholderKey` / `summarizeLayouts` slot key. Text/`obj` slots
  are populated from `fills` and editable via `setText`; picture slots become a
  `<p:pic>` with a transparent placeholder blip so `setImage` can repoint them;
  chart/table/other slots expose their geometry so the host fills them with
  `addChart` / `addDiagram`. Placeholder geometry is read EMU-native from the
  layout (falling back to the matching master slot), so it stays correct without a
  canvas-px round-trip. An unresolvable `layoutId` is surfaced via `onWarning` and
  the slide is skipped rather than shipped wrong.

- 652f804: feat(render): headless `renderDeckToImages` + `deck.fontUsage` font transparency

  **Headless render-to-image (visual-QA loop).** New browser-free renderer that
  draws **what the editor draws** — native charts (`buildChartOption` + ECharts
  SSR), diagrams (`layoutDiagram`), text/shapes/images/backgrounds in z-order —
  _not_ the OOXML raster fallbacks. No Playwright/Chromium/DOM.

  - `renderDeckToSvg(deck, opts?)` → one composed SVG per slide (ECharts is
    loaded on demand, so it never bloats the editor bundle).
  - `renderDeckToImages(deck, opts?)` / `renderSlideToImage(deck, i, opts?)` /
    `renderPptxToImages(bytes, opts?)` → raster bytes. Rasterisation is an
    injected hook (`opts.rasterizeSvg`, e.g. `@resvg/resvg-js`); when omitted the
    default tries a dynamic `@resvg/resvg-js` import and throws a clear error if
    it isn't installed — so there's no hard native dependency.
  - `opts`: `slides` (1-based subset), `dpi` (canvas scales by `dpi/96`),
    `format`, `maxWidth` (thumbnail cap). Deterministic (no animation).

  Enables the host's render → fresh-eyes inspect → targeted `applyEdits` fix →
  re-render cycle, rendering a final `applyEdits` output directly.

  **Font transparency.** `parsePptx` now stamps `deck.fontUsage:
{ family, embedded }[]` — every font family the deck's text uses, flagged
  whether the source PPTX actually **embeds** it (`<p:embeddedFontLst>` → a real
  `ppt/fonts/*` part) or merely **references** it (system-fallback risk on
  viewers that don't ship the brand font). Hosts use it to warn at generation
  time ("missing fonts for some ppts"). It's a read-only diagnostic, distinct from
  `deck.fonts` (the embeddable payloads).

## 1.20.0

### Minor Changes

- e56ddd2: feat(pptx): `applyEdits` — lossless surgical-edit API

  Add `applyEdits(source, plan, options?)`: a patch on the original `.pptx` bytes
  rather than a full re-serialize. The create flow can now emit an `EditPlan`
  (subset/reorder/repeat of template slides, each with edits) and get back a valid
  package where everything not named by an edit is byte-identical to the source —
  masters, layouts, theme, embedded fonts, `ppt/tags/*`, notes, embeddings, and
  any untouched element. This removes the lossy round-trip that produced the
  `custGeom`/SVG-fallback/dangling-rel fidelity bugs and lets hosts drop their
  defensive cleanup. `serializeDeck` stays for the live editor / from-scratch decks.

  Edits address elements by the same stable ids `parsePptx` returns; slides by
  1-based template index. Supported ops: `setText`/`clearText` (preserve the
  template box + run styling, or rebuild from supplied runs), `setChartData`
  (repopulate a native chart in place — type/colours kept, caches **and** the
  embedded `xlsx` workbook updated so Edit-Data still works), `setTableData`,
  `setImage`, `removeElement`, `addChart`, `addDiagram`, plus per-slide
  `background` and deck `title`. Removed slides and any parts that become
  exclusive to them are reclaimed by a package-wide reachability sweep, then
  dangling relationships and content-types are reconciled. Unresolved element ids
  and unsupported layout-instantiation are surfaced via `onWarning` instead of
  throwing.

## 1.19.1

### Patch Changes

- 305dc0f: fix(pptx): emit a structurally valid package on serialize

  Three `serializeDeck` bugs corrupted the generated `.pptx` (missing parts /
  invalid image bytes) even from clean source templates, triggering a PowerPoint
  repair prompt and outright rejection by stricter consumers (Google Slides,
  LibreOffice, OOXML validators):

  - **Dangling `tags` relationships:** the chrome-preserve path re-pointed a
    slide's tag rel at a `slidewise_preserved_*` name, then clobbered that part by
    re-copying the source tags under their original names. The rel now resolves
    to the de-prefixed part it should always have pointed at.
  - **Dangling `notesMaster` relationships:** pptxgenjs writes a notesSlide per
    slide linked to a notes master, which chrome preservation removed without a
    source replacement. The orphaned (implicit, non-body-referenced) relationship
    is now dropped.
  - **SVG markup in `.png` raster fallbacks:** dual SVG images (`<a:blip>` raster
    - `<asvg:svgBlip>` vector) had the SVG source written into the `.png`
      fallback. The fallback is now a real rasterized PNG (browser) or a valid
      transparent PNG (SSR/Node); the vector `svgBlip` part is untouched.

  Adds a final `reconcileDanglingRels` invariant guard — every internal
  relationship target must resolve to a shipped part — that backstops both
  dangling-rel shapes (repairing recoverable targets, dropping only
  safe-to-remove optional ones, and leaving critical rels untouched). Also runs
  `pruneDanglingContentTypes` on the source-preservation path so stale
  `[Content_Types]` overrides (pptxgenjs's `slideMaster1..N`, leftover notes
  overrides) can't invalidate the package either.

## 1.19.0

### Minor Changes

- 3e7c3f1: First-class **diagram** element (P3 / F3). A new `DiagramElement` models
  process / timeline / funnel / matrix / cycle / list visuals as an ordered set
  of labelled `nodes` instead of a hand-placed cluster of shapes and lines. The
  renderer and the PPTX writer share one layout function (`layoutDiagram`, also
  exported), so the on-canvas preview and the saved file can't drift. On export a
  diagram serialises to a single labelled `<p:grpSp>` of real shapes + connectors
  — so it stays grouped and editable in PowerPoint (move/resize as one unit)
  rather than collapsing to anonymous floating shapes. Exposed via the
  `DiagramElement` / `DiagramNode` / `DiagramKind` types and the `layoutDiagram`
  helper.
- 3e7c3f1: Host deck-generation ergonomics (review follow-ups for layout instantiation):

  - **`summarizeLayouts(deck, options)`** — `{ compact: true }` returns the minimal
    `{ id, name?, role, fillable }` shape (no geometry) for a tight model-context
    budget; `{ dedupe: true }` collapses layouts that share a role + full
    placeholder-slot inventory (text **and** non-text chart/picture/table slots)
    into one representative carrying the rest as `aliases`, so an 85-layout
    template surfaces as its handful of distinct kinds — and a chart-bearing
    layout never collapses into a text-only twin. Composable.
  - **Robust `sourceLayoutId` resolution** — a host-authored slide's
    `sourceLayoutId` now resolves from `deck.layouts` **or**, when the host didn't
    carry the layouts array, by the `ppt/slideLayouts/<id>.xml` id convention
    against the `{ source }` archive. When it resolves to nothing, `serializeDeck`
    emits a structured `{ code: "layout-unresolved", slideIndex, layoutId }`
    warning instead of silently falling back.
  - **Richer `chrome-skipped` warning** — now carries the detected `sourceAspect`
    and `outputAspect` so a host can explain _why_ chrome was dropped.

  Plus README: the host "author-a-slide" contract (`{ sourceLayoutId,
background: "transparent", elements }` without a JS call), the recipe for
  placing non-text slots from `summarizeLayouts` geometry, and the server-side
  `layoutDiagram` render recipe with its DOM-free guarantee.

- 3e7c3f1: Round-trip fidelity fixes (P4):

  - **Image `crop` / `radius`** now round-trip. Previously an image's `crop`
    (`<a:srcRect>`) was read on import but silently dropped on export, and corner
    `radius` was neither parsed nor written. `serializeDeck` now routes any image
    carrying a `crop` or `radius` through a dedicated `<p:pic>` writer (emitting
    `<a:srcRect>` and `roundRect` geometry) instead of pptxgenjs — whose
    cover/contain sizing emits its own `<a:srcRect>` and would fight a user crop —
    and `parsePptx` reads a rounded picture's corner radius back. Plain
    (uncropped, square-cornered) images keep the existing path unchanged.
  - **Text-run letter-case (`cap`)** now round-trips. A run's `cap`
    (`"all"` / `"small"`, OOXML `<a:rPr cap>`) was parsed on import but dropped on
    export (pptxgenjs has no `cap` option). It's now re-applied per run in
    post-process, so all-caps / small-caps styling survives a save.

- 3e7c3f1: Harden layout instantiation for AI deck generation (P1 / F1):

  - **Layout-instantiated slides now inherit their layout's background.** A slide minted by `addSlideFromLayout` with the default `transparent` background no longer serialises an explicit `<a:noFill/>` `<p:bg>` — that empty background was overriding the layout/master/theme inheritance, so instantiated slides lost their on-brand background. They now stay `<p:bg>`-less and paint from their `sourceLayoutId` layout's chrome (matching the source-slide guarantee for cloned/reordered slides).
  - **Layout-selection metadata.** `DeckLayout.type` now carries the raw OOXML `<p:sldLayout type>` role, and the new `summarizeLayouts(deck)` returns a compact, model-context-friendly layout menu (friendly `role` label, fillable `fills` keys, per-placeholder kind/category/geometry) so a host can have a model pick a layout per slide. `placeholderKey(ph)` exposes the exact `fills` key for a placeholder.

- 3e7c3f1: Machine-readable serialization diagnostics (P2 / B3). `serializeDeck` now
  accepts `SerializeOptions.onWarning`, a callback invoked with a structured
  `SerializeWarning` when the output degrades. The key case is
  `"chrome-skipped"` — emitted when a `source` template's masters / layouts /
  theme / fonts can't be carried over because its slide size is unreadable, so
  the deck falls back to generic chrome. Hosts can now detect and surface the
  degradation instead of only seeing a console line. (Non-16:9 sizing for 4:3 /
  16:10 / custom templates already drives the output slide size; this adds the
  escape-hatch signal when it can't.)

## 1.18.1

### Patch Changes

- f16cfa5: fix(pptx): respect z-order for synthesised content (charts, custGeom shapes, connectors)

  Synthesised spTree content was always inserted at the back of the slide, so an
  in-app chart / custGeom "SVG" / connector with a higher z than its background
  card was buried behind that card (and its shadow) and rendered invisible. Each
  synth item now anchors directly on top of the pptxgenjs node it sits above
  (matched by shape name), preserving the deck's z-order, and only falls to the
  back when it is genuinely below every model element.

## 1.18.0

### Minor Changes

- 17c069f: Template-faithful serialization fixes and new authoring primitives for AI deck generation:

  - **Per-slide source mapping** — `Slide.sourceSlideIndex` lets a host that clones / reorders / subsets imported slides declare which source slide each output slide replays its background and layout from, instead of mapping by output position (fixes blank/white-on-white slides on reordered decks).
  - **Deep chart preservation** — preserved charts now carry their full dependency tree (embedded workbook, colors/style parts, rels, content types), so they no longer trigger a PowerPoint repair and keep "Edit Data" + custom styling.
  - **Non-16:9 templates** — a source's real slide size now drives the output (4:3, 16:10, custom), preserving its masters / layouts / theme / fonts and inverting the authoring-canvas fit for emitted elements, instead of silently falling back to a generic 16:9 deck.
  - **Instantiable layouts** — `parsePptx` exposes master layouts on `Deck.layouts`, and the new `addSlideFromLayout(deck, layoutId, opts)` mints a fresh slide bound to a layout with its text placeholders ready to fill.
  - **Chart-option helpers** — `buildChartOption`, `defaultPaletteColor`, and `makeValueFormatter` are exported so hosts can build the exact ECharts options Slidewise renders (e.g. for server-side previews).
  - **Connector primitive** — a first-class `connector` element (straight / bent / curved, arrowheads, flips) with renderer + `<p:cxnSp>` writer support.

## 1.17.1

### Patch Changes

- 83683e3: fix(pptx): render `<a:grpFill/>` shapes by inheriting the group's fill

  Decorative line-art (e.g. the swoosh graphic on a title slide) is often
  authored as many `<a:custGeom>` segments inside a single `<p:grpSp>`, with every
  segment declaring `<a:grpFill/>` so they share the group's one translucent
  colour. `parsePptx` had no `grpFill` branch, so each segment fell through to
  `transparent` and the entire graphic disappeared on import — present in the
  source but invisible in the deck.

  The group's resolved fill is now threaded down to descendants, and a shape with
  `<a:grpFill/>` paints with it (walking up the group chain when an inner group
  defines no fill of its own). Geometry was already preserved; only the paint was
  being dropped.

## 1.17.0

### Minor Changes

- 019e000: feat(pptx): support PowerPoint templates (.potx)

  `.potx` and `.pptx` share an identical OOXML package; only the main part's
  content type in `[Content_Types].xml` differs. This adds first-class template
  support across import and export:

  - `parsePptx` already parsed `.potx` transparently (it reads parts by path, not
    by content type) — now the rest of the pipeline preserves template-ness.
  - New exported `isPptxTemplate(blob)` detects a template by inspecting the
    package content type rather than trusting a filename extension (a mis-named
    `.pptx` that is really a template is detected correctly).
  - `serializeDeck` gains an `asTemplate?: boolean` option. When omitted,
    template-ness is inherited from the source archive, so a parsed `.potx`
    round-trips back to a `.potx`; pass `true`/`false` to force the output kind.
    Templates are emitted with the `…presentationml.template.main+xml` main-part
    content type and the `.potx` MIME type.

## 1.16.4

### Patch Changes

- a085c8d: fix(pptx): import-fidelity fixes for think-cell / brand-template decks

  - Skip shapes flagged `hidden="1"` (e.g. think-cell "do not delete" data objects)
  - Render run-level text highlight (`<a:rPr><a:highlight>`) end to end
  - Apply `cap="all"`/`"small"` (including when inherited from a placeholder list style) as a render-time letter-case transform
  - Derive font weight from weight-named families ("Gilroy ExtraBold" → 800, "… Medium" → 500, …) so substitute fonts render at the right heaviness
  - Tables: per-cell fills, text colours, per-side borders, proportional column widths / row heights, cell spans (`gridSpan`/`hMerge`/`rowSpan`/`vMerge`), per-cell vertical anchor, and rich per-cell runs (highlight / bold / ✓ glyphs / bullet line breaks). Unfilled cells stay transparent instead of inheriting a sibling fill
  - Map Wingdings bullet glyphs to Unicode (`ü`→✓, `q`→☐, `§`→▪, …)
  - Bullets: repeat a character bullet across in-paragraph line breaks, suppress the glyph on empty paragraphs, and trim trailing empty paragraphs
  - Synthesise block-arrow paths (`down`/`up`/`left`/`rightArrow`) and resolve outline colour from `<p:style><a:lnRef>` so dashed/outlined shapes draw
  - Keep a text-bearing preset or custom-geometry shape's fill, border, and corner radius behind its text (roundRect callouts, outlined chevrons)
  - Honour `<a:bodyPr><a:spAutoFit>` no-wrap for short single-line labels; skip the arrow-tip text inset on no-fill label shapes
  - Render per-paragraph hanging-indent bullets as one block per line so multi-line items align correctly

## 1.16.3

### Patch Changes

- 80e1b4e: Fix several PPTX import-rendering fidelity gaps surfaced by real-world decks:

  - **Picture/SVG fills on shapes** — shapes whose fill is an `<a:blipFill>` (the modern Office "icon" pattern, including dual PNG+SVG blips) now render their artwork. Previously these `custGeom` icons (globes, stars, grid textures, brand marks) imported with no fill and showed blank. The image is painted clipped to the shape's silhouette, or as a box-filling background for rect/rounded/circle shapes.
  - **Empty picture placeholders** — empty picture placeholders inherited from the slide layout no longer leak onto the slide as grey "Insert Picture" prompt boxes. Picture placeholders the slide actually hosts now inherit their rounded geometry and fill from the layout/master so they render as the template intends.
  - **Embedded fonts (EOT / MicroType-Express)** — embedded `.fntdata` fonts now decode to browser-valid TTFs. Two bugs were fixed: composite glyphs that carried `WE_HAVE_INSTRUCTIONS` on a non-first component produced a malformed `glyf` table, and format-12 `cmap` subtables shipped a non-zero `language` field — both caused the browser's font sanitizer (OTS) to reject the whole font and fall back to a system typeface.
  - **Weight-named font families** — weight-named embedded families (e.g. "Montserrat Bold", "Montserrat Semi-Bold") are now also aliased to their base family at the matching numeric weight, so bold/semi-bold text bound to the base family renders with the real embedded face instead of a synthetic bold.

## 1.16.2

### Patch Changes

- 71f96cb: fix(pptx): resolve theme colours when persisting verbatim custGeom, so brand-coloured vectors qualify for cross-process replay

  The cross-process verbatim-replay fix (1.16.1) only stamped a custGeom shape's source `<p:sp>` into the deck JSON when the XML was fully self-contained — and it _excluded_ anything referencing a theme colour (`<a:schemeClr>`). Brand marks are almost always filled with a theme accent (e.g. E.ON red is `schemeClr val="accent2"`), so the very shapes this was meant to fix (the bicycle) were skipped and fell back to the lossy synth path — still blank.

  The importer now **resolves** `<a:schemeClr>` references to literal `<a:srgbClr>` against the slide's theme before persisting, instead of bailing. Both elements accept the same child transforms (`lumMod`, `alpha`, …) so the swap is lossless — only the colour source changes from a theme reference to a baked hex, making the fragment valid without the source theme. Shapes that still reference media (`r:embed`/`r:id`/`r:link`) or carry a colour token absent from the theme remain on the synth path.

## 1.16.1

### Patch Changes

- 65eeac2: fix(pptx): carry verbatim custGeom OOXML in the deck JSON so vector shapes survive cross-process serialize

  The high-fidelity replay of imported elements relies on two **module-global** registries (`sourceBufferCache`, `elementSourceRegistry`) populated only by `parsePptx` and never written to the deck JSON. In a pipeline that parses in one process and serializes in another (parse client-side → store deck JSON → serialize server-side), those registries are empty, so every element is re-synthesised from its deck fields. Synthesis can't represent OOXML even-odd / winding, so complex `custGeom` vectors (e.g. a bicycle diagram) render blank even though simpler ones (the brand logo) happen to survive.

  The importer now stamps the verbatim `<p:sp>` of **self-contained** custGeom shapes (no `r:embed` / `r:id` / `a:schemeClr` references) onto the element as `pristineOoxml = { xml, snapshot }`, which rides along in the deck JSON. On serialize, an unedited such shape (snapshot still matches) is replayed verbatim — exact source geometry and winding — instead of being re-synthesised; its `cNvPr/@id` is rewritten to avoid spTree collisions. Edited shapes fall back to synthesis. This is the same persist-in-JSON pattern already used for embedded fonts (`deck.fonts`), scoped to vector shapes to keep JSON bloat negligible (~a few KB per deck).

## 1.16.0

### Minor Changes

- ea3007a: Begin the MTX → TTF decoder for PPTX-embedded fonts.

  PPTX stores embedded fonts as MTX-compressed EOT inside `ppt/fonts/*.fntdata`. PowerPoint decodes them natively; browsers can't, which is why editor previews fall back to system fonts even when `parsePptx` extracted the bytes into `Deck.fonts`. This change lays the groundwork:

  **New `packages/slidewise/src/lib/fonts/eot.ts`**

  - Full EOT wrapper parser — header, flags, variable-length name fields, version 1.0 / 2.0 / 2.1 / 2.2 tail variants
  - Uncompressed-EOT extraction → ready-to-register TTF/OTF bytes
  - MTX detection via the `TTEMBED_TTCOMPRESSED` flag
  - `EotDecodeError` with discriminated `kind` so callers can distinguish "truncated", "magic-mismatch", "mtx-not-implemented", "mtx-failed"

  **New `packages/slidewise/src/lib/fonts/mtx.ts`**

  - MTX outer container parser scaffolding
  - Recognises but does not yet decompress the PowerPoint MTX variant (Office-embedded fonts use a different major version than the W3C MTX submission spec; the post-2010 Office variant isn't publicly documented).
  - Throws `EotDecodeError("mtx-not-implemented")` for unsupported sub-methods so the fallback chain (Deck.webFonts → fontRegistry → system fonts) runs cleanly. No noisy console errors — diagnostic only when `window.__slidewiseFontDebug = true`.

  **Auto-wiring through `resolveWebFonts()`**

  The font loader now decodes `Deck.fonts` on the fly. When a font is uncompressed EOT (~30% of real-world embedded fonts), we synthesise a `data:font/ttf;base64,…` URL and register it via `@font-face` — no `fontRegistry` needed, no platform involvement. Brand-embedded fonts that use MTX glyph compression (the EON case, most enterprise decks) still need `fontRegistry` for editor preview, but the export path still embeds the original MTX bytes verbatim.

  **What still needs to happen for full coverage**

  A real MTX decompressor for the Office variant. Either:

  - Reverse-engineering the format against a test corpus, or
  - A WebAssembly port of FontForge's GPL'd `parsettf.c` MTX path

  Both are multi-week projects. Tracked as a follow-up.

  **Tests**

  3 new tests in `src/lib/fonts/__tests__/eot.test.ts` against the real `eon-deck.pptx` fixture:

  - EOT header parser succeeds on every embedded font (5 entries)
  - `isMtxCompressed()` correctly reports the EON fonts as MTX
  - `decodeEot()` returns `EotDecodeError.kind === "mtx-not-implemented"` for MTX-flagged fonts (so the caller's fallback fires)

  No public API changes. `FontAsset`, `WebFontAsset`, and the rest of the font surface are untouched. Additive.

- ea3007a: Complete the in-browser MTX decoder: TrueType-glyf font reconstruction.

  Milestone 2 decoded CFF/OTTO embedded fonts. This adds TrueType-outline fonts: MTX stores `glyf` in Compact Table Format (the WOFF2 triplet point encoding) and strips `loca`. `ctf-glyf.ts` reconstructs a standard `glyf` + `loca` and reassembles the sfnt with recomputed table checksums + `head.checkSumAdjustment` (so strict browser sanitizers accept it). TrueType hinting instructions are dropped (browsers ignore them; unhinted outlines render identically on screen). Simple and composite glyphs are handled.

  Verified against `eon-deck.pptx`: all 5 embedded EON fonts now decode in-browser — the 4 CFF EON Brix Sans weights (OTTO) and the TrueType EON Office Head (FontForge confirms the font name and correct glyph outlines). No CDN, no `fontRegistry`, no network: embedded PPTX fonts render exactly and automatically on import.

- ea3007a: Decode CFF embedded PowerPoint fonts in-browser via a clean-room MTX (MicroType Express) decompressor.

  PPTX embeds fonts as MTX-compressed EOT in `ppt/fonts/*.fntdata`. Browsers can't decode MTX, so editor previews fell back to system fonts even though the importer extracts the bytes into `Deck.fonts`. This ports the W3C MTX submission (Appendix C: BITIO / AHUFF / LZCOMP) to TypeScript so the editor renders the **real embedded typeface** — no CDN, no `fontRegistry`, no network.

  - `lib/fonts/lzcomp.ts` — full LZCOMP decompressor: MSB-first bit reader, adaptive Huffman (complete-tree init + priming + sibling-rule update/swap), 7168-byte preload dictionary, copy-model loop.
  - `lib/fonts/mtx.ts` — MTX v3 container parse + `decompressMtx`: for CFF/OTTO fonts, block 1 decompresses to the complete font and is returned directly.
  - `lib/fonts/eot.ts` — locates FontData as the trailing `fontDataSize` bytes (spec-correct); routes compressed payloads through the MTX decoder.
  - `resolveWebFonts` / `fontAssetToWebFont` wrap the decoded bytes as a `data:font/otf` URL, so embedded CFF fonts render automatically on import.

  **Verified** against `eon-deck.pptx`: the 4 CFF EON Brix Sans weights decode to valid OTTO fonts (FontForge confirms "EON Brix Sans Regular"). TrueType-glyf fonts (EON Office Head) fall back with `mtx-not-implemented` — CTF glyf reconstruction is the remaining milestone. Export is unchanged (original `.fntdata` bytes still round-trip to PPTX).

## 1.15.4

### Patch Changes

- 03b71b7: fix(pptx): custGeom export — map path coords to the shape's EMU extent and drop the bogus `fill="darken"`

  Two correctness issues in `svgPathToOoxml` (custGeom emission):

  - **Wrong `fill="darken"` on even-odd paths.** OOXML's `<a:path fill="…">` is a _shading_ hint (none / norm / lighten / darken), **not** a winding rule — custGeom has no even-odd flag at all. Emitting `fill="darken"` for `fillRule: "evenodd"` silently darkened the shape and tripped some renderers (LibreOffice) without ever producing the hole. We now leave the default `norm` shading; holes are carried by the subpath directions already encoded in `d`.

  - **Path coordinate space didn't match the shape box.** `<a:path w/h>` was emitted at the source viewBox dimensions while the points stayed in that space. PowerPoint itself emits custGeom with `w/h` equal to the shape's EMU extent, and LibreOffice only maps the path onto the shape correctly when the two line up. `svgPathToOoxml` now takes the target EMU extent and rescales the points so `<a:path w/h>` matches the shape — improving cross-renderer fidelity for vectors whose viewBox differs from their box.

## 1.15.3

### Patch Changes

- 0343bca: fix(pptx): vector shapes no longer render blank — gradient paint servers, full-circle arcs, and embedded brand fonts

  Three independent fidelity bugs that made imported brand decks render blank or fall back to system fonts:

  - **Gradient fills on vector shapes rendered blank.** SVG `<path>` / `<polygon>` `fill=` cannot take a CSS `linear-gradient(...)` / `radial-gradient(...)` string, so any custGeom silhouette or triangle/diamond/star carrying a gradient fill painted nothing. The renderer now builds an SVG paint server (`<linearGradient>` / `<radialGradient>`, including `#RRGGBBAA` alpha → `stop-opacity`) and references it via `fill="url(#…)"`. Solid / `transparent` / `url()` fills are unchanged. Applies to shape paths, the polygon presets, and text backing paths.

  - **Full-circle custGeom arcs (e.g. bicycle wheels) imported blank.** A 360° `<a:arcTo>` was converted to a single SVG elliptical-arc whose end point equals its start — which the SVG spec renders as nothing, so wheels/rings vanished. The importer now splits any arc sweep into ≤120° segments, so full circles render.

  - **custGeom arcs downgraded to a rect on export.** `svgPathToOoxml` bailed on SVG `A` commands, collapsing the whole shape to a `prstGeom` rect (invisible on line-art). Arcs are now approximated as cubic Béziers (≤90° segments, sub-pixel error) and emitted as `<a:cubicBezTo>`, so arc-bearing vectors survive export.

  - **Embedded brand fonts fell back to Calibri in the editor.** The importer populated `Deck.fonts` (the PPTX-embedded payload) but never `Deck.webFonts`, so the canvas had nothing browser-renderable to paint with. It now sniffs each embedded font's signature and, when it's a browser-loadable SFNT/WOFF (which is what PowerPoint embeds), surfaces a `WebFontAsset` so the real typeface renders. Non-renderable payloads are skipped (no regression).

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
