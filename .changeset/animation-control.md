---
"@textcortex/slidewise": minor
---

**Animation control.** Hosts can now retune the editor's motion or disable it entirely without forking.

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
