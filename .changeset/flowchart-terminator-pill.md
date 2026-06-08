---
"@textcortex/slidewise": patch
---

fix(pptx): import `flowChartTerminator` as a rounded pill, not a sharp rect

The `flowChartTerminator` preset is a stadium/pill — a rectangle with fully
rounded ends — and is a common "Learn More" button shape. It was mapped to a
plain `rect`, so buttons imported with hard square corners. It now maps to a
rounded shape with a corner radius of half the shorter side, giving the
semicircular ends PowerPoint draws.
