# @textcortex/slidewise

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
