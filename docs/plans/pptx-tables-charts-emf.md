# Plan: PPTX importer round 2 — table styles, charts, EMF

> Status: **proposal, not implemented**. This document scopes the next PPTX
> import PR(s). It exists to align on architecture and ordering before any
> code lands.
>
> Builds on the importer overhaul released in `@textcortex/slidewise@1.9.0`
> (PR #32 + #35 + #36).

## What's still missing on real client decks

| Real-deck symptom                          | Source feature we don't import        |
| ------------------------------------------ | ------------------------------------- |
| Table cells render with default fills only | `<a:tblPr><a:tableStyleId>` styles    |
| Bar / pie / line charts vanish             | `<p:graphicFrame>` → `<c:chart>` XML  |
| Brand wordmarks (EMF) drop with diagnostic | `image*.emf` / `image*.wmf`           |

All three are generic OOXML features, not deck-specific quirks. Dickinson
sample slide 5 (table), slide 4 (bar chart), and every slide (EMF
wordmark) demonstrate all three at once.

## Proposed scope — three commits, one PR

### 1. Table styles (smallest, ship first)

**Goal**: a `<a:tbl>` with `<a:tblPr><a:tableStyleId>{GUID}</a:tableStyleId>`
renders with the header / first-row / banded-row fills, text colours, and
borders specified by the referenced style — not the current default flat
fill.

**Touchpoints**:

- `src/lib/pptx/pptxToDeck.ts`
  - Add `readTableStyles(zip)` → `Map<guid, TableStyle>` parsed from
    `ppt/tableStyles.xml` once per parse.
  - Resolve theme colours in the style at load time (theme is available).
  - In `parseTable`, look up the `tableStyleId` and apply the resolved
    style to header row / body / banded rows / first column / last
    column.
- `src/lib/types.ts`
  - `TableElement` already has `borderColor`; add `rowAltFill`,
    `firstColFill`, `firstRowFill` (header), and a `style` discriminator
    so the renderer can apply banded rows.
- `src/components/editor/ElementView.tsx`
  - `TableView` reads the new fields and alternates row fills, draws
    first-column emphasis when set.

**Out of scope**: cell-level `<a:tcPr>` overrides on top of styles (we
already read solidFill there; just preserve that as the override).

**Estimated size**: ~300 LOC, parser + renderer, ~1 day.

### 2. Charts — cached-image path

**Goal**: every `<p:graphicFrame>` with `<c:chart>` renders as an image
at the chart's bounds. Visually identical to PowerPoint, not live-editable.

**Why cached image first**: every PowerPoint-authored chart bundles a
rasterised preview either as an EMF/PNG in `ppt/embeddings/oleObject*.bin`
or as a fallback blip listed in the chart's rels. Picking that up gives us
~95% of the fidelity for ~5% of the engineering of a live chart renderer.

**Touchpoints**:

- `src/lib/pptx/pptxToDeck.ts`
  - `parseGraphicFrame` currently only recognises `<a:tbl>`. Add a
    `<c:chart>` branch that reads the chart's rels, walks
    `ppt/charts/_rels/chartN.xml.rels` for an "image" relationship,
    falls back to scanning the `<p:graphicFrame>` extLst for a cached
    image extension if present, and emits an `ImageElement` for the
    cached PNG (or a labelled placeholder if there isn't one).
- `src/lib/types.ts`
  - Nothing — chart-as-image reuses `ImageElement`.

**Estimated size**: ~150 LOC + an extra `slide-with-bar-chart.pptx`
fixture in `__tests__`. ~½ day.

**Follow-up (separate PR, deferred)**: live chart rendering. Parse
`c:barChart` / `c:pieChart` / `c:lineChart` / `c:ser` / `c:cat` / `c:val`
into a new `ChartElement`. Render via Apache ECharts (most coverage)
behind a lazy import. Editable in Slidewise; ~3–5 days. Worth a separate
review window.

### 3. EMF / WMF — cached fallback only

**Goal**: when a `<p:pic>` references EMF/WMF and the deck also ships a
rasterised fallback for that asset, render the fallback. Otherwise keep
the current "skip with diagnostic" behaviour.

**Cached fallbacks live in two places in practice**:

- A sibling rId in the same rels file pointing to a PNG version of the
  same asset (rare, but happens when PowerPoint inserts EMF + raster).
- The picture's own `<a:blip>` extLst sometimes carries an alternative
  `r:embed` for a raster preview.

**Touchpoints**:

- `src/lib/pptx/pptxToDeck.ts`
  - Replace the unconditional skip in `parsePic` with a fallback lookup
    pass that prefers PNG/JPEG/SVG over the EMF embed.
  - Keep the diagnostic for the no-fallback case so consumers know an
    EMF was dropped.

**Estimated size**: ~80 LOC, parser only. ~¼ day.

**Out of scope**: actual EMF → SVG / canvas decoding. That needs a
WASM port of a native EMF renderer (e.g. libemf2svg) and is its own
multi-day project — defer.

## Ordering rationale

- Table styles is the smallest and lands a recognisable visual win
  (every cell in every styled table snaps to its design).
- Cached charts give us the biggest "this looks like the source deck"
  delta with minimal architectural risk.
- EMF cached-fallback is contained but only helps decks whose authors
  shipped raster fallbacks; some decks (e.g. Dickinson sample) won't
  benefit until the real EMF decoder lands.

If a "live charts" decision is needed, raise it after the cached path
ships so we have a working baseline to compare editability against.

## Out of scope for this round

These need their own PRs:

- **Live chart rendering** — parse series data, render via ECharts.
- **EMF → SVG decoder** — likely a WASM port; large effort.
- **Embedded TTCOMPRESSED fonts** (`ppt/fonts/*.fntdata`) — needs MTX
  decompressor; no practical browser-side decoder today.
- **Animations / transitions** — multi-day, low ROI for static rendering.
- **SmartArt** — diagram engine, days-to-weeks.

## Release / process

- Open as a single PR titled `feat(pptx): import table styles, charts (cached), and EMF fallbacks` targeting `main`.
- One Changeset (`minor` bump → 1.10.0) covering all three items.
- Same testing protocol as round 1: parse the Dickinson sample + the
  eon-deck, eyeball slide 5 (table), slide 4 (chart), every slide
  (wordmark) before pushing.

## Open questions for review

1. Are we OK with the **cached-image charts** trade-off (faithful but
   not editable)? If "must be editable", we should land live rendering
   instead and accept the longer timeline.
2. For EMF fallback lookups, should we surface a host hook so an app
   can supply its own pre-rasterised replacements (e.g. `onMissingMedia(rId)`
   → `Promise<DataUrl>`)? Useful for hosts that already process decks
   server-side.
3. Table styles parse the **first** matching style entry in
   `tableStyles.xml`; do we need to honour the `<a:tableStyleList def="…">`
   attribute (the default-style GUID at the file level) when a table
   has no `tableStyleId`?
