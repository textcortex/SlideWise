---
"@textcortex/slidewise": minor
---

**i18n + a11y + expanded theming surface.** Three host-feedback items batched together since they all live in the same context-and-CSS layer.

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
