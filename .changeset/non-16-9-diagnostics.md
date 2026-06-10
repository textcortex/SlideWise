---
"@textcortex/slidewise": minor
---

Machine-readable serialization diagnostics (P2 / B3). `serializeDeck` now
accepts `SerializeOptions.onWarning`, a callback invoked with a structured
`SerializeWarning` when the output degrades. The key case is
`"chrome-skipped"` — emitted when a `source` template's masters / layouts /
theme / fonts can't be carried over because its slide size is unreadable, so
the deck falls back to generic chrome. Hosts can now detect and surface the
degradation instead of only seeing a console line. (Non-16:9 sizing for 4:3 /
16:10 / custom templates already drives the output slide size; this adds the
escape-hatch signal when it can't.)
