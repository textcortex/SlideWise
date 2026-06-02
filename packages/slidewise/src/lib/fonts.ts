import type { Deck, FontAsset, TextElement, WebFontAsset } from "@/lib/types";
import { decodeEot, EotDecodeError } from "./fonts/eot";

/**
 * Best-effort web-font loader for typefaces referenced inside a Deck.
 *
 * PPTX files commonly reference typefaces that are NOT installed on the
 * viewer's machine. PowerPoint embeds plain SFNT (TTF/OTF) binaries in
 * `ppt/fonts/*.fntdata`, which the importer now surfaces as `Deck.webFonts`
 * (see `readEmbeddedFonts` / `webFontMimeFromBytes` in `pptxToDeck.ts`) so the
 * canvas can paint the real brand face. Anything that isn't a recognised font
 * signature (e.g. a legacy obfuscated / EOT payload) is skipped.
 *
 * For families with no embedded binary we fall back to Google Fonts for every
 * unique typeface
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
 * The two live side-by-side so a deck can ship a renderable font for the
 * editor alongside the payload PowerPoint embeds, without one stomping the
 * other.
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
 * Collect web fonts that should drive the editor preview. Precedence:
 *
 *   1. `Deck.webFonts` — per-deck overrides, AI-authored decks ship these.
 *   2. `fontRegistry` — host-wide brand fonts the platform owns.
 *   3. **Decoded `Deck.fonts`** — embedded `.fntdata` payloads the importer
 *      pulled from `ppt/fonts/`. These are EOT, usually MicroType-Express
 *      (MTX) compressed; `decodeEot` decompresses them and reconstructs the
 *      `glyf` table into a browser-valid TTF, surfaced as a `data:font/ttf;…`
 *      URL. A font that still can't be decoded (truncated / unsupported
 *      variant) is skipped and `fontRegistry` is the documented fallback.
 *
 * The first source to claim a `(family, weight, italic)` tuple wins.
 */
/**
 * Families that must NOT be requested from Google Fonts: anything we resolve
 * to a web font locally, PLUS every embedded-font family on the deck. An
 * embedded brand font (EON Office Head, etc.) will never exist on Google
 * Fonts, so requesting it just produces a noisy CORS/404 — even when we
 * can't yet decode it (TrueType-glyf MTX), the right behaviour is a silent
 * system fallback, not a failed network request.
 */
export function googleFontExclusions(
  deck: Deck,
  resolved: WebFontAsset[]
): Set<string> {
  const out = new Set<string>();
  for (const f of resolved) out.add(f.family.toLowerCase());
  for (const f of deck.fonts ?? []) out.add(f.family.toLowerCase());
  return out;
}

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
  for (const f of decodeDeckEmbeddedFonts(deck)) {
    const k = key(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

/**
 * Convert a `Deck.fonts` entry (raw `.fntdata` from `ppt/fonts/`) into a
 * `WebFontAsset` the editor can render. `decodeEot` handles uncompressed and
 * MicroType-Express (MTX) compressed EOT, reconstructing the `glyf` table.
 * Returns `null` only when the payload still can't be decoded (truncated /
 * unsupported variant) so callers can fall back to the registry / system
 * font chain.
 *
 * The returned asset uses a `data:font/ttf;base64,...` URL so the resulting
 * `@font-face` is fully self-contained — no CDN, no network request.
 */
export function fontAssetToWebFont(asset: FontAsset): WebFontAsset | null {
  const bytes = decodeFontAssetData(asset.data);
  if (!bytes) return null;
  try {
    const decoded = decodeEot(bytes);
    // "OTTO" sfnt magic = OpenType/CFF → font/otf; otherwise TrueType.
    const t = decoded.ttf;
    const isOtto =
      t.length >= 4 && t[0] === 0x4f && t[1] === 0x54 && t[2] === 0x54 && t[3] === 0x4f;
    const mime = isOtto ? "font/otf" : "font/ttf";
    const dataUrl = `data:${mime};base64,${uint8ArrayToBase64(decoded.ttf)}`;
    return {
      family: asset.family,
      src: dataUrl,
      weight: asset.weight,
      italic: asset.italic,
    };
  } catch (err) {
    // EotDecodeError with kind "mtx-not-implemented" is the expected path
    // for brand-embedded fonts (EON / corporate fonts almost always use
    // MTX glyph compression). Don't shout in the console; the host's
    // `fontRegistry` is the documented fallback.
    if (
      err instanceof EotDecodeError &&
      (err.kind === "mtx-not-implemented" || err.kind === "mtx-failed")
    ) {
      if (
        typeof window !== "undefined" &&
        (window as unknown as { __slidewiseFontDebug?: boolean })
          .__slidewiseFontDebug
      ) {
        console.debug(
          "[slidewise/fonts] embedded font",
          asset.family,
          "is MTX-compressed; falling back to fontRegistry / system",
          err.message
        );
      }
      return null;
    }
    if (
      typeof window !== "undefined" &&
      (window as unknown as { __slidewiseFontDebug?: boolean })
        .__slidewiseFontDebug
    ) {
      console.debug(
        "[slidewise/fonts] EOT decode failed for",
        asset.family,
        err
      );
    }
    return null;
  }
}

/**
 * Weight-name suffixes a font family can carry, longest/most-specific first
 * so "Semi Bold" / "Extra Bold" win over a bare "Bold" match. Used to alias a
 * weight-named embedded family (e.g. "Montserrat Bold") to its base family at
 * the matching numeric weight, so text that asks for the base family in bold
 * ("Montserrat" + b) renders with the REAL bold face the deck shipped instead
 * of a synthetic (faux) bold of the regular face.
 */
const WEIGHT_SUFFIXES: Array<[RegExp, number]> = [
  [/[\s-]?thin$/i, 100],
  [/[\s-]?(?:extra|ultra)[\s-]?light$/i, 200],
  [/[\s-]?light$/i, 300],
  [/[\s-]?regular$/i, 400],
  [/[\s-]?normal$/i, 400],
  [/[\s-]?medium$/i, 500],
  [/[\s-]?(?:semi|demi)[\s-]?bold$/i, 600],
  [/[\s-]?(?:extra|ultra)[\s-]?bold$/i, 800],
  [/[\s-]?(?:black|heavy)$/i, 900],
  [/[\s-]?bold$/i, 700],
];

/**
 * Split a trailing weight word off a family name. "Montserrat Semi-Bold" →
 * { base: "Montserrat", weight: 600 }. Returns null when the family carries no
 * recognised weight suffix (e.g. "DM Serif Display").
 */
export function splitFamilyWeight(
  family: string
): { base: string; weight: number } | null {
  for (const [re, weight] of WEIGHT_SUFFIXES) {
    if (re.test(family)) {
      const base = family.replace(re, "").trim();
      if (base.length) return { base, weight };
    }
  }
  return null;
}

/**
 * Bulk-convert `Deck.fonts` → `WebFontAsset[]` filtering out the entries
 * we couldn't decode. Safe to call eagerly inside a `useMemo` because
 * decoding a 200KB font runs in single-digit ms.
 *
 * For each weight-named family we ALSO emit an alias under the base family at
 * the matching numeric weight (Montserrat Bold → Montserrat / 700), so a run
 * that asks for "Montserrat" in bold binds to the real bold face rather than
 * synthesising one. The original family is kept too, so runs that name the
 * weight-variant directly still resolve.
 */
export function decodeDeckEmbeddedFonts(deck: Deck): WebFontAsset[] {
  if (!deck.fonts || !deck.fonts.length) return [];
  const out: WebFontAsset[] = [];
  for (const asset of deck.fonts) {
    const web = fontAssetToWebFont(asset);
    if (!web) continue;
    out.push(web);
    const split = splitFamilyWeight(web.family);
    if (split) {
      out.push({
        family: split.base,
        src: web.src,
        weight: split.weight,
        italic: web.italic,
      });
    }
  }
  return out;
}

/**
 * Accept the `data` URL forms that `FontAsset` documents — `data:`
 * URLs (the importer uses these for `ppt/fonts/*.fntdata`) and bare
 * base64 strings. Returns null on `http(s):` URLs (those would need to
 * be fetched, which is out of scope for the synchronous resolver).
 */
function decodeFontAssetData(data: string): Uint8Array | null {
  if (!data) return null;
  if (/^https?:/i.test(data)) return null;
  const comma = data.indexOf(",");
  const base64 = comma >= 0 ? data.slice(comma + 1) : data;
  try {
    return base64ToUint8Array(base64);
  } catch {
    return null;
  }
}

function base64ToUint8Array(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node test environments — Buffer is available.
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(
        ...bytes.subarray(i, Math.min(i + chunk, bytes.length))
      );
    }
    return btoa(bin);
  }
  return Buffer.from(bytes).toString("base64");
}
