---
"@textcortex/slidewise": minor
---

**SlideRail compound primitives.** Decompose the slide rail into named subparts so hosts can inject per-row UI (context menus, status badges, duplicate buttons), reorder elements, or replace the header / add-button without forking.

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
