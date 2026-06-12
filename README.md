# Slidewise

Embeddable React PPTX editor. PPTX import + canvas editor + PPTX export, in
one component.

```bash
pnpm add @textcortex/slidewise
```

Peer dependencies: `react >=19`, `react-dom >=19`.

## Quick start

`SlidewiseFileEditor` wraps the editor with PPTX load/save plumbing — give it
async `loadBlob` and `saveBlob` callbacks and it handles parsing, dirty
tracking, and serialisation.

```tsx
import {
  SlidewiseFileEditor,
  type SlidewiseFileEditorApi,
} from "@textcortex/slidewise";
import "@textcortex/slidewise/style.css";
import { useRef } from "react";

export function PresentationsRoute({ fileId }: { fileId: string }) {
  const apiRef = useRef<SlidewiseFileEditorApi | null>(null);

  return (
    <SlidewiseFileEditor
      onEditorApiChange={(api) => (apiRef.current = api)}
      loadBlob={async () => {
        const res = await fetch(`/api/files/${fileId}`);
        return res.blob();
      }}
      saveBlob={async (pptx) => {
        await fetch(`/api/files/${fileId}`, { method: "PUT", body: pptx });
      }}
    />
  );
}
```

The host owns transport and conflict detection; Slidewise owns parsing,
editing, and serialisation. Call `apiRef.current.save()` to trigger a save
from outside the editor's top bar; call `apiRef.current.isDirty()` to gate
"unsaved changes" UI.

## Lower-level entry point

If your host already has a `Deck` in memory (e.g. you're storing the JSON
shape in your own database rather than `.pptx` blobs), mount
`SlidewiseEditor` directly:

```tsx
import { SlidewiseEditor, type Deck } from "@textcortex/slidewise";
import "@textcortex/slidewise/style.css";

<SlidewiseEditor
  deck={deck}
  onChange={(next) => setDeck(next)}
  onSave={(next) => persist(next)}
/>;
```

## Working with decks programmatically

Slidewise persists slides as a versioned JSON `Deck`. The schema is the
canonical contract — undo/redo, exports, AI features, and persistence all
key off it.

```ts
import {
  parsePptx,
  serializeDeck,
  migrate,
  CURRENT_DECK_VERSION,
  type Deck,
} from "@textcortex/slidewise";

const deck: Deck = await parsePptx(blob); // import
const pptx: Blob = await serializeDeck(deck); // export
const safe: Deck = migrate(unknownDeckJson); // normalise an external deck
```

`serializeDeck(deck, { source })` reproduces a source template's slide size
(16:9, 4:3, 16:10, or custom) and carries over its masters / layouts / theme /
fonts. Degradations are reported through an optional `onWarning` diagnostics
sink (structured `SerializeWarning`s) so the host can surface them rather than
ship a silently off-brand deck:

```ts
await serializeDeck(deck, {
  source,
  onWarning: (w) => {
    switch (w.code) {
      case "chrome-skipped": // size unreadable → generic chrome
        notifyHost(`${w.message} (source ${w.sourceAspect}, output ${w.outputAspect})`);
        break;
      case "layout-unresolved": // a slide's sourceLayoutId matched nothing
        notifyHost(`slide ${w.slideIndex}: layout ${w.layoutId} not found`);
        break;
      case "element-write-failed": // one element threw; rest of slide intact
        notifyHost(`${w.elementType} ${w.elementId} skipped`);
        break;
    }
  },
});
```

`migrate()` runs every external deck (PPTX import, JSON import, localStorage
hydration, host props) through the schema migration chain so the rest of the
editor only sees current-shape decks. It throws if the input was written by a
newer Slidewise than the host has installed — pin the version range you can
support.

### Lossless surgical edits with `applyEdits`

When you start from a branded template and only need to change a few things
(swap some text, fill a chart, drop a sample element), a full
`serializeDeck` round-trip is overkill — and re-rendering unedited elements is
where fidelity bugs come from. `applyEdits(source, plan)` instead **patches the
original bytes**: everything not named by an edit comes out byte-identical to
the source (masters, layouts, theme, embedded fonts, `ppt/tags/*`, notes,
embeddings, and any untouched element), and the result opens in PowerPoint with
no repair.

```ts
import { parsePptx, applyEdits, type EditPlan } from "@textcortex/slidewise";

const deck = await parsePptx(source); // address elements by deck ids
const plan: EditPlan = {
  title: "Q3 Results",
  // Output order = this list. Slides are the source's 1-based template index;
  // a source slide may repeat for controlled reuse.
  slides: [
    {
      source: { slideIndex: 1 },
      edits: [{ op: "setText", elementId: titleId, text: "Q3 Results" }],
    },
    {
      source: { slideIndex: 3 },
      edits: [
        // Repopulate a native chart in place — type/colours and the embedded
        // workbook are preserved, so PowerPoint's Edit-Data still works.
        { op: "setChartData", elementId: chartId, categories: ["Jan", "Feb", "Mar"], series: [{ name: "Revenue", values: [10, 20, 30] }] },
        { op: "removeElement", elementId: sampleChartId },
      ],
    },
    { source: { slideIndex: 4 }, edits: [] }, // kept byte-identical
  ],
};

const out: Uint8Array = await applyEdits(source, plan, {
  onWarning: (w) => notifyHost(w.message), // unresolved id / unsupported op
});
```

Ops: `setText` / `clearText`, `setChartData`, `setTableData`, `setImage`,
`removeElement`, `addChart`, `addDiagram`, plus per-slide `background` and the
deck `title`. Elements are addressed by the same stable ids `parsePptx` returns,
so call `applyEdits` in the same process as the `parsePptx` that produced the
plan. Removed slides and any parts exclusive to them are reclaimed
automatically. `serializeDeck` remains the path for the live editor and
from-scratch decks; `applyEdits` is the lossless path for template-derived
output.

**Scaling a deck with the template's own layouts.** A `PlannedSlide` can clone
a source slide (`{ slideIndex }`) **or** instantiate a fresh slide from one of
the template's layouts (`{ layoutId, fills? }`). Because the layout is already a
part of `source`, instantiation is still a lossless patch — the new slide binds
to `ppt/slideLayouts/<layoutId>.xml` and inherits its theme / master /
background chrome, while every other part stays byte-identical. This is how you
build a 35-slide deck from a 16-slide template without it looking repetitive:
clone where you want the exact slide, instantiate from layouts where you want
variety.

```ts
import { applyEdits, layoutSlotElementId, summarizeLayouts } from "@textcortex/slidewise";

const layouts = summarizeLayouts(deck); // pick a layout id + its fillable slot keys
const layoutId = layouts[0].id;

await applyEdits(source, {
  slides: [
    { source: { slideIndex: 1 }, edits: [] }, // cloned, byte-identical
    {
      // Instantiate from a layout; `fills` populates text placeholders by key.
      source: { layoutId, fills: { title: "Pipeline", "body:1": "Q3 → Q4" } },
      edits: [
        // Non-text slots are addressable by a deterministic id so edits can
        // target them: fill the picture slot, draw a chart into the chart slot.
        { op: "setImage", elementId: layoutSlotElementId(layoutId, "pic:2"), data: photoBytes },
        { op: "addChart", bounds: chartSlotBounds, kind: "column", categories, series },
      ],
    },
  ],
});
```

Each instantiated placeholder (text **and** non-text — picture / chart / table)
is materialised as a positioned element with the stable id
`layoutSlotElementId(layoutId, key)`, where `key` is the `placeholderKey` /
`summarizeLayouts` slot key (`"title"`, `"body:1"`, `"pic:2"`, …). An
unresolvable `layoutId` is reported via `onWarning` and the slide is skipped
(never shipped wrong).

### Headless render-to-image (visual QA)

`renderDeckToImages` renders a deck to one image per slide **server-side, with
no browser** — drawing what the editor draws (native charts via ECharts SSR,
diagrams, text, shapes, images), not the OOXML raster fallbacks. It's built for
a render → inspect → fix → re-render QA loop, e.g. rendering a final `applyEdits`
output and having a model flag overflow / overlap / leftover text.

```ts
import {
  renderDeckToSvg,
  renderDeckToImages,
  renderPptxToImages,
} from "@textcortex/slidewise";

// SVGs only (no rasteriser needed) — rasterise yourself if you prefer.
const svgs: string[] = await renderDeckToSvg(deck, { slides: [1, 2] });

// Raster bytes. Rasterisation is an injected hook so there's no hard native dep
// — pass a @resvg/resvg-js wrapper (the default tries to import it on demand).
import { Resvg } from "@resvg/resvg-js";
const pngs: Uint8Array[] = await renderDeckToImages(deck, {
  dpi: 150,
  rasterizeSvg: (svg, width) => new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng(),
});

// Render a final applyEdits output directly:
const shots = await renderPptxToImages(await applyEdits(source, plan));
```

`opts`: `slides` (1-based subset), `dpi` (the 1920×1080 canvas scales by
`dpi/96`), `format`, `maxWidth` (thumbnail cap). Output is deterministic (no
animation). The renderer is browser-free and ECharts is loaded on demand, so it
never bloats the editor bundle.

### Font transparency (missing-font warnings)

`parsePptx` stamps `deck.fontUsage: { family, embedded }[]` — every font family
the deck's text uses, flagged whether the source PPTX actually **embeds** it
(`<p:embeddedFontLst>` → a real `ppt/fonts/*` part) or only **references** it (so
it falls back to a system font on viewers that don't ship the brand font). Use it
to warn at generation time:

```ts
const missing = (deck.fontUsage ?? []).filter((f) => !f.embedded);
if (missing.length) warnHost(`not embedded: ${missing.map((f) => f.family).join(", ")}`);
```

This is a read-only diagnostic, distinct from `deck.fonts` (the embeddable
payloads the serializer writes back).

### Generating slides from the template's layouts

`parsePptx` exposes the source template's master layouts on `deck.layouts`.
`addSlideFromLayout(deck, layoutId, opts)` mints a fresh slide bound to one of
them — the unlock for generating a deck with more slides than the template
hand-authored, using the template's own layout variety. The new slide carries
`sourceLayoutId`, so `serializeDeck(deck, { source })` paints its
background / fonts / theme / footer chrome from that layout (not from output
position), exactly like a cloned source slide.

```ts
import {
  parsePptx,
  serializeDeck,
  summarizeLayouts,
  addSlideFromLayout,
} from "@textcortex/slidewise";

const deck = await parsePptx(blob);

// 1. Show a model a compact menu of the available layouts. The shape is
//    structured (not a string) so you can trim it to your context budget.
//    For large templates (e.g. 85 layouts) pass options:
//      summarizeLayouts(deck, { compact: true })  // { id, name?, role, fillable }, no geometry
//      summarizeLayouts(deck, { dedupe: true })   // collapse layouts with the same role + full
//                                                  // slot inventory (text AND chart/image/table);
//                                                  // others → `aliases`. A chart-bearing layout
//                                                  // never collapses into a text-only twin.
//      summarizeLayouts(deck, { compact: true, dedupe: true })  // both
const menu = summarizeLayouts(deck);
// [
//   { id: "slideLayout2", name: "Title and Content", type: "obj",
//     role: "Title and content", fillable: ["title", "body:1"],
//     placeholders: [
//       { key: "title", type: "title", category: "text", fillable: true, x, y, w, h },
//       { key: "body:1", type: "body", idx: 1, category: "text", fillable: true, x, y, w, h },
//     ] },
//   ...
// ]

// 2. Instantiate a slide from the chosen layout, filling its text placeholders.
const next = addSlideFromLayout(deck, "slideLayout2", {
  fills: { title: "Q3 Results", "body:1": "Revenue up 24%" },
});

const pptx = await serializeDeck(next, { source: blob });
```

**The `fills` contract.** `fills` is keyed by placeholder, resolved
most-specific-first: `"type:idx"` (e.g. `"body:1"`), then the bare `"type"`
(e.g. `"title"`), then the bare index as a string. `placeholderKey(ph)` (and
`LayoutSlotSummary.key` from `summarizeLayouts`) gives you the exact key for a
slot. Only **text** placeholders are fillable — `title`, `ctrTitle`,
`subTitle`, `body`, `obj`, and the untyped default (`LayoutSlotSummary.fillable
=== true`, `category === "text"`). Those become editable text elements
positioned per the layout. Non-text slots (pictures, tables, charts, and footer
chrome like date / slide-number / footer) are skipped — inherit them from the
master, or add real `image` / `table` / `chart` elements to the returned slide.
A placeholder with no matching `fills` entry becomes an empty, editable text
box.

#### Authoring slides directly (no `addSlideFromLayout`)

`addSlideFromLayout` is a convenience; the underlying contract is just a slide
shape, so a host that builds deck JSON in another language (e.g. Python) can
author it directly and let `serializeDeck` paint the chrome:

```jsonc
{
  "id": "slide-7",
  "background": "transparent",   // inherit the layout/master/theme background
  "sourceLayoutId": "slideLayout12",
  "elements": [ /* any text / image / chart / table / diagram elements */ ]
}
```

Contract:

- **`sourceLayoutId` alone is enough.** No JS call is required — set it on the
  slide JSON and `serializeDeck(deck, { source })` points the slide at that
  layout's part and paints its background / fonts / theme / footer chrome.
- **Put arbitrary elements on the slide.** It is not limited to elements
  `addSlideFromLayout` produced — your filled text, native charts, generated
  images, tables, and diagrams all land normally, on top of the layout chrome.
- **Place non-text slots yourself from the layout geometry.** For an image /
  chart / table slot, read its geometry from `summarizeLayouts` (every
  placeholder is listed with `category` + `x/y/w/h`, fillable or not) and add a
  real element at that box:

  ```ts
  const slot = summarizeLayouts(deck)
    .find((l) => l.id === "slideLayout12")!
    .placeholders.find((p) => p.category === "picture")!;
  authoredSlide.elements.push({
    id: "img-1", type: "image", src: generatedPhotoDataUrl, fit: "cover",
    x: slot.x, y: slot.y, w: slot.w, h: slot.h, rotation: 0, z: 1,
  });
  ```

- **Background:** keep `"transparent"` to inherit the layout/master background;
  set an explicit hex to override it.
- **`sourceLayoutId` resolution** is by id, resolved from `deck.layouts` (if you
  carried the array) **or** by the `ppt/slideLayouts/<id>.xml` convention
  against the `{ source }` archive — so you don't have to ship the `layouts`
  array. If neither resolves, the slide falls back to the first source layout
  and `serializeDeck` emits a `{ code: "layout-unresolved", slideIndex,
  layoutId }` warning through `onWarning` (see below) rather than failing
  silently.

### Diagrams

`DiagramElement` models a process / timeline / funnel / matrix / cycle / list
as an ordered set of labelled `nodes`, laid out by `kind`. It renders on the
canvas and serialises to a single grouped, editable `<p:grpSp>` of real shapes
+ connectors (not a flat pile of anonymous shapes). The renderer and writer
share `layoutDiagram`, exported so a host preview / server render stays in sync.

```ts
const slide = {
  id: "s1",
  background: "transparent",
  elements: [
    {
      id: "d1",
      type: "diagram",
      kind: "process",
      x: 120,
      y: 240,
      w: 1680,
      h: 320,
      rotation: 0,
      z: 1,
      nodes: [
        { id: "n1", text: "Discover" },
        { id: "n2", text: "Design" },
        { id: "n3", text: "Ship" },
      ],
      // optional: palette?: string[], color?, fontFamily?, fontSize?,
      // and per-node fill? / color? overrides.
    },
  ],
};
```

`kind` is one of `"process" | "timeline" | "funnel" | "matrix" | "cycle" |
"list"`. The JSON shape (`DiagramElement` / `DiagramNode`) is stable — safe to
emit from another language.

**Server-side rendering.** `layoutDiagram(el)` is **pure and DOM-free** (only
box/arrow arithmetic — no `window` / `document` / `canvas`), the same guarantee
`buildChartOption` gives for charts, and it's committed to staying that way. A
host QA renderer can draw a diagram to SVG/PNG without a browser by walking the
primitives:

```ts
import { layoutDiagram } from "@textcortex/slidewise";

for (const p of layoutDiagram(el)) {
  if (p.kind === "box") drawRect(p.x, p.y, p.w, p.h, p.fill, p.text, p.textColor);
  else drawArrow(p.x1, p.y1, p.x2, p.y2, p.stroke, p.arrow);
}
```

Coordinates are local to the element box (`0..w` × `0..h`); offset by the
element's `x` / `y` to place them on the slide.

## Theming

Slidewise exposes its surface colors and chrome metrics as CSS custom
properties, all namespaced under `--slidewise-*`. Override any subset on the
`style` prop of `<Slidewise.Root>` (or in a stylesheet that targets the
`.slidewise-editor` class) to retheme without forking.

```tsx
<Slidewise.Root
  style={{
    "--slidewise-bg-app": "#0a0a0e",
    "--slidewise-bg-rail": "#1c1c22",
    "--slidewise-bg-topbar": "linear-gradient(180deg, #1c1c22, #14141a)",
    "--slidewise-radius": "8px",
  } as React.CSSProperties}
>
  ...
</Slidewise.Root>
```

For the most-customized surfaces there's also a typed prop equivalent:

```tsx
<Slidewise.Root
  surfaces={{
    app: "#0a0a0e",
    rail: "#1c1c22",
    canvasFrom: "#16181c",
    canvasTo: "#0f0f12",
    button: "transparent",
    buttonHover: "rgba(255,255,255,0.06)",
  }}
>
```

### Public CSS variables

| Variable | What it controls | Default |
|---|---|---|
| `--slidewise-radius` | Primary chrome button border-radius. | `10px` |
| `--slidewise-bar-bg` | Top-bar background (alias kept for v1.1 hosts). | `var(--app-bg)` |
| `--slidewise-accent` | Accent color used for focus rings, the Smart pill, hover affordances. | `var(--accent)` |
| `--slidewise-bg-app` | Outermost app shell background. | `var(--app-bg)` |
| `--slidewise-bg-topbar` | Top bar surface. | `var(--app-bg)` |
| `--slidewise-bg-rail` | Slide-rail container. | `var(--rail-bg)` |
| `--slidewise-bg-rail-item` | Idle slide-rail item. | `transparent` |
| `--slidewise-bg-rail-item-active` | Active/selected rail item. | `var(--accent-soft)` |
| `--slidewise-bg-canvas-frame` | Frame around the canvas. | `transparent` |
| `--slidewise-bg-canvas-from` / `--slidewise-bg-canvas-to` | Canvas gradient stops. | `var(--canvas-bg-from)` / `var(--canvas-bg-to)` |
| `--slidewise-bg-bottom-toolbar` | Floating tool selector. | `var(--toolbar-bg)` |
| `--slidewise-bg-right-panel` | `<Slidewise.RightPanel>` surface. | `var(--rail-bg)` |
| `--slidewise-bg-menu` / `--slidewise-bg-tooltip` / `--slidewise-bg-popover` / `--slidewise-bg-dialog` | Floating UI surfaces. | `var(--menu-bg)` |
| `--slidewise-bg-slide` | Slide paper. | `#ffffff` |
| `--slidewise-bg-selection` | Selection overlay tint. | `var(--accent-soft)` |
| `--slidewise-bg-hover` / `--slidewise-bg-active` | Interactive state tints. | `var(--hover)` / `var(--active)` |
| `--slidewise-bg-input` | Form input background. | `var(--input-bg)` |
| `--slidewise-bg-button` / `--slidewise-bg-button-hover` | Chrome button surfaces. | `transparent` / `var(--hover)` |
| `--slidewise-bg-pill` | Smart pill background. | `var(--smart-grad)` |
| `--slidewise-bg-unsaved-badge` | Unsaved-changes badge. | `rgba(232, 80, 76, 0.12)` |

The library also ships a smaller `--surface-*` token family for ad-hoc
card/panel surfaces (`--surface-bg`, `--surface-ring`, `--surface-shadow`,
plus their `-hover` variants) and a `.slidewise-surface` utility class that
applies all three together.

## Localization

Every user-visible string in the chrome is overridable through the `labels`
prop:

```tsx
<Slidewise.Root
  labels={{
    save: { idle: "Speichern", saving: "Wird gespeichert…", saved: "Gespeichert" },
    play: "Wiedergabe",
    export: "Exportieren",
    undo: "Rückgängig",
    redo: "Wiederherstellen",
    themeToggle: { toDark: "Dunkler Modus", toLight: "Heller Modus" },
    smart: "Smart",
    unsavedBadge: "Nicht gespeicherte Änderungen",
    fileLoadError: (msg) => `Datei konnte nicht geöffnet werden: ${msg}`,
    fileLoading: "Wird geladen…",
  }}
>
```

Missing entries fall back to the English defaults (`DEFAULT_LABELS`).

## Releasing

Versioning and publishing run through
[changesets](https://github.com/changesets/changesets).

```bash
pnpm changeset            # describe the impact of your change
pnpm version-packages     # bump versions + update CHANGELOG (CI usually does this)
pnpm release              # build + publish (CI does this on merge)
```

CI (`.github/workflows/release.yml`) opens a "Version Packages" PR whenever
there are pending changesets and publishes to npm when that PR merges.

## Repo layout

- `src/SlidewiseEditor.tsx` / `src/SlidewiseFileEditor.tsx` — public entry components
- `src/components/editor/` — top bar, slide rail, canvas, panels
- `src/lib/pptx/` — PPTX import (`pptxToDeck`) and export (`deckToPptx`)
- `src/lib/schema/` — `Deck` schema versioning + migrator
- `src/lib/types.ts` — `Deck` / `Slide` / `SlideElement` shapes (the contract)
