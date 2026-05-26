import type { Deck, TextElement, WebFontAsset } from "@/lib/types";

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
const STYLESHEET_ID_PREFIX = "slidewise-google-fonts-";

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

export function buildGoogleFontsHref(
  families: string[],
  excluded: Set<string> = new Set()
): string | null {
  const candidates = families
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
    .filter((f) => !SYSTEM_FAMILIES.has(f.toLowerCase()))
    .filter((f) => !excluded.has(f.toLowerCase()));
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
  families: string[],
  excludedFamilies: Set<string> = new Set()
): () => void {
  if (typeof document === "undefined") return () => {};
  const id = STYLESHEET_ID_PREFIX + instanceId;
  const existing = document.getElementById(id) as HTMLLinkElement | null;
  const href = buildGoogleFontsHref(families, excludedFamilies);
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

/**
 * Inject `@font-face` rules for a `WebFontAsset[]`. Sources are loaded
 * directly by the browser (TTF / OTF / WOFF / WOFF2 or a `data:` URL).
 *
 * `WebFontAsset` is for the in-editor preview only — the PPTX exporter
 * doesn't consult it; it consults `Deck.fonts` (the embedded payload).
 * The two live side-by-side so AI-authored decks can ship a renderable
 * font for the editor and the obfuscated MTX/EOT payload PowerPoint
 * needs, without one stomping the other.
 *
 * Idempotent per `instanceId`. Returns a disposer.
 */
const WEB_FONTS_STYLE_ID_PREFIX = "slidewise-web-fonts-";

export function ensureWebFontsLoaded(
  instanceId: string,
  webFonts: WebFontAsset[]
): () => void {
  if (typeof document === "undefined") return () => {};
  const id = WEB_FONTS_STYLE_ID_PREFIX + instanceId;
  const existing = document.getElementById(id) as HTMLStyleElement | null;
  if (!webFonts.length) {
    if (existing) existing.remove();
    if (
      typeof window !== "undefined" &&
      (window as unknown as { __slidewiseFontDebug?: boolean })
        .__slidewiseFontDebug
    ) {
      console.debug("[slidewise/fonts] webfonts cleared for", instanceId);
    }
    return () => {};
  }
  const css = webFonts.map(webFontToFontFace).filter(Boolean).join("\n");
  if (!css) {
    if (existing) existing.remove();
    return () => {};
  }
  const style = existing ?? document.createElement("style");
  style.id = id;
  if (style.textContent !== css) style.textContent = css;
  if (!existing) document.head.appendChild(style);
  if (
    typeof window !== "undefined" &&
    (window as unknown as { __slidewiseFontDebug?: boolean })
      .__slidewiseFontDebug
  ) {
    console.debug(
      "[slidewise/fonts] injected",
      webFonts.length,
      "@font-face rules for",
      instanceId,
      webFonts.map((f) => `${f.family}/w${f.weight ?? 400}/i${f.italic ?? 0}`)
    );
  }
  return () => style.remove();
}

function webFontToFontFace(f: WebFontAsset): string {
  if (!f.family || !f.src) return "";
  // pptxgenjs writes `latin typeface="EON Brix Sans"` and the renderer
  // sets `font-family: "EON Brix Sans", sans-serif`. We need to register
  // EXACTLY the same family name (case-sensitive — CSS doesn't care
  // about case but Safari/Chrome differ on quote handling for spaces).
  const fmt = formatHint(f.src);
  return `@font-face{font-family:"${escapeCss(f.family)}";` +
    `font-weight:${f.weight ?? 400};` +
    `font-style:${f.italic ? "italic" : "normal"};` +
    `font-display:swap;` +
    `src:url(${JSON.stringify(f.src)})${fmt ? ` format(${JSON.stringify(fmt)})` : ""};}`;
}

function formatHint(src: string): string | undefined {
  // `format()` is an optimisation hint; the browser falls back to
  // sniffing if absent. We supply it for the common cases so the
  // browser doesn't issue a HEAD request first.
  const lower = src.toLowerCase();
  if (lower.includes(".woff2") || lower.startsWith("data:font/woff2"))
    return "woff2";
  if (lower.includes(".woff") || lower.startsWith("data:font/woff"))
    return "woff";
  if (lower.includes(".ttf") || lower.startsWith("data:font/ttf") || lower.startsWith("data:application/x-font-ttf"))
    return "truetype";
  if (lower.includes(".otf") || lower.startsWith("data:font/otf") || lower.startsWith("data:application/x-font-otf"))
    return "opentype";
  return undefined;
}

function escapeCss(s: string): string {
  // Only escape characters that would break the `font-family` declaration.
  return s.replace(/["\\]/g, "\\$&");
}

/**
 * Collect web fonts that should drive the editor preview, merging the
 * deck's own list with a host-supplied registry. The deck wins on
 * family-name collisions (the deck author knows best what they want).
 */
export function resolveWebFonts(
  deck: Deck,
  registry: WebFontAsset[] = []
): WebFontAsset[] {
  const seen = new Set<string>();
  const out: WebFontAsset[] = [];
  const key = (f: WebFontAsset) =>
    `${f.family.toLowerCase()}|${f.weight ?? 400}|${f.italic ? 1 : 0}`;
  for (const f of deck.webFonts ?? []) {
    const k = key(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  for (const f of registry) {
    const k = key(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}
