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
fonts. If that chrome can't be preserved — e.g. the source's slide size is
unreadable — it falls back to generic chrome and reports it through an optional
diagnostics sink so the host can surface the degradation rather than ship a
silently off-brand deck:

```ts
await serializeDeck(deck, {
  source,
  onWarning: (w) => {
    if (w.code === "chrome-skipped") notifyHost(w.message);
  },
});
```

`migrate()` runs every external deck (PPTX import, JSON import, localStorage
hydration, host props) through the schema migration chain so the rest of the
editor only sees current-shape decks. It throws if the input was written by a
newer Slidewise than the host has installed — pin the version range you can
support.

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
//    structured (not a string) so you can trim it to your context budget —
//    e.g. keep only { id, role, fillable } and drop geometry.
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
    },
  ],
};
```

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
