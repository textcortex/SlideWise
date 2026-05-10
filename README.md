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
