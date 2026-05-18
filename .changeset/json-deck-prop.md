---
"@textcortex/slidewise": minor
---

Add `jsonDeck` prop and expose `resolveJsonDeck` — the AI-facing entry point for feeding model-generated decks into the editor.

**`SlidewiseEditor` / `Slidewise.Root`**

- New top-level `jsonDeck?: Deck | string` prop. Pass either a parsed `Deck` object or a JSON string and Slidewise will `JSON.parse` (when needed) and run the value through `migrate()` before mounting — no manual normalisation required. Takes precedence over `deck` when both are provided.
- `deck` is now optional; one of `deck` or `jsonDeck` must be supplied. Existing callers passing only `deck` are unaffected.

**Why**

This is the contract LLMs target when generating slides. The exported `Deck` TypeScript type is the JSON schema: hosts can prompt their model to emit a `Deck`-shaped object (or stringified JSON) and pipe it straight into `<SlidewiseEditor jsonDeck={...} />` without writing glue.

**New export: `resolveJsonDeck(input: Deck | string): Deck`**

Same parse + migrate helper Slidewise uses internally. Use it to validate AI output before passing it to the editor, or when building tools that emit `Deck` JSON outside of React.

```tsx
import { SlidewiseEditor, resolveJsonDeck } from "@textcortex/slidewise";

// Pass JSON directly:
<SlidewiseEditor jsonDeck={aiGeneratedJsonString} />

// Or validate first:
const deck = resolveJsonDeck(aiGeneratedJsonString);
<SlidewiseEditor deck={deck} />
```
