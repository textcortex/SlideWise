# @textcortex/slidewise

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
