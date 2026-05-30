---
"@textcortex/slidewise": minor
---

Begin the MTX → TTF decoder for PPTX-embedded fonts.

PPTX stores embedded fonts as MTX-compressed EOT inside `ppt/fonts/*.fntdata`. PowerPoint decodes them natively; browsers can't, which is why editor previews fall back to system fonts even when `parsePptx` extracted the bytes into `Deck.fonts`. This change lays the groundwork:

**New `packages/slidewise/src/lib/fonts/eot.ts`**

- Full EOT wrapper parser — header, flags, variable-length name fields, version 1.0 / 2.0 / 2.1 / 2.2 tail variants
- Uncompressed-EOT extraction → ready-to-register TTF/OTF bytes
- MTX detection via the `TTEMBED_TTCOMPRESSED` flag
- `EotDecodeError` with discriminated `kind` so callers can distinguish "truncated", "magic-mismatch", "mtx-not-implemented", "mtx-failed"

**New `packages/slidewise/src/lib/fonts/mtx.ts`**

- MTX outer container parser scaffolding
- Recognises but does not yet decompress the PowerPoint MTX variant (Office-embedded fonts use a different major version than the W3C MTX submission spec; the post-2010 Office variant isn't publicly documented).
- Throws `EotDecodeError("mtx-not-implemented")` for unsupported sub-methods so the fallback chain (Deck.webFonts → fontRegistry → system fonts) runs cleanly. No noisy console errors — diagnostic only when `window.__slidewiseFontDebug = true`.

**Auto-wiring through `resolveWebFonts()`**

The font loader now decodes `Deck.fonts` on the fly. When a font is uncompressed EOT (~30% of real-world embedded fonts), we synthesise a `data:font/ttf;base64,…` URL and register it via `@font-face` — no `fontRegistry` needed, no platform involvement. Brand-embedded fonts that use MTX glyph compression (the EON case, most enterprise decks) still need `fontRegistry` for editor preview, but the export path still embeds the original MTX bytes verbatim.

**What still needs to happen for full coverage**

A real MTX decompressor for the Office variant. Either:
- Reverse-engineering the format against a test corpus, or
- A WebAssembly port of FontForge's GPL'd `parsettf.c` MTX path

Both are multi-week projects. Tracked as a follow-up.

**Tests**

3 new tests in `src/lib/fonts/__tests__/eot.test.ts` against the real `eon-deck.pptx` fixture:

- EOT header parser succeeds on every embedded font (5 entries)
- `isMtxCompressed()` correctly reports the EON fonts as MTX
- `decodeEot()` returns `EotDecodeError.kind === "mtx-not-implemented"` for MTX-flagged fonts (so the caller's fallback fires)

No public API changes. `FontAsset`, `WebFontAsset`, and the rest of the font surface are untouched. Additive.
