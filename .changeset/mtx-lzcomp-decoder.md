---
"@textcortex/slidewise": minor
---

Decode CFF embedded PowerPoint fonts in-browser via a clean-room MTX (MicroType Express) decompressor.

PPTX embeds fonts as MTX-compressed EOT in `ppt/fonts/*.fntdata`. Browsers can't decode MTX, so editor previews fell back to system fonts even though the importer extracts the bytes into `Deck.fonts`. This ports the W3C MTX submission (Appendix C: BITIO / AHUFF / LZCOMP) to TypeScript so the editor renders the **real embedded typeface** — no CDN, no `fontRegistry`, no network.

- `lib/fonts/lzcomp.ts` — full LZCOMP decompressor: MSB-first bit reader, adaptive Huffman (complete-tree init + priming + sibling-rule update/swap), 7168-byte preload dictionary, copy-model loop.
- `lib/fonts/mtx.ts` — MTX v3 container parse + `decompressMtx`: for CFF/OTTO fonts, block 1 decompresses to the complete font and is returned directly.
- `lib/fonts/eot.ts` — locates FontData as the trailing `fontDataSize` bytes (spec-correct); routes compressed payloads through the MTX decoder.
- `resolveWebFonts` / `fontAssetToWebFont` wrap the decoded bytes as a `data:font/otf` URL, so embedded CFF fonts render automatically on import.

**Verified** against `eon-deck.pptx`: the 4 CFF EON Brix Sans weights decode to valid OTTO fonts (FontForge confirms "EON Brix Sans Regular"). TrueType-glyf fonts (EON Office Head) fall back with `mtx-not-implemented` — CTF glyf reconstruction is the remaining milestone. Export is unchanged (original `.fntdata` bytes still round-trip to PPTX).
