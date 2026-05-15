---
"@textcortex/slidewise": minor
---

Add `mode="preview" | "edit"` preset and granular customization props for hosts that want a viewer-only embed or a custom side-rail layout.

**`SlidewiseEditor` / `SlidewiseFileEditor`**

- `mode="preview"` — fully inert viewer chrome: top bar shows only the title and play button (Save / Undo / Redo / ThemeToggle / Export hidden), the side rail's "New Slide" button is hidden, the bottom tool selector is hidden, the Smart pill is hidden, and `readOnly` is set. Per-flag props still override the preset.
- `hideAddButton` — hide the side rail's "New Slide" button.
- `hideSlideNumbers` — hide the per-thumbnail number badge.
- `hideSmart` — hide the leading Smart pill in the top bar title.

**`readOnly` is now enforced at the canvas**

Previously `readOnly` only hid chrome (Save / Undo / Redo / AddButton) but the canvas itself still allowed selection, drag, text edit, resize handles, and keyboard shortcuts. With this change, `readOnly` (and therefore `mode="preview"`) blocks every canvas-level mutation entry point: keyboard shortcuts (Delete / Backspace / Enter / Escape / Cmd-Z / Cmd-Y / Arrow nudge), pointer-down on the surface and elements, double-click to text-edit, and drag-to-create. Selection chrome (`SelectionFrame`, `FloatingToolbar`) and the grid overview's "+ New Slide" tile are also skipped.

**`SlideRail`**

- `hideNumbers` — hide all per-thumbnail number badges from the default arrangement.
- `thumbnailWidth` — pixel width for each slide thumbnail (defaults to 132). Pair with the rail's `width` to build wide preview-style sidebars.

**`SlideRail.List`**

- `hideNumber` — same flag, exposed at the subpart for hosts using deeper compound composition.
- `thumbnailWidth` — forwarded to the default `<Thumbnail />`.

**`TopBar` / `TopBar.Title`**

- `hideSmart` — hide the leading Smart pill, both on the default `<TopBar />` arrangement and the `<TopBar.Title />` subpart.
