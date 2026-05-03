import type { Deck, TextElement } from "@/lib/types";

/**
 * Best-effort web-font loader for typefaces referenced inside a Deck.
 *
 * PPTX files commonly reference typefaces that are NOT installed on the
 * viewer's machine. The cleanest fix would be to extract the embedded font
 * binaries from `ppt/fonts/*.fntdata`, but those use Microsoft's EOT format
 * with MTX compression, which has no practical browser-side decoder.
 *
 * As a pragmatic alternative we ask Google Fonts for every unique typeface
 * name we see — Google's CSS API silently returns 404 for unknown families,
 * so the worst case is the browser's normal font fallback. Most popular
 * typefaces (Coda, Quattrocento Sans, Roboto, Inter, Lato, Montserrat, …)
 * round-trip cleanly this way.
 */

// System / web-safe families we never try to fetch from Google Fonts.
const SYSTEM_FAMILIES = new Set(
  [
    "inter",
    "system-ui",
    "sans-serif",
    "serif",
    "monospace",
    "arial",
    "helvetica",
    "helvetica neue",
    "times",
    "times new roman",
    "georgia",
    "courier",
    "courier new",
    "verdana",
    "tahoma",
    "trebuchet ms",
    "geist",
    "geist variable",
    "geist mono",
    "geist mono variable",
  ].map((s) => s.toLowerCase())
);

/** Element IDs we manage in <head> — one per editor host. */
const STYLESHEET_ID_PREFIX = "caracas-google-fonts-";

export function collectFontFamilies(deck: Deck): string[] {
  const families = new Set<string>();
  for (const slide of deck.slides) {
    for (const el of slide.elements) {
      if (el.type !== "text") continue;
      const t = el as TextElement;
      if (t.fontFamily) families.add(t.fontFamily);
      if (t.runs) {
        for (const r of t.runs) {
          if (r.fontFamily) families.add(r.fontFamily);
        }
      }
    }
  }
  return [...families];
}

export function buildGoogleFontsHref(families: string[]): string | null {
  const candidates = families
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .filter((f) => !SYSTEM_FAMILIES.has(f.toLowerCase()));
  if (!candidates.length) return null;
  // Google's css2 endpoint accepts `family=Name+With+Spaces` repeated.
  const params = candidates
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

/**
 * Inject a <link rel="stylesheet"> for the given families. Idempotent per
 * `instanceId` — calling again with a different family set replaces the
 * previous link. Returns a disposer.
 */
export function ensureGoogleFontsLoaded(
  instanceId: string,
  families: string[]
): () => void {
  if (typeof document === "undefined") return () => {};
  const id = STYLESHEET_ID_PREFIX + instanceId;
  const existing = document.getElementById(id) as HTMLLinkElement | null;
  const href = buildGoogleFontsHref(families);
  if (!href) {
    if (existing) existing.remove();
    return () => {};
  }
  if (existing && existing.href === href) {
    return () => existing.remove();
  }
  const link = existing ?? document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  link.crossOrigin = "anonymous";
  if (!existing) document.head.appendChild(link);
  return () => link.remove();
}
