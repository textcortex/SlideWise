---
"@textcortex/slidewise": patch
---

**Fix: chrome / EMF / slide-bg preservation getting silently dropped after the first edit.**

1.12.0 shipped the verbatim master / layout / theme / font / EMF / slide-bg preservation pipeline — but it never fired in practice. The pipeline relied on a non-enumerable `__slidewiseSourcePptx` attachment on the deck, which `structuredClone` (used by the store's `snap()` for history) AND every `{ ...deck, ... }` reducer spread silently strips. So the moment a user edited anything, `serializeDeck` had no source bytes to inject from and fell back to pptxgenjs's lossy emitter — exactly the regression the prior PR was supposed to fix.

Fix: `parsePptx` now stamps the deck with an enumerable `Deck.sourcePptxId` and stashes the source bytes in a module-level cache keyed by that id. `serializeDeck` looks the bytes up by id when the caller didn't pass `options.source`. The id is a plain string field, so it survives `structuredClone`, object spread, and `JSON.parse(JSON.stringify(deck))` — any reducer-driven host (Zustand, Redux, useState, Immer) keeps the preservation pipeline alive across edits.

The cache is in-memory only; for cross-session round-trips (page reload → rehydrate from localStorage) hosts still need to re-attach source bytes via `serializeDeck(deck, { source })`.

New regression test in `chrome-preservation.test.ts` mirrors the broken scenario — `parsePptx` → `structuredClone` + spread → `serializeDeck()` with no explicit source — and asserts all 28 eon-deck layouts and 5 embedded fonts still make it into the saved file.
