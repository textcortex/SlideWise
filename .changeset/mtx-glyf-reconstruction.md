---
"@textcortex/slidewise": minor
---

Complete the in-browser MTX decoder: TrueType-glyf font reconstruction.

Milestone 2 decoded CFF/OTTO embedded fonts. This adds TrueType-outline fonts: MTX stores `glyf` in Compact Table Format (the WOFF2 triplet point encoding) and strips `loca`. `ctf-glyf.ts` reconstructs a standard `glyf` + `loca` and reassembles the sfnt with recomputed table checksums + `head.checkSumAdjustment` (so strict browser sanitizers accept it). TrueType hinting instructions are dropped (browsers ignore them; unhinted outlines render identically on screen). Simple and composite glyphs are handled.

Verified against `eon-deck.pptx`: all 5 embedded EON fonts now decode in-browser — the 4 CFF EON Brix Sans weights (OTTO) and the TrueType EON Office Head (FontForge confirms the font name and correct glyph outlines). No CDN, no `fontRegistry`, no network: embedded PPTX fonts render exactly and automatically on import.
