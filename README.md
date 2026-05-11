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

`migrate()` runs every external deck (PPTX import, JSON import, localStorage
hydration, host props) through the schema migration chain so the rest of the
editor only sees current-shape decks. It throws if the input was written by a
newer Slidewise than the host has installed — pin the version range you can
support.

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
