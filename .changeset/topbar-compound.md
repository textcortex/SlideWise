---
"@textcortex/slidewise": minor
---

**TopBar decomposed into compound subparts, with `hide` and store hooks for everything else.**

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
  useEditor,         // generic selector — pass any state → slice fn
  useEditorStore,    // raw store ref, for manual subscribe / getState
  useSlides,         // Slide[]
  useActiveSlide,    // Slide
  useActiveSlideId,  // string
  useSelection,      // string[] of selected element ids
  useSelectedElements,
  useTheme,          // "light" | "dark"
  useZoom,           // number
  usePlaying,        // boolean
  useDirty,          // boolean — reactive dirty flag
  useHistory,        // { canUndo, canRedo, undoSize, redoSize }
} from "@textcortex/slidewise";
```

These are minimal wrappers over the existing zustand store — internal `useEditor` and `useEditorStore` are now part of the public API.
