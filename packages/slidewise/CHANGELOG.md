# @textcortex/slidewise

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
