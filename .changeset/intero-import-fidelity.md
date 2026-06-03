---
"@textcortex/slidewise": patch
---

fix(pptx): import-fidelity fixes for think-cell / brand-template decks

- Skip shapes flagged `hidden="1"` (e.g. think-cell "do not delete" data objects)
- Render run-level text highlight (`<a:rPr><a:highlight>`) end to end
- Apply `cap="all"`/`"small"` (including when inherited from a placeholder list style) as a render-time letter-case transform
- Derive font weight from weight-named families ("Gilroy ExtraBold" → 800, "… Medium" → 500, …) so substitute fonts render at the right heaviness
- Tables: per-cell fills, text colours, per-side borders, proportional column widths / row heights, cell spans (`gridSpan`/`hMerge`/`rowSpan`/`vMerge`), per-cell vertical anchor, and rich per-cell runs (highlight / bold / ✓ glyphs / bullet line breaks). Unfilled cells stay transparent instead of inheriting a sibling fill
- Map Wingdings bullet glyphs to Unicode (`ü`→✓, `q`→☐, `§`→▪, …)
- Bullets: repeat a character bullet across in-paragraph line breaks, suppress the glyph on empty paragraphs, and trim trailing empty paragraphs
- Synthesise block-arrow paths (`down`/`up`/`left`/`rightArrow`) and resolve outline colour from `<p:style><a:lnRef>` so dashed/outlined shapes draw
- Keep a text-bearing preset or custom-geometry shape's fill, border, and corner radius behind its text (roundRect callouts, outlined chevrons)
- Honour `<a:bodyPr><a:spAutoFit>` no-wrap for short single-line labels; skip the arrow-tip text inset on no-fill label shapes
- Render per-paragraph hanging-indent bullets as one block per line so multi-line items align correctly
