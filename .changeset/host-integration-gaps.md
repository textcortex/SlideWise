---
"@textcortex/slidewise": minor
---

Close the host-integration gaps surfaced by first platform-side use.

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
