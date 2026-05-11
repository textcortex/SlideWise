---
"@textcortex/slidewise": minor
---

**Extended imperative API + lifecycle callbacks.** Hosts can now drive navigation, zoom, and slide CRUD programmatically, and observe more of the editor's lifecycle without subscribing to the store directly.

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
