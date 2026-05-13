---
"@textcortex/slidewise": patch
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

### Per-element source-XML preservation

The serializer also captures the verbatim `<p:sp>`/`<p:pic>`/`<p:cxnSp>`/`<p:graphicFrame>` XML for every imported element with explicit geometry (`<a:xfrm>`). On save, each unedited element is re-emitted from its source XML — bypassing pptxgenjs entirely — so CSS `radial-gradient` fills, `<a:custGeom>` paths, brand wordmarks, and any other native-typed element with fields pptxgenjs doesn't speak survive saves with zero loss. The serializer compares the current element to a snapshot taken at parse time; edited elements still route through pptxgenjs (best-effort), pristine ones replay verbatim.

The preserved fragments are injected at the start of `<p:spTree>` (decoration layer, low z); `UnknownElement` payloads stay at the end (high z, content layer). Per-fragment rels resolve against whichever archive entry the element originated from (slide / layout / master), so layout-derived gradient panels and brand marks bring their referenced media along correctly.

### Behaviour summary

- Decks with charts / SmartArt / group shapes / OLE / math / complex tables: **round-trip cleanly**.
- Decks heavy on imported brand visuals (gradient fills, custGeom logos / icons, layout-derived decoration): **also round-trip cleanly** as long as the host passes `source` to `serializeDeck`. Unedited elements replay their source XML verbatim no matter how many save cycles they go through.
- Decks built entirely from text + simple shapes + raster images: unchanged (no overhead — both preservation paths no-op when there's nothing to preserve).

### Known gaps

`TextElement.backingPath` / `background` (baked from overridden layout placeholders) still lose their visual on save — those fields don't have an isolated source `<p:sp>` to replay, and re-injecting the layout placeholder introduces stub text and geom-resolution issues on re-parse. Tracked as a follow-up.
