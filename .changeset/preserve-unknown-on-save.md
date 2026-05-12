---
"@textcortex/slidewise": minor
---

**Stop silently dropping `UnknownElement` on save.**

Slidewise's importer wraps OOXML it can't model — charts, SmartArt, group shapes, OLE, math, complex tables — into an `UnknownElement` carrying the raw XML (`ooxmlXml`). Until this release the serializer ignored that XML and emitted nothing for unknown elements, so every parse → save cycle silently destroyed those parts of the deck.

The serializer now post-processes the zip pptxgenjs writes and injects every preserved fragment back into the matching slide's `<p:spTree>`. Media and relationships referenced by the fragment (chart XML, image data, SmartArt parts, …) are pulled from the original archive and copied into the output, with rIds renumbered to avoid clashes and target paths uniquely prefixed (`slidewise_preserved_N_…`) to avoid colliding with media pptxgenjs allocated.

- `parsePptx` now also accepts `Uint8Array` (in addition to `Blob` and `ArrayBuffer`) so the server-side `serialize → arrayBuffer → parsePptx` loop works without an extra allocation.
- The original archive bytes are stashed on the returned `Deck` (non-enumerable) so `serializeDeck` can reach them later. Hosts that synthesise a `Deck` from scratch are unaffected — preservation only runs when a source archive is present *and* the deck has `UnknownElement` content.
- New regression test in `roundtrip.test.ts` covers the full
  parse → modify → serialize → re-parse loop on a synthetic deck with a SmartArt diagram fragment.

For users this fixes silent data loss on every "Save" with a deck that contains charts / SmartArt / group shapes / video / audio / complex tables. The post-process is a no-op when the deck has no unknown elements, so there's no overhead for clean decks.
