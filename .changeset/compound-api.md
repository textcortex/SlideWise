---
"@textcortex/slidewise": minor
---

Add a compound-component API so hosts can replace, wrap, omit, or reorder any region of the editor without forking.

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
