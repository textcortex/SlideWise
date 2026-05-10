---
"@textcortex/slidewise": minor
---

**Fix undo/redo + add history APIs.** The bug: `updateElement` and `setTitle` mutated the deck without pushing a history step, so pressing Undo after typing or moving an element walked back to the previous *structural* change (last add/delete) — usually nothing visible, matching the host repro.

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
