---
"@textcortex/slidewise": minor
---

feat(pptx): support PowerPoint templates (.potx)

`.potx` and `.pptx` share an identical OOXML package; only the main part's
content type in `[Content_Types].xml` differs. This adds first-class template
support across import and export:

- `parsePptx` already parsed `.potx` transparently (it reads parts by path, not
  by content type) — now the rest of the pipeline preserves template-ness.
- New exported `isPptxTemplate(blob)` detects a template by inspecting the
  package content type rather than trusting a filename extension (a mis-named
  `.pptx` that is really a template is detected correctly).
- `serializeDeck` gains an `asTemplate?: boolean` option. When omitted,
  template-ness is inherited from the source archive, so a parsed `.potx`
  round-trips back to a `.potx`; pass `true`/`false` to force the output kind.
  Templates are emitted with the `…presentationml.template.main+xml` main-part
  content type and the `.potx` MIME type.
