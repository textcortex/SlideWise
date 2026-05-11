---
"@textcortex/slidewise": minor
---

**`canvas` config + host-driven slide background.** New prop on `<Slidewise.Root>` / `<SlidewiseEditor>` / `<SlidewiseFileEditor>` that lets hosts tame the viewport so a bold deck fill doesn't paint the entire workspace.

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

Pair with the existing `surfaces` prop (or the `--slidewise-bg-canvas-from`/`-canvas-to` CSS tokens) to control the backdrop *around* the slide. Together they produce the centered-card aesthetic with a host-controlled backdrop.

### What's configurable

| Key | Default | Notes |
|---|---|---|
| `padding` | `{ x: 32, y: 148 }` | Pass a number for uniform padding. Used in the auto-fit calc and as visible whitespace around the slide. |
| `fitMode` | unchanged store value | `"fit"` / `"fill"` / `"manual"`. Applied once on mount. |
| `defaultZoom` | unchanged store value | Initial absolute zoom (1 = 100%). Clamped to [0.1, 4]. |
| `slideRadius` | `8` | Slide paper border-radius. |
| `slideShadow` | `var(--slide-shadow)` | Slide paper box-shadow. |
| `forceSlideBackground` | — | Hard override of `slide.background`. |
| `resolveSlideBackground` | — | Per-slide function; returning `undefined` falls through to `slide.background`. |

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
