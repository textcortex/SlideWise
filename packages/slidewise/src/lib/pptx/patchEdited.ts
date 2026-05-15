/**
 * Patch-mode save path: when an element has been edited but the edit only
 * touches fields we know how to splice into the original OOXML (text
 * content, geometry, run text), patch the source `<p:sp>` / `<p:pic>` /
 * `<p:graphicFrame>` instead of regenerating via pptxgenjs. Everything
 * else in the source — gradient fills, `<a:custGeom>` paths, scheme-
 * referenced text colors, themed fonts, run-level emphasis, `<a:effectLst>`
 * shadows, body padding, autofit hints — survives verbatim.
 *
 * Patterned after Univer's approach to Office docs: edit the source
 * document tree in place, never round-trip through a lossy intermediate
 * model. pptxgenjs is reserved as a last-resort fallback for unpatchable
 * cases (new elements with no source, complex multi-run text re-styling,
 * shape kind changes, etc.).
 */
import type { SlideElement, TextElement, TextRun } from "@/lib/types";
import { EMU_PER_PX } from "./units";
import { getElementSourceParsed, snapshotElement } from "./pptxToDeck";

export interface PatchResult {
  xml: string;
  sourcePath: string;
}

/**
 * Field categories used for patch eligibility. Each entry maps a field
 * name to the patch kind that covers it. If an edit only touches fields
 * within a single covered category, we can splice the source XML; if it
 * crosses into uncovered territory (font weight, fill kind, runs with
 * mixed styling), we fall back to pptxgenjs.
 */
const GEOM_FIELDS = new Set(["x", "y", "w", "h", "rotation"]);
const TEXT_CONTENT_FIELDS = new Set(["text"]);

/**
 * If the element's edit pattern is patchable, return the patched OOXML
 * (with its source slide path so injectIntoSlide can resolve r:id refs
 * against the right rels file). Otherwise null — the caller should fall
 * back to pptxgenjs's emitter for that element.
 */
export function tryPatchEditedElement(el: SlideElement): PatchResult | null {
  const src = getElementSourceParsed(el.id);
  if (!src) return null;
  const cur = JSON.parse(snapshotElement(el)) as Record<string, unknown>;

  const changed = diffFields(src.snapshot, cur);
  if (changed.size === 0) return null; // pristine — caller handles separately

  // Detect which patch categories the changes need.
  const needsGeom = anyIn(changed, GEOM_FIELDS);
  const needsText = anyIn(changed, TEXT_CONTENT_FIELDS);
  const otherChanges = [...changed].filter(
    (f) => !GEOM_FIELDS.has(f) && !TEXT_CONTENT_FIELDS.has(f)
  );

  // Anything we can't patch (color, font, runs, shape kind, fill, etc.)
  // → bail. The runs field needs special handling — if the user only
  // edited text and the style is homogeneous, the editor preserves runs
  // unchanged, but the comparison sees them as equal because both sides
  // serialize identically.
  if (otherChanges.length > 0) return null;

  // For text elements: patching arbitrary text content into multi-run
  // text would lose the run structure. Restrict to single-run (or no-runs)
  // sources. The editor collapses heterogeneous edits back to a flat run
  // structure that pptxgenjs CAN write — but at the cost of losing themed
  // colors, so a separate (future) patch path that rebuilds the txBody
  // from runs while preserving paragraph-level pPr would help.
  let patched: string | null = null;
  if (needsText && el.type === "text") {
    const txt = (el as TextElement).text;
    const runs = (el as TextElement).runs;
    if (runs && runs.length > 1 && !runsAreHomogeneous(runs)) {
      return null;
    }
    patched = patchSingleParagraphText(src.xml, txt, runs);
    if (patched == null) return null;
    // Splice geometry whenever it changed OR when the source had none
    // (placeholder-inherited shapes — without an explicit xfrm in the
    // saved output the layout's resolved position would be ambiguous).
    if (needsGeom || !src.hasXfrm) {
      const geomed = patchGeometry(patched, el);
      if (geomed == null) return null;
      patched = geomed;
    }
  } else if (needsGeom && !needsText) {
    // Pure geometry change on any element type.
    patched = patchGeometry(src.xml, el);
    if (patched == null) return null;
  }

  if (patched == null) return null;

  // Final safety net: if anything in the patch path produced malformed
  // OOXML (mismatched tag counts, broken nesting), PowerPoint may silently
  // drop the entire shape on open — far worse than pptxgenjs's lossy
  // emitter. Fall back to pptxgenjs whenever the structure looks off.
  if (!looksStructurallySound(src.xml, patched)) return null;

  return { xml: patched, sourcePath: src.slidePath };
}

/**
 * Cheap structural sanity check: compare counts of major OOXML tag pairs
 * between source and patched. Any drift means the patch garbled the
 * structure and we should fall back to pptxgenjs rather than ship broken
 * XML to PowerPoint.
 *
 * Not a full XML validator — we'd pay parser cost on every element on
 * every save. Catches the regex edge cases that have bitten us
 * (self-closing `<p:spPr/>`, mismatched rPr capture, etc.) without the
 * overhead.
 */
function looksStructurallySound(src: string, patched: string): boolean {
  const tagsToCheck = [
    "p:sp",
    "p:pic",
    "p:graphicFrame",
    "p:cxnSp",
    "p:spPr",
    "p:txBody",
    "a:p",
    "a:r",
    "a:t",
    "a:xfrm",
  ];
  for (const tag of tagsToCheck) {
    const open = countMatches(patched, new RegExp(`<${tag}\\b[^/]*>`, "g"));
    const close = countMatches(patched, new RegExp(`</${tag}>`, "g"));
    const selfClose = countMatches(
      patched,
      new RegExp(`<${tag}\\b[^>]*\\/>`, "g")
    );
    if (open !== close) return false;
    // Track the same in the source — patch shouldn't have produced more
    // top-level shape containers than source had (which would mean the
    // patch fragment now wraps stuff it shouldn't).
    const srcOpen = countMatches(src, new RegExp(`<${tag}\\b[^/]*>`, "g"));
    const srcSelfClose = countMatches(
      src,
      new RegExp(`<${tag}\\b[^>]*\\/>`, "g")
    );
    if (tag === "p:sp" || tag === "p:pic" || tag === "p:graphicFrame") {
      if (open + selfClose !== srcOpen + srcSelfClose) return false;
    }
  }
  return true;
}

function countMatches(s: string, re: RegExp): number {
  return (s.match(re) ?? []).length;
}

function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): Set<string> {
  const keys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const out = new Set<string>();
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out.add(k);
  }
  return out;
}

function anyIn(set: Set<string>, target: Set<string>): boolean {
  for (const v of set) if (target.has(v)) return true;
  return false;
}

function runsAreHomogeneous(runs: TextRun[]): boolean {
  if (runs.length <= 1) return true;
  const first = runs[0];
  return runs.every(
    (r) =>
      r.fontFamily === first.fontFamily &&
      r.fontSize === first.fontSize &&
      r.fontWeight === first.fontWeight &&
      r.italic === first.italic &&
      r.underline === first.underline &&
      r.strike === first.strike &&
      r.color === first.color &&
      r.letterSpacing === first.letterSpacing
  );
}

/**
 * Splice new text content into the source `<p:txBody>`, preserving every
 * paragraph-level `<a:pPr>` and run-level `<a:rPr>` that was on the source.
 * Strategy:
 *   1. Locate the single `<p:txBody>` inside the source `<p:sp>`.
 *   2. Capture the first paragraph's `<a:pPr>` (if any) and first run's
 *      `<a:rPr>` (if any) — these carry bullets, alignment, themed font /
 *      colour refs, autofit, etc.
 *   3. Split the new text on `\n` into paragraphs.
 *   4. For each paragraph, emit `<a:p>` + the captured `<a:pPr>` (if it
 *      was on the source's first paragraph) + a single `<a:r>` carrying
 *      the captured `<a:rPr>` + the new `<a:t>`.
 *   5. Splice the rebuilt `<p:txBody>` back into the source XML.
 * Returns null when the source has no `<p:txBody>` or the structure isn't
 * one we recognise, so the caller can fall through to pptxgenjs.
 */
function patchSingleParagraphText(
  xml: string,
  newText: string,
  runs: TextRun[] | undefined
): string | null {
  const bodyOpenRe = /<p:txBody\b[^>]*>/;
  const bodyOpenMatch = bodyOpenRe.exec(xml);
  if (!bodyOpenMatch) return null;
  const bodyOpenEnd = bodyOpenMatch.index + bodyOpenMatch[0].length;
  const bodyCloseIdx = xml.indexOf("</p:txBody>", bodyOpenEnd);
  if (bodyCloseIdx < 0) return null;
  const innerBody = xml.slice(bodyOpenEnd, bodyCloseIdx);

  // Preserve <a:bodyPr> and <a:lstStyle> verbatim — autofit, insets, list
  // defaults are template chrome that shouldn't change with text edits.
  const bodyPrMatch = /<a:bodyPr\b[\s\S]*?(?:\/>|<\/a:bodyPr>)/.exec(innerBody);
  const lstStyleMatch = /<a:lstStyle\b[\s\S]*?(?:\/>|<\/a:lstStyle>)/.exec(
    innerBody
  );
  const bodyPr = bodyPrMatch?.[0] ?? "";
  const lstStyle = lstStyleMatch?.[0] ?? "";

  // Capture the first paragraph's pPr and the first run's rPr — these
  // carry the template formatting (bullets, themed colors, fonts) that
  // pptxgenjs would otherwise drop. Match both self-closing
  // (`<a:rPr lang="..." sz="2800"/>`) and open/close
  // (`<a:rPr><a:solidFill>...</a:solidFill></a:rPr>`) forms verbatim.
  const firstPMatch = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/.exec(innerBody);
  if (!firstPMatch) return null;
  const firstPInner = firstPMatch[1];
  const pPrMatch =
    /<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>|<a:pPr\b[^>]*\/>/.exec(firstPInner);
  const firstRunMatch = /<a:r\b[^>]*>([\s\S]*?)<\/a:r>/.exec(firstPInner);
  const rPrInRun = firstRunMatch
    ? /<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>|<a:rPr\b[^>]*\/>/.exec(firstRunMatch[1])
    : null;
  const pPr = pPrMatch?.[0] ?? "";
  const rPr = rPrInRun?.[0] ?? "";

  // Split the edited text on \n into paragraphs. Empty lines become
  // empty paragraphs with the same pPr — PowerPoint convention.
  const paragraphs = newText.split("\n");
  const rebuiltParas = paragraphs
    .map((line) => {
      if (line.length === 0) {
        return `<a:p>${pPr}<a:endParaRPr lang="en-US"/></a:p>`;
      }
      return `<a:p>${pPr}<a:r>${rPr}<a:t>${escapeXml(line)}</a:t></a:r></a:p>`;
    })
    .join("");

  const rebuiltInner = `${bodyPr}${lstStyle}${rebuiltParas}`;
  void runs; // future: multi-run patch path
  return xml.slice(0, bodyOpenEnd) + rebuiltInner + xml.slice(bodyCloseIdx);
}

/**
 * Replace (or insert) the `<a:xfrm>` on a `<p:sp>` / `<p:pic>` /
 * `<p:graphicFrame>` to match the edited geometry, leaving everything
 * else in `<p:spPr>` (preset/custom geometry, fills, line, effects)
 * untouched. Returns null only if the source XML doesn't have a
 * recognisable spPr we can splice into.
 */
function patchGeometry(xml: string, el: SlideElement): string | null {
  const offX = Math.round(el.x * EMU_PER_PX);
  const offY = Math.round(el.y * EMU_PER_PX);
  const extX = Math.round(el.w * EMU_PER_PX);
  const extY = Math.round(el.h * EMU_PER_PX);
  // PPTX rotation is in 60000ths of a degree; positive = clockwise.
  const rotUnits = Math.round((el.rotation || 0) * 60000);
  const rotAttr = rotUnits ? ` rot="${rotUnits}"` : "";
  const newXfrm = `<a:xfrm${rotAttr}><a:off x="${offX}" y="${offY}"/><a:ext cx="${extX}" cy="${extY}"/></a:xfrm>`;

  // `<p:graphicFrame>` carries its xfrm as `<p:xfrm>` (note the p: prefix)
  // directly under the frame; everything else uses `<a:xfrm>` inside
  // `<p:spPr>` / `<p:grpSpPr>`. Handle both.
  if (/<p:graphicFrame\b/.test(xml)) {
    const gfXfrm = `<p:xfrm${rotAttr}><a:off x="${offX}" y="${offY}"/><a:ext cx="${extX}" cy="${extY}"/></p:xfrm>`;
    if (/<p:xfrm\b/.test(xml)) {
      return xml.replace(/<p:xfrm\b[\s\S]*?<\/p:xfrm>/, gfXfrm);
    }
    // Insert right after the </p:nvGraphicFramePr> closing tag.
    return xml.replace(
      /<\/p:nvGraphicFramePr>/,
      `</p:nvGraphicFramePr>${gfXfrm}`
    );
  }

  // <p:sp> / <p:pic> / <p:cxnSp> path: xfrm lives inside <p:spPr>.
  if (/<a:xfrm\b/.test(xml)) {
    return xml.replace(/<a:xfrm\b[\s\S]*?<\/a:xfrm>|<a:xfrm\b[^/]*\/>/, newXfrm);
  }
  // Self-closing `<p:spPr/>` first — convert to open/close and put xfrm
  // INSIDE. Must come before the open-tag branch because the open-tag
  // regex (`<p:spPr\b[^>]*>`) also matches `<p:spPr/>` (the `/` is a
  // legal character in `[^>]*`), and inserting xfrm after `<p:spPr/>`
  // would put it OUTSIDE the spPr container — invalid OOXML that
  // PowerPoint silently drops the shape over.
  if (/<p:spPr\b[^>]*\/\s*>/.test(xml)) {
    return xml.replace(/<p:spPr\b[^>]*\/\s*>/, `<p:spPr>${newXfrm}</p:spPr>`);
  }
  // Open/close form: insert immediately after the opening tag.
  if (/<p:spPr\b[^>]*>/.test(xml)) {
    return xml.replace(/<p:spPr\b[^>]*>/, (m) => `${m}${newXfrm}`);
  }
  return null;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
