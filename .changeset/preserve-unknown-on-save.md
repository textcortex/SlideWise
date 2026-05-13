---
"@textcortex/slidewise": minor
---

**Stop silently dropping `UnknownElement` on save.**

Slidewise's importer wraps OOXML it can't model — charts, SmartArt, group shapes, OLE, math, complex tables — into an `UnknownElement` carrying the raw XML (`ooxmlXml`). Until this release the serializer ignored that XML and emitted nothing for unknown elements, so every parse → save cycle silently destroyed those parts of the deck.

The serializer now post-processes the zip pptxgenjs writes and injects every preserved fragment back into the matching slide's `<p:spTree>`. Media and relationships referenced by the fragment (chart XML, image data, SmartArt parts, …) are pulled from the original archive and copied into the output, with rIds renumbered to avoid clashes and target paths uniquely prefixed (`slidewise_preserved_N_…`) to avoid colliding with media pptxgenjs allocated. `r:*="rIdN"` attributes are matched generically so the fix covers slide / drawing references (`r:id` / `r:embed` / `r:link`), chart references (`r:id`), and SmartArt references (`r:dm` / `r:cs` / `r:qs` / `r:lo`).

### New API: `serializeDeck(deck, { source })`

`serializeDeck` now accepts an optional `source` (`Blob | ArrayBuffer | Uint8Array`) — the original PPTX bytes — so preservation runs reliably even when the deck object has been cloned, spread, snapshot, or rehydrated from `localStorage` (i.e. anything that strips non-enumerable attachments). Hosts running an editor where the deck flows through immutable state should pass `source` explicitly:

```ts
const buffer = await file.arrayBuffer();
const deck = await parsePptx(buffer);
// …user edits…
const blob = await serializeDeck(deck, { source: buffer });
```

The `parsePptx → serializeDeck` happy path (no state in between, no editor) keeps working unchanged via a non-enumerable attachment fallback. `parsePptx` also accepts `Uint8Array` directly now so the server-side round-trip works without extra allocations.

### What this fix *doesn't* cover

This release preserves OOXML that the importer couldn't model. It does **not** retrofit pptxgenjs to emit Slidewise's newer parser fields (CSS `radial-gradient` fills, `ShapeElement.path` custom geometries, `TextElement.backingPath` / `background` / `padding`, `TableElement.borderColor`). Decks that exercise those fields (like brand chapter slides with gradient panels, custGeom logos, or tinted body placeholders) still lose fidelity on `Save` until the serializer learns to write those as raw OOXML — tracked as a follow-up.

### Behaviour summary

- Decks with charts / SmartArt / group shapes / OLE / math / complex tables: **round-trip cleanly now**.
- Decks built entirely from text + simple shapes + raster images: unchanged (no overhead — preservation is a no-op when there are zero unknowns).
- Decks heavy on imported brand visuals (custGeom, gradient fills, layout-derived backings): still partially lossy on save. Use `serializeDeck` with explicit `source` so at least the preservation path runs for any `UnknownElement` you do have.
