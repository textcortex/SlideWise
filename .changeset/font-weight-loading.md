---
"@textcortex/slidewise": patch
---

fix(fonts): load the real font weights a deck uses, so bold text isn't thin

The editor requested Google Fonts with a bare `family=Montserrat`, which loads
only the regular (400) face. A bold title (e.g. a 700-weight "GLANCE") then had
no bold face to bind to and rendered thin.

`collectFontUsage` now gathers the actual numeric weights each family uses
(recursing into groups and per-run overrides), and the Google Fonts request asks
for those weights — `family=Montserrat:wght@400;700` — so the genuine bold face
loads. Only deck-used weights are requested (plus 400 as the base) to avoid a
font that lacks a weight failing the whole request.

Note: `collectFontFamilies` is retained but `ensureGoogleFontsLoaded` /
`buildGoogleFontsHref` now take the weight-aware usage map.
