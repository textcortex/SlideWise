import pptxgen from "pptxgenjs";
import JSZip from "jszip";
import type {
  Deck,
  Slide,
  SlideElement,
  TextElement,
  ShapeElement,
  ShapeKind,
  ImageElement,
  LineElement,
  TableElement,
  IconElement,
  EmbedElement,
  ChartElement,
  UnknownElement,
} from "@/lib/types";
import { pxToInches, pxToPoints } from "./units";
import {
  SOURCE_PPTX,
  SOURCE_SLIDE_PATH,
  getCachedSourceBufferAsync,
  getElementSource,
  snapshotElement,
} from "./pptxToDeck";
import { tryPatchEditedElement } from "./patchEdited";

/**
 * Serialize a Slidewise Deck to a real PPTX blob.
 *
 * Native element types (text, shape, image, line, table, icon, embed)
 * are written through pptxgenjs. UnknownElement (charts, SmartArt,
 * group shapes, OLE, math, anything else the importer couldn't model)
 * is preserved verbatim: we keep the original PPTX bytes on the Deck
 * during parse, and after pptxgenjs finishes, we post-process the
 * generated zip to inject the preserved OOXML — plus any media those
 * fragments referenced — into the matching slides. The fragments
 * inside an UnknownElement keep their original rIds; we copy the
 * corresponding rels entries (and media payloads) from the source
 * zip, renumbering rIds as needed to avoid clashes with what
 * pptxgenjs already wrote.
 */
/**
 * Optional knobs for the serializer.
 *
 * `source` lets the host pass the original PPTX bytes alongside the deck so
 * UnknownElement preservation can run even when the deck object has been
 * cloned, spread, JSON-rehydrated, or otherwise stripped of the
 * non-enumerable attachment that `parsePptx` stamps on. Hosts running an
 * editor (Zustand snapshots, immutable updates, localStorage rehydrate)
 * should pass `source` explicitly.
 */
export interface SerializeOptions {
  source?: Blob | ArrayBuffer | Uint8Array;
}

export async function serializeDeck(
  deck: Deck,
  options: SerializeOptions = {}
): Promise<Blob> {
  const pptx = new pptxgen();
  pptx.title = deck.title || "Untitled";
  pptx.layout = "LAYOUT_WIDE"; // 13.333 × 7.5 in

  // Patch-mode save: for each edited element whose change pattern we know
  // how to splice into the source OOXML (text content, geometry), generate
  // a patched fragment up front. addSlide skips those elements (so
  // pptxgenjs doesn't write a lossy version), and preserveUnknowns
  // injects the patched fragment alongside pristines. Anything not
  // patchable (color edits, font changes, run-level restyling, new
  // elements) still flows through pptxgenjs as before.
  const patchedBySlide = collectPatched(deck);
  const skipElementIds = new Set<string>();
  for (const group of patchedBySlide.values()) {
    for (const id of group.elementIds) skipElementIds.add(id);
  }

  for (const slide of deck.slides) {
    addSlide(pptx, slide, skipElementIds);
  }

  // Use arraybuffer (universal: works in Node + browser, accepted by JSZip
  // directly) and wrap to Blob only when we're done post-processing.
  const generated = (await pptx.write({
    outputType: "arraybuffer",
  })) as ArrayBuffer;
  return preserveUnknowns(generated, deck, options.source, patchedBySlide);
}

function addSlide(
  pptx: pptxgen,
  slide: Slide,
  skipElementIds: Set<string>
): void {
  const s = pptx.addSlide();
  s.background = { color: hexNoHash(slide.background) };

  const sorted = [...slide.elements].sort((a, b) => a.z - b.z);
  for (const el of sorted) {
    // Skip elements whose imported OOXML survived this far AND haven't
    // been edited — the post-process step replays their source XML
    // verbatim, sidestepping pptxgenjs's lossy translation of
    // gradient / custGeom / backing fields.
    if (isPristineImportedElement(el)) continue;
    // Skip elements covered by patch-mode — preserveUnknowns will splice
    // the patched OOXML into the slide.
    if (skipElementIds.has(el.id)) continue;
    try {
      addElement(s, el);
    } catch (err) {
      console.warn(
        `[slidewise/pptx] failed to write element ${el.id} (${el.type}):`,
        err
      );
    }
  }
}

function isPristineImportedElement(el: SlideElement): boolean {
  const src = getElementSource(el.id);
  if (!src) return false;
  return src.snapshot === snapshotElement(el);
}

function addElement(s: pptxgen.Slide, el: SlideElement): void {
  switch (el.type) {
    case "text":
      addText(s, el);
      return;
    case "shape":
      addShape(s, el);
      return;
    case "image":
      addImage(s, el);
      return;
    case "line":
      addLine(s, el);
      return;
    case "table":
      addTable(s, el);
      return;
    case "icon":
      addIcon(s, el);
      return;
    case "embed":
      addEmbed(s, el);
      return;
    case "chart":
      // Charts round-trip via their preserved <p:graphicFrame> OOXML,
      // re-injected by preserveUnknowns(). Editing live chart data inside
      // Slidewise isn't yet wired up to a chart-XML writer; until then we
      // re-emit the source verbatim so the chart and its embedded Excel
      // survive open/save.
      return;
    case "unknown":
      // Preserved by preserveUnknowns() after pptxgenjs writes the zip.
      // The post-process step injects el.ooxmlXml into the matching
      // slide's <p:spTree> and copies any media the fragment referenced.
      return;
  }
}

function geometry(el: SlideElement): {
  x: number;
  y: number;
  w: number;
  h: number;
  rotate?: number;
} {
  return {
    x: pxToInches(el.x),
    y: pxToInches(el.y),
    w: pxToInches(el.w),
    h: pxToInches(el.h),
    rotate: el.rotation || undefined,
  };
}

function addText(s: pptxgen.Slide, el: TextElement): void {
  const baseOpts = {
    ...geometry(el),
    fontFace: el.fontFamily,
    fontSize: pxToPoints(el.fontSize),
    color: hexNoHash(el.color),
    bold: el.fontWeight >= 600,
    italic: el.italic,
    underline: el.underline ? ({ style: "sng" } as const) : undefined,
    strike: el.strike ? ("sngStrike" as const) : undefined,
    align: el.align,
    valign: el.vAlign,
    charSpacing: el.letterSpacing
      ? Math.round(el.letterSpacing * 100)
      : undefined,
    paraSpaceBefore: 0,
    paraSpaceAfter: 0,
  };

  if (!el.runs || !el.runs.length) {
    s.addText(el.text, baseOpts);
    return;
  }

  // Multi-run: pptxgenjs accepts an array of {text, options} objects and emits
  // them as separate <a:r> within the same <a:p>. A run whose text contains
  // "\n" is split so each piece becomes its own paragraph (we use a per-run
  // `breakLine` flag on the trailing pieces).
  const items: pptxgen.TextProps[] = [];
  for (const r of el.runs) {
    const pieces = r.text.split("\n");
    for (let i = 0; i < pieces.length; i++) {
      const isLast = i === pieces.length - 1;
      items.push({
        text: pieces[i],
        options: {
          fontFace: r.fontFamily ?? el.fontFamily,
          fontSize: pxToPoints(r.fontSize ?? el.fontSize),
          color: hexNoHash(r.color ?? el.color),
          bold: (r.fontWeight ?? el.fontWeight) >= 600,
          italic: r.italic ?? el.italic,
          underline: (r.underline ?? el.underline)
            ? ({ style: "sng" } as const)
            : undefined,
          strike: (r.strike ?? el.strike) ? ("sngStrike" as const) : undefined,
          charSpacing: r.letterSpacing ?? el.letterSpacing
            ? Math.round((r.letterSpacing ?? el.letterSpacing) * 100)
            : undefined,
          breakLine: !isLast,
        },
      });
    }
  }
  s.addText(items, baseOpts);
}

const SHAPE_MAP: Record<ShapeKind, string> = {
  rect: "rect",
  rounded: "roundRect",
  circle: "ellipse",
  triangle: "triangle",
  diamond: "diamond",
  star: "star5",
};

function addShape(s: pptxgen.Slide, el: ShapeElement): void {
  const shapeName = SHAPE_MAP[el.shape] ?? "rect";
  // pptxgenjs accepts shape names as strings; the typed ShapeType enum is
  // also exposed. Pass via `as unknown as` to bypass strict enum typing.
  s.addShape(shapeName as unknown as Parameters<typeof s.addShape>[0], {
    ...geometry(el),
    fill: { color: hexNoHash(el.fill) },
    line: el.stroke
      ? {
          color: hexNoHash(el.stroke),
          width: el.strokeWidth ?? 1,
        }
      : { type: "none" },
    rectRadius:
      el.shape === "rounded" && el.radius != null
        ? clamp01(el.radius / Math.min(el.w, el.h))
        : undefined,
  });
}

function addImage(s: pptxgen.Slide, el: ImageElement): void {
  const opts: Parameters<typeof s.addImage>[0] = {
    ...geometry(el),
    sizing:
      el.fit === "cover"
        ? { type: "cover", w: pxToInches(el.w), h: pxToInches(el.h) }
        : el.fit === "contain"
          ? { type: "contain", w: pxToInches(el.w), h: pxToInches(el.h) }
          : undefined,
  };
  if (isDataUrl(el.src)) {
    opts.data = el.src;
  } else {
    opts.path = el.src;
  }
  s.addImage(opts);
}

function addLine(s: pptxgen.Slide, el: LineElement): void {
  s.addShape(
    "line" as unknown as Parameters<typeof s.addShape>[0],
    {
      ...geometry(el),
      line: {
        color: hexNoHash(el.stroke),
        width: el.strokeWidth,
        dashType: el.dashed ? "dash" : "solid",
        endArrowType: el.arrow ? "triangle" : "none",
      },
    }
  );
}

function addTable(s: pptxgen.Slide, el: TableElement): void {
  if (!el.rows.length) return;
  const rows = el.rows.map((row, ri) =>
    row.map((cell) => ({
      text: cell,
      options: {
        bold: ri === 0,
        fill: { color: hexNoHash(ri === 0 ? el.headerFill : el.rowFill) },
        color: hexNoHash(el.textColor),
        fontSize: pxToPoints(el.fontSize),
        valign: "middle" as const,
      },
    }))
  );
  s.addTable(rows, {
    ...geometry(el),
    border: { type: "none", pt: 0, color: "FFFFFF" },
    fontFace: "Inter",
  });
}

function addIcon(s: pptxgen.Slide, el: IconElement): void {
  // Render the icon as a centered text box with the unicode glyph.
  const fontSize = Math.min(el.w, el.h) * 0.7;
  s.addText(el.icon, {
    ...geometry(el),
    fontFace: "Segoe UI Symbol",
    fontSize: pxToPoints(fontSize),
    color: hexNoHash(el.color),
    align: "center",
    valign: "middle",
  });
}

function addEmbed(s: pptxgen.Slide, el: EmbedElement): void {
  // Render embed as a labelled placeholder. PPTX has no first-class equivalent
  // for "an arbitrary URL embed"; we capture intent as text + URL.
  s.addText(
    [
      { text: "Embed\n", options: { fontSize: 10, color: "9CA3AF" } },
      { text: `${el.label}\n`, options: { bold: true, fontSize: 18 } },
      { text: el.url, options: { fontSize: 10, color: "9CA3AF" } },
    ],
    {
      ...geometry(el),
      fill: { color: "0E1330" },
      color: "FFFFFF",
      align: "center",
      valign: "middle",
    }
  );
}

// -- UnknownElement preservation -------------------------------------------

/**
 * Post-process the zip pptxgenjs produced: for every slide that carries
 * UnknownElement payloads, inject the preserved OOXML back into the
 * generated `<p:spTree>` and pull along the rels + media those fragments
 * referenced from the original archive.
 *
 * No-ops cleanly when the deck has no UnknownElements, when no source
 * zip is attached (deck wasn't created via parsePptx), or when a slide
 * the editor added doesn't have a source path.
 */
async function preserveUnknowns(
  generated: ArrayBuffer,
  deck: Deck,
  explicitSource?: Blob | ArrayBuffer | Uint8Array,
  patchedBySlide?: Map<number, PatchedGroup>
): Promise<Blob> {
  const wrapBlob = () => new Blob([generated], { type: PPTX_MIME });
  // Prefer the caller-supplied source (survives state cloning / localStorage
  // rehydrate); fall back to the non-enumerable attachment from parsePptx
  // for the "parse → serialize" happy path with no state in between.
  const sourceBuffer = await resolveSource(deck, explicitSource);
  if (!sourceBuffer) return wrapBlob();

  const unknownsBySlide = collectUnknowns(deck);
  const pristinesBySlide = collectPristineImports(deck);
  const patched = patchedBySlide ?? new Map<number, PatchedGroup>();

  const [outZip, srcZip] = await Promise.all([
    JSZip.loadAsync(generated),
    JSZip.loadAsync(sourceBuffer),
  ]);

  // The source's slide-XML paths (in deck order). Used as a fallback when
  // the per-slide non-enumerable attachment has been stripped by state
  // cloning — we then map deck.slides[i] back to source slides[i].
  const sourceSlidePaths = await readSourceSlidePaths(srcZip);

  const slideIndices = new Set<number>([
    ...unknownsBySlide.keys(),
    ...pristinesBySlide.keys(),
    ...patched.keys(),
  ]);
  const sortedIndices = [...slideIndices].sort((a, b) => a - b);
  for (const slideIndex of sortedIndices) {
    const unknownGroup = unknownsBySlide.get(slideIndex);
    const pristineGroup = pristinesBySlide.get(slideIndex);
    const patchedGroup = patched.get(slideIndex);
    const generatedSlidePath = `ppt/slides/slide${slideIndex + 1}.xml`;
    const generatedRelsPath = `ppt/slides/_rels/slide${slideIndex + 1}.xml.rels`;
    if (!outZip.file(generatedSlidePath)) continue;
    // The slide's own source path is the default for UnknownElement
    // fragments; each pristine fragment carries its own (layout / master)
    // source path so the injector can resolve r:id references against
    // the correct rels file.
    const slideSourcePath =
      unknownGroup?.sourcePath ?? sourceSlidePaths[slideIndex] ?? undefined;
    const unknownFragments: PristineFragment[] =
      unknownGroup && slideSourcePath
        ? unknownGroup.unknowns.map((u) => ({
            xml: u.ooxmlXml,
            sourcePath: slideSourcePath,
          }))
        : [];
    // Patched fragments share injection mechanics with pristines (verbatim
    // XML keyed off a sourcePath for r:id resolution + media copy) — they
    // just carry edited content instead of the source content. Prepend
    // them so they sit at the same z layer as the pristines they replaced.
    const allPristines: PristineFragment[] = [
      ...(pristineGroup?.fragments ?? []),
      ...(patchedGroup?.fragments ?? []),
    ];
    if (!unknownFragments.length && !allPristines.length) {
      continue;
    }
    await injectIntoSlide(
      outZip,
      srcZip,
      generatedSlidePath,
      generatedRelsPath,
      allPristines,
      unknownFragments
    );
  }

  // Replace pptxgenjs's regenerated chrome (slide masters, layouts, theme,
  // notes master, embedded fonts) with the source's. Without this, every
  // background, brand bar, gradient, embedded font, and footer that lives
  // on the master/layout disappears on save. Best-effort: bails when source
  // and output slide size don't match so 4:3 sources don't get their
  // masters stretched onto a 16:9 canvas.
  await preserveDeckChrome(outZip, srcZip, deck, sourceSlidePaths);

  // Per-slide `<p:bg>` preservation. pptxgenjs's slide.background only
  // emits solid colors, so gradient / image / theme-referenced
  // backgrounds collapse to a flat hex through the model path. Replace
  // each output slide's `<p:bg>` with the source's verbatim XML when
  // available so gradients survive intact.
  await preserveSlideBackgrounds(outZip, srcZip, deck, sourceSlidePaths);

  // JSZip's blob output preserves the OOXML mime type set by pptxgenjs.
  return outZip.generateAsync({ type: "blob", mimeType: PPTX_MIME });
}

async function resolveSource(
  deck: Deck,
  explicit?: Blob | ArrayBuffer | Uint8Array
): Promise<ArrayBuffer | undefined> {
  if (explicit) {
    if (explicit instanceof ArrayBuffer) return explicit;
    if (explicit instanceof Uint8Array) {
      const copy = new ArrayBuffer(explicit.byteLength);
      new Uint8Array(copy).set(explicit);
      return copy;
    }
    return explicit.arrayBuffer();
  }
  // 1. In-memory cache keyed by Deck.sourcePptxId, with IndexedDB fallback
  //    that survives page reloads. The id is enumerable so it survives
  //    structuredClone, object spread, and JSON round-trip — any
  //    reducer-driven host (Zustand, Redux, useState, Immer) keeps the
  //    preservation pipeline alive across edits AND reloads.
  if (deck.sourcePptxId) {
    const cached = await getCachedSourceBufferAsync(deck.sourcePptxId);
    if (cached) return cached;
  }
  // 2. Legacy non-enumerable attachment from parsePptx. Only present when
  //    the deck object hasn't been spread / cloned since import.
  const attached = (deck as unknown as Record<string, unknown>)[SOURCE_PPTX];
  return attached instanceof ArrayBuffer ? attached : undefined;
}

/**
 * Both UnknownElement and (post-PR-38) ChartElement preserve their source
 * `<p:graphicFrame>` OOXML for round-trip. We collect them through the
 * same pipeline keyed on a structural `ooxmlXml` field.
 */
type PreservedElement = { ooxmlXml: string };

interface UnknownGroup {
  unknowns: PreservedElement[];
  sourcePath: string | undefined;
}

interface PristineFragment {
  xml: string;
  /** Archive path of the XML's origin (slide / layout / master) — used
   *  to resolve r:id references against the correct rels file. */
  sourcePath: string;
}

interface PristineGroup {
  fragments: PristineFragment[];
}

interface PatchedGroup {
  fragments: PristineFragment[];
  /** Ids of elements whose edits were absorbed by the patch fragments —
   *  addSlide must skip these so pptxgenjs doesn't emit a parallel
   *  (and lossy) copy. */
  elementIds: Set<string>;
}

/**
 * For each slide, walk its elements and try to patch every edited one.
 * "Edited" means the snapshot taken at parse time differs from the
 * current values; "patchable" means the change pattern is one
 * `tryPatchEditedElement` covers (text content, geometry). Charts and
 * UnknownElements are skipped — they use their own re-injection paths.
 */
function collectPatched(deck: Deck): Map<number, PatchedGroup> {
  const out = new Map<number, PatchedGroup>();
  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const fragments: PristineFragment[] = [];
    const elementIds = new Set<string>();
    for (const el of slide.elements) {
      if (el.type === "unknown" || el.type === "chart") continue;
      const patched = tryPatchEditedElement(el);
      if (!patched) continue;
      fragments.push({ xml: patched.xml, sourcePath: patched.sourcePath });
      elementIds.add(el.id);
    }
    if (!fragments.length) continue;
    out.set(i, { fragments, elementIds });
  }
  return out;
}

function collectPristineImports(deck: Deck): Map<number, PristineGroup> {
  const out = new Map<number, PristineGroup>();
  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const fragments: PristineFragment[] = [];
    for (const el of slide.elements) {
      // UnknownElement and ChartElement carry their OOXML directly and go
      // through the separate (high-z, append) injection path — don't
      // double-inject them as pristine fragments too.
      if (el.type === "unknown" || el.type === "chart") continue;
      const src = getElementSource(el.id);
      if (!src) continue;
      // Placeholder-inherited shapes (no explicit xfrm in source) can't be
      // pristine-re-injected — pptxgenjs's regenerated layouts wouldn't
      // resolve their position. Patch-mode handles them separately by
      // splicing in geometry. Skip pristine here.
      if (!src.hasXfrm) continue;
      if (src.snapshot !== snapshotElement(el)) continue;
      fragments.push({ xml: src.xml, sourcePath: src.slidePath });
    }
    if (!fragments.length) continue;
    out.set(i, { fragments });
  }
  return out;
}

function collectUnknowns(deck: Deck): Map<number, UnknownGroup> {
  const out = new Map<number, UnknownGroup>();
  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const unknowns = slide.elements.filter(
      (e): e is UnknownElement | (ChartElement & { ooxmlXml: string }) =>
        (e.type === "unknown" || e.type === "chart") &&
        typeof (e as { ooxmlXml?: unknown }).ooxmlXml === "string" &&
        (e as { ooxmlXml: string }).ooxmlXml.length > 0
    );
    if (!unknowns.length) continue;
    const sourcePath = (slide as unknown as Record<string, unknown>)[
      SOURCE_SLIDE_PATH
    ];
    out.set(i, {
      unknowns,
      sourcePath: typeof sourcePath === "string" ? sourcePath : undefined,
    });
  }
  return out;
}

/**
 * For one slide: rewrite preserved fragments so their rIds don't collide
 * with whatever pptxgenjs already allocated, copy the referenced rels +
 * media from the source zip, and splice the fragments into the generated
 * `<p:spTree>`. `pristineFragments` (verbatim imported elements that
 * weren't edited) get prepended right after `<p:grpSpPr>` so they sit
 * at the bottom of the z stack — that's where layout-derived backgrounds
 * / gradients / wordmarks belong. `unknownPayloads` (charts / SmartArt /
 * OLE) get appended just before `</p:spTree>` so they sit on top, where
 * authored content typically lives.
 */
async function injectIntoSlide(
  outZip: JSZip,
  srcZip: JSZip,
  generatedSlidePath: string,
  generatedRelsPath: string,
  pristineFragments: PristineFragment[],
  unknownFragments: PristineFragment[]
): Promise<void> {
  const slideXml = await outZip.file(generatedSlidePath)!.async("string");
  const closeIdx = slideXml.lastIndexOf("</p:spTree>");
  if (closeIdx < 0) return;

  const outRelsXml =
    (await outZip.file(generatedRelsPath)?.async("string")) ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  const outRels = parseRels(outRelsXml);
  let nextRid = highestRid(outRels) + 1;
  const newRelLines: string[] = [];
  const outDir = dirOf(generatedSlidePath);

  // Per-fragment rId map: r:* references inside one fragment only reuse
  // earlier rIds when they came from the *same* source rels file. Two
  // fragments sourced from different layouts/masters that happen to use
  // the same rId number ("rId2") refer to completely different rels.
  const srcRelsCache = new Map<string, Map<string, { type: string; target: string }>>();
  const getSrcRels = async (
    sourcePath: string
  ): Promise<Map<string, { type: string; target: string }>> => {
    const relsPath = relsPathFor(sourcePath);
    let cached = srcRelsCache.get(relsPath);
    if (cached) return cached;
    const xml = (await srcZip.file(relsPath)?.async("string")) ?? null;
    cached = parseRels(xml);
    srcRelsCache.set(relsPath, cached);
    return cached;
  };

  /**
   * Rewrite every `r:*="rIdN"` in the fragment to a fresh rId pointing at
   * the source rel's target. Copies the referenced media into the
   * generated zip at a uniquely-prefixed path so it can't collide with
   * media pptxgenjs already wrote. Each fragment carries its own source
   * path so the rels lookup uses the right archive entry
   * (slide / layout / master).
   *
   * Matches `r:id` / `r:embed` / `r:link` (slides + drawings + charts),
   * `r:dm` / `r:cs` / `r:qs` / `r:lo` (SmartArt), and any other
   * `r:NAME="rIdN"` style attribute the schema uses. Restricting to the
   * value pattern `rId\d+` keeps unrelated `r:*` attributes untouched.
   */
  const rewriteFragment = async (frag: PristineFragment): Promise<string> => {
    const srcRels = await getSrcRels(frag.sourcePath);
    const sourceDir = dirOf(frag.sourcePath);
    const ridMap = new Map<string, string>();
    return frag.xml.replace(
      /\b(r:[a-zA-Z]+)="(rId\d+)"/g,
      (_m, attr, srcRid) => {
        const cached = ridMap.get(srcRid);
        if (cached) return `${attr}="${cached}"`;
        const srcRel = srcRels.get(srcRid);
        if (!srcRel) return `${attr}="${srcRid}"`;
        const newRid = `rId${nextRid++}`;
        ridMap.set(srcRid, newRid);
        let target = srcRel.target;
        const isExternal = /^https?:\/\//i.test(target);
        const isInternalPart = !isExternal && !target.startsWith("/");
        if (isInternalPart) {
          const srcFullTarget = normalisePath(target, sourceDir);
          const srcFile = srcZip.file(srcFullTarget);
          if (srcFile) {
            const newTarget = uniqueTarget(target, outZip, outDir);
            const newFullTarget = normalisePath(newTarget, outDir);
            outZip.file(newFullTarget, srcFile.async("uint8array"), {
              binary: true,
            });
            target = newTarget;
          }
        }
        newRelLines.push(buildRelXml(newRid, srcRel.type, target));
        return `${attr}="${newRid}"`;
      }
    );
  };

  const rewrittenPristines = await Promise.all(
    pristineFragments.map(rewriteFragment)
  );
  const rewrittenUnknowns = await Promise.all(
    unknownFragments.map(rewriteFragment)
  );

  let updatedSlide = slideXml;
  // Pristine fragments → prepend after `<p:grpSpPr/>` (low z, decoration
  // layer). Unknown payloads → append before `</p:spTree>` (high z,
  // chart / SmartArt / content layer).
  if (rewrittenPristines.length) {
    const insertAfter = findSpTreeContentInsertionPoint(updatedSlide);
    if (insertAfter >= 0) {
      updatedSlide =
        updatedSlide.slice(0, insertAfter) +
        rewrittenPristines.join("") +
        updatedSlide.slice(insertAfter);
    }
  }
  if (rewrittenUnknowns.length) {
    const close = updatedSlide.lastIndexOf("</p:spTree>");
    if (close >= 0) {
      updatedSlide =
        updatedSlide.slice(0, close) +
        rewrittenUnknowns.join("") +
        updatedSlide.slice(close);
    }
  }
  if (updatedSlide !== slideXml) {
    outZip.file(generatedSlidePath, updatedSlide);
  }

  if (newRelLines.length) {
    const insertAt = outRelsXml.lastIndexOf("</Relationships>");
    const updatedRels =
      insertAt >= 0
        ? outRelsXml.slice(0, insertAt) +
          newRelLines.join("") +
          outRelsXml.slice(insertAt)
        : outRelsXml.replace(
            /<Relationships[^>]*>/,
            (m) => `${m}${newRelLines.join("")}`
          );
    outZip.file(generatedRelsPath, updatedRels);
  }
}

/**
 * Find the position in a slide XML string immediately after the group's
 * own `<p:grpSpPr…/>` / `</p:grpSpPr>` — i.e. just before the first child
 * element of the spTree. Used to prepend pristine fragments at the
 * bottom of the z stack.
 */
function findSpTreeContentInsertionPoint(slideXml: string): number {
  const spTreeOpen = slideXml.indexOf("<p:spTree");
  if (spTreeOpen < 0) return -1;
  // Self-closing grpSpPr (`<p:grpSpPr/>`) is the typical pptxgenjs output.
  const selfCloseRe = /<p:grpSpPr\s*\/>/g;
  selfCloseRe.lastIndex = spTreeOpen;
  const sc = selfCloseRe.exec(slideXml);
  if (sc) return sc.index + sc[0].length;
  // Otherwise look for the explicit close tag.
  const closeIdx = slideXml.indexOf("</p:grpSpPr>", spTreeOpen);
  if (closeIdx >= 0) return closeIdx + "</p:grpSpPr>".length;
  // No grpSpPr → fall back to just after `<p:spTree>`'s opening tag.
  const opTagEnd = slideXml.indexOf(">", spTreeOpen);
  return opTagEnd >= 0 ? opTagEnd + 1 : -1;
}

async function readSourceSlidePaths(srcZip: JSZip): Promise<string[]> {
  // Walk the source presentation.xml + its rels to get slide-xml paths in
  // deck order. Best-effort: if anything's missing we return [] and the
  // caller falls back to its own per-slide source attachment.
  const presentation = await srcZip
    .file("ppt/presentation.xml")
    ?.async("string");
  const presentationRels = await srcZip
    .file("ppt/_rels/presentation.xml.rels")
    ?.async("string");
  if (!presentation || !presentationRels) return [];
  const relMap = parseRels(presentationRels);
  const sldIdRe = /<p:sldId\b[^>]*\br:id="([^"]+)"/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = sldIdRe.exec(presentation))) {
    const rel = relMap.get(m[1]);
    if (rel?.target) out.push(normalisePath(rel.target, "ppt"));
  }
  return out;
}

function parseRels(xml: string | null): Map<string, { type: string; target: string }> {
  const map = new Map<string, { type: string; target: string }>();
  if (!xml) return map;
  // Match each <Relationship .../> tag. Use a non-greedy scan up to the
  // self-closing `/>` rather than a `[^/]` class — relationship targets
  // routinely contain `/` (e.g. `Target="../charts/chart1.xml"`).
  const re = /<Relationship\b([\s\S]*?)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const id = /\bId="([^"]+)"/.exec(attrs)?.[1];
    const type = /\bType="([^"]+)"/.exec(attrs)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
    if (id && type && target) map.set(id, { type, target });
  }
  return map;
}

function highestRid(rels: Map<string, unknown>): number {
  let max = 0;
  for (const id of rels.keys()) {
    const m = /^rId(\d+)$/.exec(id);
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return max;
}

function buildRelXml(id: string, type: string, target: string): string {
  return `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
}

function relsPathFor(xmlPath: string): string {
  return xmlPath.replace(/([^/]+)\.xml$/, "_rels/$1.xml.rels");
}

/**
 * Pick a target path that doesn't collide with anything pptxgenjs already
 * wrote into the zip. We keep the original target's directory and
 * extension so the file stays in `ppt/media/`, `ppt/charts/`, etc., but
 * prefix the basename with `slidewise_preserved_N_` until the resolved
 * full path is unique.
 */
function uniqueTarget(originalTarget: string, outZip: JSZip, baseDir: string): string {
  const slash = originalTarget.lastIndexOf("/");
  const dir = slash >= 0 ? originalTarget.slice(0, slash + 1) : "";
  const file = slash >= 0 ? originalTarget.slice(slash + 1) : originalTarget;
  let i = 0;
  let candidate = `${dir}slidewise_preserved_${i}_${file}`;
  while (outZip.file(normalisePath(candidate, baseDir))) {
    i++;
    candidate = `${dir}slidewise_preserved_${i}_${file}`;
  }
  return candidate;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

function normalisePath(target: string, base: string): string {
  if (/^https?:\/\//i.test(target)) return target;
  if (target.startsWith("/")) return target.slice(1);
  let t = target;
  const segments = base.split("/").filter(Boolean);
  while (t.startsWith("../")) {
    segments.pop();
    t = t.slice(3);
  }
  return [...segments, t].filter(Boolean).join("/");
}

// -- Deck chrome preservation ----------------------------------------------

/**
 * Replace pptxgenjs's regenerated deck chrome (slide masters, layouts, theme,
 * notes master, embedded fonts, tags, handout masters) with the originals
 * from the source PPTX. Without this, anything that lives on the master or
 * layout — backgrounds, brand bars, gradients, page numbers, embedded
 * brand fonts — disappears the first time the deck is saved.
 *
 * Bails safely when the source's slide size doesn't match the output's
 * (e.g. a 4:3 source written as 16:9): copying masters drawn at one
 * aspect ratio onto slides authored at another would visually misalign
 * the chrome. Future work: drive the output slide size from the source.
 */
const CHROME_PREFIXES = [
  "ppt/slideMasters/",
  "ppt/slideLayouts/",
  "ppt/theme/",
  "ppt/fonts/",
  "ppt/notesMasters/",
  "ppt/handoutMasters/",
  "ppt/tags/",
] as const;

async function preserveDeckChrome(
  outZip: JSZip,
  srcZip: JSZip,
  deck: Deck,
  sourceSlidePaths: string[]
): Promise<void> {
  if (!(await aspectRatiosMatch(outZip, srcZip))) return;

  // 1. Find every chrome path that exists in the source.
  const srcChromePaths = listPaths(srcZip, CHROME_PREFIXES);
  if (!srcChromePaths.length) return;

  // 2. Remove pptxgenjs's chrome — we're about to overwrite with the source's,
  //    but pptxgenjs may have left files we don't replace (e.g. its single
  //    slideLayout1.xml when the source has 28 layouts named slideLayout1-28,
  //    or stale slideMaster overrides in [Content_Types].xml).
  const outChromePaths = listPaths(outZip, CHROME_PREFIXES);
  for (const p of outChromePaths) outZip.remove(p);

  // 3. Walk every chrome rels file in srcZip to discover the media payloads
  //    those masters / layouts / themes reference. These need to come along
  //    or the chrome XML will dangle on r:id references after the move.
  const referencedMedia = await collectChromeMediaRefs(srcZip, srcChromePaths);

  // 4. Copy the chrome files themselves verbatim. JSZip lazily defers the
  //    actual byte copy until generateAsync, which is cheap.
  for (const p of srcChromePaths) {
    const f = srcZip.file(p);
    if (!f) continue;
    outZip.file(p, f.async("uint8array"), { binary: true });
  }

  // 5. Copy media payloads. pptxgenjs writes its own `ppt/media/imageN.*`
  //    with an unrelated numbering, so we need to rename on collision and
  //    rewrite the copied chrome rels to point at the renamed target.
  const mediaRenames = new Map<string, string>(); // source full path → out full path
  for (const srcMediaPath of referencedMedia) {
    const srcFile = srcZip.file(srcMediaPath);
    if (!srcFile) continue;
    let outMediaPath = srcMediaPath;
    if (outZip.file(outMediaPath)) {
      const slash = srcMediaPath.lastIndexOf("/");
      const dir = srcMediaPath.slice(0, slash + 1);
      const base = srcMediaPath.slice(slash + 1);
      let i = 0;
      do {
        outMediaPath = `${dir}slidewise_chrome_${i}_${base}`;
        i++;
      } while (outZip.file(outMediaPath));
    }
    outZip.file(outMediaPath, srcFile.async("uint8array"), { binary: true });
    if (outMediaPath !== srcMediaPath) {
      mediaRenames.set(srcMediaPath, outMediaPath);
    }
  }
  if (mediaRenames.size) {
    await rewriteChromeRelsForRenames(outZip, srcChromePaths, mediaRenames);
  }

  // 6. [Content_Types].xml: drop the master/layout/theme/notesMaster overrides
  //    pptxgenjs declared (some of which point at files it never wrote — see
  //    the slideMaster1..9 overrides emitted with only slideMaster1.xml
  //    actually on disk) and add overrides for the files we just copied.
  //    Font extensions need a `<Default>` entry so PowerPoint embeds them.
  await rewriteContentTypes(outZip, srcChromePaths);

  // 7. presentation.xml.rels: replace pptxgenjs's slideMaster / theme /
  //    notesMaster rels with the source's mapping. presentation.xml's
  //    <p:sldMasterIdLst> / <p:notesMasterIdLst> also get spliced from
  //    the source so multi-master decks (rare but real) round-trip.
  await rewritePresentation(outZip, srcZip);

  // 8. Each slide's rels currently points at pptxgenjs's slideLayout1.xml,
  //    which we just deleted. Re-point each slide at the original layout
  //    its source counterpart used. New slides (added in-editor with no
  //    source path) fall back to the first source layout.
  await rewriteSlideLayoutRefs(outZip, srcZip, deck, sourceSlidePaths);
}

/**
 * Replace each output slide's `<p:bg>` element with the source slide's
 * `<p:bg>` verbatim. This is what keeps gradient / image-fill / theme-
 * referenced backgrounds intact — pptxgenjs's slide.background only
 * emits flat-hex solid fills, so anything fancier was collapsing on save.
 *
 * Image-fill backgrounds (`<p:bgPr><a:blipFill r:embed="rIdN"/></p:bgPr>`)
 * have their r:id rewritten to a fresh slide-rels-scoped rId, with the
 * referenced media copied across so the fill resolves.
 */
async function preserveSlideBackgrounds(
  outZip: JSZip,
  srcZip: JSZip,
  deck: Deck,
  sourceSlidePaths: string[]
): Promise<void> {
  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const sourceSlidePath =
      ((slide as unknown as Record<string, unknown>)[SOURCE_SLIDE_PATH] as
        | string
        | undefined) ?? sourceSlidePaths[i];
    if (!sourceSlidePath) continue;
    const srcSlideFile = srcZip.file(sourceSlidePath);
    if (!srcSlideFile) continue;
    const srcXml = await srcSlideFile.async("string");
    const bgFragment = extractBgFragment(srcXml);
    if (bgFragment == null) {
      // Source slide had no explicit `<p:bg>` — it's inheriting from
      // layout / master. Drop pptxgenjs's flat-hex bg so the inheritance
      // chain can do its job once the original chrome is back in place.
      await stripOutputBg(outZip, i);
      continue;
    }
    await injectSlideBg(outZip, srcZip, i, sourceSlidePath, bgFragment);
  }
}

function extractBgFragment(slideXml: string): string | null {
  const cSldOpen = slideXml.indexOf("<p:cSld");
  if (cSldOpen < 0) return null;
  const cSldClose = slideXml.indexOf("</p:cSld>", cSldOpen);
  if (cSldClose < 0) return null;
  const scope = slideXml.slice(cSldOpen, cSldClose);
  const bgOpen = scope.indexOf("<p:bg");
  if (bgOpen < 0) return null;
  // Self-closing `<p:bg/>` is legal but expresses "no background"; treat
  // as missing so inheritance kicks back in.
  const selfClose = /<p:bg\b[^>]*\/\s*>/.exec(scope);
  if (selfClose && selfClose.index === bgOpen) return null;
  const bgClose = scope.indexOf("</p:bg>", bgOpen);
  if (bgClose < 0) return null;
  return scope.slice(bgOpen, bgClose + "</p:bg>".length);
}

async function stripOutputBg(outZip: JSZip, slideIndex: number): Promise<void> {
  const outPath = `ppt/slides/slide${slideIndex + 1}.xml`;
  const file = outZip.file(outPath);
  if (!file) return;
  const xml = await file.async("string");
  const updated = xml.replace(/<p:bg\b[\s\S]*?<\/p:bg>|<p:bg\b[^>]*\/\s*>/, "");
  if (updated !== xml) outZip.file(outPath, updated);
}

async function injectSlideBg(
  outZip: JSZip,
  srcZip: JSZip,
  slideIndex: number,
  sourceSlidePath: string,
  bgFragment: string
): Promise<void> {
  const outSlidePath = `ppt/slides/slide${slideIndex + 1}.xml`;
  const outRelsPath = `ppt/slides/_rels/slide${slideIndex + 1}.xml.rels`;
  const outSlideFile = outZip.file(outSlidePath);
  if (!outSlideFile) return;
  const outXml = await outSlideFile.async("string");

  let outRelsXml =
    (await outZip.file(outRelsPath)?.async("string")) ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  // Rewrite r:embed / r:link references inside the bg fragment so they
  // don't collide with rIds pptxgenjs already wrote into this slide's
  // rels. Mirrors the rId-rewrite logic in injectIntoSlide but scoped
  // to a single fragment + slide rels.
  let rewritten = bgFragment;
  if (/\br:(embed|link|id)="rId\d+"/.test(bgFragment)) {
    const outRels = parseRels(outRelsXml);
    let nextRid =
      [...outRels.keys()].reduce((max, id) => {
        const m = /^rId(\d+)$/.exec(id);
        return m ? Math.max(max, Number(m[1])) : max;
      }, 0) + 1;
    const srcRelsXml =
      (await srcZip
        .file(relsPathFor(sourceSlidePath))
        ?.async("string")) ?? null;
    const srcRels = parseRels(srcRelsXml);
    const sourceDir = dirOf(sourceSlidePath);
    const outDir = dirOf(outSlidePath);
    const newRelLines: string[] = [];
    const ridMap = new Map<string, string>();
    rewritten = bgFragment.replace(
      /\b(r:[a-zA-Z]+)="(rId\d+)"/g,
      (_m, attr: string, srcRid: string) => {
        const cached = ridMap.get(srcRid);
        if (cached) return `${attr}="${cached}"`;
        const srcRel = srcRels.get(srcRid);
        if (!srcRel) return `${attr}="${srcRid}"`;
        const newRid = `rId${nextRid++}`;
        ridMap.set(srcRid, newRid);
        let target = srcRel.target;
        const isExternal = /^https?:\/\//i.test(target);
        const isInternalPart = !isExternal && !target.startsWith("/");
        if (isInternalPart) {
          const srcFullTarget = normalisePath(target, sourceDir);
          const srcFile = srcZip.file(srcFullTarget);
          if (srcFile) {
            const newTarget = uniqueTarget(target, outZip, outDir);
            const newFullTarget = normalisePath(newTarget, outDir);
            outZip.file(newFullTarget, srcFile.async("uint8array"), {
              binary: true,
            });
            target = newTarget;
          }
        }
        newRelLines.push(buildRelXml(newRid, srcRel.type, target));
        return `${attr}="${newRid}"`;
      }
    );
    if (newRelLines.length) {
      const insertAt = outRelsXml.lastIndexOf("</Relationships>");
      outRelsXml =
        insertAt >= 0
          ? outRelsXml.slice(0, insertAt) +
            newRelLines.join("") +
            outRelsXml.slice(insertAt)
          : outRelsXml.replace(
              /<Relationships[^>]*>/,
              (m) => `${m}${newRelLines.join("")}`
            );
      outZip.file(outRelsPath, outRelsXml);
    }
  }

  // Replace pptxgenjs's `<p:bg>...</p:bg>` (or self-closing equivalent) with
  // the source fragment. When the output has no `<p:bg>` yet, insert
  // immediately after `<p:cSld...>` so it precedes `<p:spTree>` per the
  // OOXML schema's ordering.
  let updated = outXml;
  const existingBgRe = /<p:bg\b[\s\S]*?<\/p:bg>|<p:bg\b[^>]*\/\s*>/;
  if (existingBgRe.test(outXml)) {
    updated = outXml.replace(existingBgRe, rewritten);
  } else {
    const cSldOpenMatch = /<p:cSld\b[^>]*>/.exec(outXml);
    if (cSldOpenMatch) {
      const idx = cSldOpenMatch.index + cSldOpenMatch[0].length;
      updated = outXml.slice(0, idx) + rewritten + outXml.slice(idx);
    }
  }
  if (updated !== outXml) outZip.file(outSlidePath, updated);
}

function listPaths(zip: JSZip, prefixes: readonly string[]): string[] {
  const out: string[] = [];
  zip.forEach((relPath) => {
    for (const prefix of prefixes) {
      if (relPath.startsWith(prefix)) {
        out.push(relPath);
        return;
      }
    }
  });
  return out;
}

async function collectChromeMediaRefs(
  srcZip: JSZip,
  chromePaths: string[]
): Promise<Set<string>> {
  const refs = new Set<string>();
  for (const p of chromePaths) {
    if (!p.endsWith(".rels")) continue;
    const xml = await srcZip.file(p)?.async("string");
    if (!xml) continue;
    const rels = parseRels(xml);
    // The owning XML lives at e.g. `ppt/slideMasters/slideMaster1.xml`,
    // its rels at `ppt/slideMasters/_rels/slideMaster1.xml.rels`. Targets
    // are relative to the XML's directory.
    const xmlPath = p.replace("/_rels/", "/").replace(/\.rels$/, "");
    const xmlDir = dirOf(xmlPath);
    for (const { target } of rels.values()) {
      if (/^https?:\/\//i.test(target)) continue;
      const full = normalisePath(target, xmlDir);
      // Pull media but also fonts (sometimes in `ppt/fonts/` already
      // captured by chrome prefixes), embeddings, and any other
      // chrome-adjacent payload — we err on the side of copying so
      // brand-bar logos and embedded font glyphs survive.
      if (
        full.startsWith("ppt/media/") ||
        full.startsWith("ppt/embeddings/") ||
        full.startsWith("ppt/charts/")
      ) {
        refs.add(full);
      }
    }
  }
  return refs;
}

async function rewriteChromeRelsForRenames(
  outZip: JSZip,
  chromePaths: string[],
  renames: Map<string, string>
): Promise<void> {
  for (const p of chromePaths) {
    if (!p.endsWith(".rels")) continue;
    const xml = await outZip.file(p)?.async("string");
    if (!xml) continue;
    const xmlPath = p.replace("/_rels/", "/").replace(/\.rels$/, "");
    const xmlDir = dirOf(xmlPath);
    let changed = false;
    const updated = xml.replace(/Target="([^"]+)"/g, (m, target: string) => {
      if (/^https?:\/\//i.test(target)) return m;
      const full = normalisePath(target, xmlDir);
      const renamed = renames.get(full);
      if (!renamed) return m;
      changed = true;
      return `Target="${relativeTarget(xmlDir, renamed)}"`;
    });
    if (changed) outZip.file(p, updated);
  }
}

function relativeTarget(fromDir: string, toPath: string): string {
  const fromSegs = fromDir.split("/").filter(Boolean);
  const toSegs = toPath.split("/").filter(Boolean);
  let i = 0;
  while (i < fromSegs.length && i < toSegs.length && fromSegs[i] === toSegs[i]) {
    i++;
  }
  const up = fromSegs.length - i;
  const rest = toSegs.slice(i).join("/");
  return up > 0 ? `${"../".repeat(up)}${rest}` : rest;
}

const CONTENT_TYPE_BY_DIR: Record<string, string> = {
  "ppt/slideMasters/":
    "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml",
  "ppt/slideLayouts/":
    "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml",
  "ppt/theme/":
    "application/vnd.openxmlformats-officedocument.theme+xml",
  "ppt/notesMasters/":
    "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml",
  "ppt/handoutMasters/":
    "application/vnd.openxmlformats-officedocument.presentationml.handoutMaster+xml",
  "ppt/tags/":
    "application/vnd.openxmlformats-officedocument.presentationml.tags+xml",
};

async function rewriteContentTypes(
  outZip: JSZip,
  srcChromePaths: string[]
): Promise<void> {
  const file = outZip.file("[Content_Types].xml");
  if (!file) return;
  let xml = await file.async("string");

  // Drop every existing Override under the chrome prefixes — pptxgenjs
  // sometimes declares masters / layouts it never wrote, and we're about
  // to declare the real set from source.
  xml = xml.replace(
    /<Override\b[^/]*PartName="\/(ppt\/(?:slideMasters|slideLayouts|theme|notesMasters|handoutMasters|tags)\/[^"]+)"[^/]*\/>/g,
    ""
  );

  // Build a fresh set of Override entries for chrome XML files we copied.
  const additions: string[] = [];
  const seenParts = new Set<string>();
  // Re-scan existing xml to avoid duplicate part declarations.
  const existingPartRe = /PartName="\/([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = existingPartRe.exec(xml))) seenParts.add(m[1]);

  for (const path of srcChromePaths) {
    if (path.endsWith(".rels")) continue;
    if (!path.endsWith(".xml")) continue;
    const dirMatch = Object.keys(CONTENT_TYPE_BY_DIR).find((d) =>
      path.startsWith(d)
    );
    if (!dirMatch) continue;
    if (seenParts.has(path)) continue;
    additions.push(
      `<Override PartName="/${path}" ContentType="${CONTENT_TYPE_BY_DIR[dirMatch]}"/>`
    );
    seenParts.add(path);
  }

  // Embedded fonts: declare the `.fntdata` extension as a Default once.
  const hasFonts = srcChromePaths.some((p) => p.startsWith("ppt/fonts/"));
  if (hasFonts && !/Extension="fntdata"/i.test(xml)) {
    additions.push(
      `<Default Extension="fntdata" ContentType="application/x-fontdata"/>`
    );
  }

  if (!additions.length) {
    outZip.file("[Content_Types].xml", xml);
    return;
  }

  const closeIdx = xml.lastIndexOf("</Types>");
  if (closeIdx < 0) return;
  const updated =
    xml.slice(0, closeIdx) + additions.join("") + xml.slice(closeIdx);
  outZip.file("[Content_Types].xml", updated);
}

const REL_TYPE_SLIDE_MASTER =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster";
const REL_TYPE_THEME =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";
const REL_TYPE_NOTES_MASTER =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster";
const REL_TYPE_HANDOUT_MASTER =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/handoutMaster";

async function rewritePresentation(
  outZip: JSZip,
  srcZip: JSZip
): Promise<void> {
  const outRelsFile = outZip.file("ppt/_rels/presentation.xml.rels");
  const srcRelsFile = srcZip.file("ppt/_rels/presentation.xml.rels");
  const outPresFile = outZip.file("ppt/presentation.xml");
  const srcPresFile = srcZip.file("ppt/presentation.xml");
  if (!outRelsFile || !srcRelsFile || !outPresFile || !srcPresFile) return;

  const [outRelsXml, srcRelsXml, outPresXml, srcPresXml] = await Promise.all([
    outRelsFile.async("string"),
    srcRelsFile.async("string"),
    outPresFile.async("string"),
    srcPresFile.async("string"),
  ]);
  const outRels = parseRels(outRelsXml);
  const srcRels = parseRels(srcRelsXml);

  // 1. Drop pptxgenjs's chrome rels — slideMaster / theme / notesMaster /
  //    handoutMaster — and remember their rIds so we can scrub them out of
  //    `<p:sldMasterIdLst>` etc. in presentation.xml.
  const droppedRids = new Set<string>();
  const keptRels: Array<[string, { type: string; target: string }]> = [];
  for (const [id, rel] of outRels) {
    if (
      rel.type === REL_TYPE_SLIDE_MASTER ||
      rel.type === REL_TYPE_THEME ||
      rel.type === REL_TYPE_NOTES_MASTER ||
      rel.type === REL_TYPE_HANDOUT_MASTER
    ) {
      droppedRids.add(id);
    } else {
      keptRels.push([id, rel]);
    }
  }

  // 2. Allocate fresh rIds for the source's chrome rels in the output's
  //    rId namespace, and remember the mapping so we can rewrite
  //    presentation.xml's <p:sldMasterId r:id="..."/> entries.
  let nextRid =
    [...outRels.keys(), ...srcRels.keys()].reduce((max, id) => {
      const n = /^rId(\d+)$/.exec(id);
      return n ? Math.max(max, Number(n[1])) : max;
    }, 0) + 1;
  const srcToOutRid = new Map<string, string>();
  const newChromeRels: string[] = [];
  for (const [srcId, rel] of srcRels) {
    if (
      rel.type !== REL_TYPE_SLIDE_MASTER &&
      rel.type !== REL_TYPE_THEME &&
      rel.type !== REL_TYPE_NOTES_MASTER &&
      rel.type !== REL_TYPE_HANDOUT_MASTER
    ) {
      continue;
    }
    const outId = `rId${nextRid++}`;
    srcToOutRid.set(srcId, outId);
    newChromeRels.push(buildRelXml(outId, rel.type, rel.target));
  }

  // 3. Rebuild presentation.xml.rels: kept slide / props rels + new chrome rels.
  const rebuiltRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    keptRels.map(([id, r]) => buildRelXml(id, r.type, r.target)).join("") +
    newChromeRels.join("") +
    `</Relationships>`;
  outZip.file("ppt/_rels/presentation.xml.rels", rebuiltRels);

  // 4. Splice <p:sldMasterIdLst> and <p:notesMasterIdLst> from source into
  //    output's presentation.xml, with r:id values remapped to the new
  //    rIds allocated above. Anything else in the output (sldIdLst, sldSz,
  //    defaultTextStyle, etc.) is left alone — those describe the slide
  //    set pptxgenjs just wrote.
  let pres = outPresXml;
  pres = replaceListElement(
    pres,
    "p:sldMasterIdLst",
    extractListElement(srcPresXml, "p:sldMasterIdLst"),
    srcToOutRid
  );
  pres = replaceListElement(
    pres,
    "p:notesMasterIdLst",
    extractListElement(srcPresXml, "p:notesMasterIdLst"),
    srcToOutRid
  );
  // handoutMasterIdLst is rare but cheap to preserve.
  pres = replaceListElement(
    pres,
    "p:handoutMasterIdLst",
    extractListElement(srcPresXml, "p:handoutMasterIdLst"),
    srcToOutRid
  );

  // 5. Carry over `<p:embeddedFontLst>` verbatim so PowerPoint knows which
  //    embedded fonts to install on open. Font payloads under ppt/fonts/
  //    were already copied as part of the chrome sweep.
  const embeddedFonts = extractListElement(srcPresXml, "p:embeddedFontLst");
  if (embeddedFonts) {
    pres = replaceListElement(pres, "p:embeddedFontLst", embeddedFonts, srcToOutRid);
  }
  outZip.file("ppt/presentation.xml", pres);
}

function extractListElement(xml: string, tag: string): string | null {
  const open = xml.indexOf(`<${tag}`);
  if (open < 0) return null;
  // Self-closing form (`<p:sldMasterIdLst/>`) is legal but uninteresting.
  const selfCloseMatch = new RegExp(`<${tag}\\b[^>]*/\\s*>`).exec(xml);
  if (selfCloseMatch && selfCloseMatch.index === open) return null;
  const close = xml.indexOf(`</${tag}>`, open);
  if (close < 0) return null;
  return xml.slice(open, close + tag.length + 3);
}

function replaceListElement(
  xml: string,
  tag: string,
  newFragment: string | null,
  ridRemap: Map<string, string>
): string {
  if (!newFragment) return xml;
  const remapped = newFragment.replace(
    /\br:id="(rId\d+)"/g,
    (_m, srcRid: string) => {
      const out = ridRemap.get(srcRid);
      return out ? `r:id="${out}"` : `r:id="${srcRid}"`;
    }
  );
  const open = xml.indexOf(`<${tag}`);
  if (open < 0) {
    // Tag not in output → insert just before <p:sldIdLst> if possible,
    // otherwise just before </p:presentation>.
    const sldIdLst = xml.indexOf("<p:sldIdLst");
    if (sldIdLst >= 0) {
      return xml.slice(0, sldIdLst) + remapped + xml.slice(sldIdLst);
    }
    const closePres = xml.lastIndexOf("</p:presentation>");
    return closePres >= 0
      ? xml.slice(0, closePres) + remapped + xml.slice(closePres)
      : xml;
  }
  const selfCloseMatch = new RegExp(`<${tag}\\b[^>]*/\\s*>`).exec(xml);
  if (selfCloseMatch && selfCloseMatch.index === open) {
    return (
      xml.slice(0, selfCloseMatch.index) +
      remapped +
      xml.slice(selfCloseMatch.index + selfCloseMatch[0].length)
    );
  }
  const close = xml.indexOf(`</${tag}>`, open);
  if (close < 0) return xml;
  return xml.slice(0, open) + remapped + xml.slice(close + tag.length + 3);
}

async function rewriteSlideLayoutRefs(
  outZip: JSZip,
  srcZip: JSZip,
  deck: Deck,
  sourceSlidePaths: string[]
): Promise<void> {
  // Pre-compute a default fallback layout target for new slides that have
  // no source counterpart: the first slideLayout the source ships.
  let fallbackLayout: string | undefined;
  srcZip.forEach((relPath) => {
    if (fallbackLayout) return;
    if (
      relPath.startsWith("ppt/slideLayouts/") &&
      relPath.endsWith(".xml") &&
      !relPath.includes("/_rels/")
    ) {
      fallbackLayout = relPath;
    }
  });

  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const slideRelsPath = `ppt/slides/_rels/slide${i + 1}.xml.rels`;
    const outSlideRelsXml = await outZip.file(slideRelsPath)?.async("string");
    if (!outSlideRelsXml) continue;

    const sourceSlidePath =
      ((slide as unknown as Record<string, unknown>)[SOURCE_SLIDE_PATH] as
        | string
        | undefined) ?? sourceSlidePaths[i];
    let layoutTargetFull: string | undefined;
    if (sourceSlidePath) {
      const srcSlideRelsPath = relsPathFor(sourceSlidePath);
      const srcSlideRelsXml = await srcZip
        .file(srcSlideRelsPath)
        ?.async("string");
      if (srcSlideRelsXml) {
        const srcRels = parseRels(srcSlideRelsXml);
        for (const rel of srcRels.values()) {
          if (
            rel.type ===
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"
          ) {
            layoutTargetFull = normalisePath(
              rel.target,
              dirOf(sourceSlidePath)
            );
            break;
          }
        }
      }
    }
    if (!layoutTargetFull && fallbackLayout) {
      layoutTargetFull = fallbackLayout;
    }
    if (!layoutTargetFull) continue;

    // Rewrite the layout target in the output's slide rels. The slide XML
    // itself lives at ppt/slides/slideN.xml, so targets there are
    // relative to ppt/slides/.
    const newTarget = relativeTarget("ppt/slides", layoutTargetFull);
    const updated = outSlideRelsXml.replace(
      /(<Relationship\b[^/]*Type="[^"]*slideLayout"[^/]*Target=")([^"]+)("[^/]*\/>)/,
      `$1${newTarget}$3`
    );
    if (updated !== outSlideRelsXml) {
      outZip.file(slideRelsPath, updated);
    }
  }
}

async function aspectRatiosMatch(
  outZip: JSZip,
  srcZip: JSZip
): Promise<boolean> {
  const [outPres, srcPres] = await Promise.all([
    outZip.file("ppt/presentation.xml")?.async("string"),
    srcZip.file("ppt/presentation.xml")?.async("string"),
  ]);
  if (!outPres || !srcPres) return false;
  const outSz = parseSldSz(outPres);
  const srcSz = parseSldSz(srcPres);
  if (!outSz || !srcSz) return false;
  const outRatio = outSz.cx / outSz.cy;
  const srcRatio = srcSz.cx / srcSz.cy;
  // ~1% tolerance covers floating-point drift; PPTX aspect ratios are
  // exact integer EMU.
  return Math.abs(outRatio - srcRatio) / outRatio < 0.01;
}

function parseSldSz(xml: string): { cx: number; cy: number } | null {
  const m = /<p:sldSz\b[^/]*\bcx="(\d+)"[^/]*\bcy="(\d+)"/.exec(xml);
  if (!m) {
    const m2 = /<p:sldSz\b[^/]*\bcy="(\d+)"[^/]*\bcx="(\d+)"/.exec(xml);
    if (!m2) return null;
    return { cx: Number(m2[2]), cy: Number(m2[1]) };
  }
  return { cx: Number(m[1]), cy: Number(m[2]) };
}

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// -- helpers ----------------------------------------------------------------

function hexNoHash(color: string): string {
  if (!color) return "000000";
  const c = color.trim();
  if (c.startsWith("#")) return c.slice(1).toUpperCase();
  // rgba()/rgb() → strip; pptxgenjs only accepts hex.
  const rgb = c.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => parseInt(p.trim(), 10));
    if (parts.length >= 3) {
      return parts
        .slice(0, 3)
        .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    }
  }
  return c.toUpperCase();
}

function isDataUrl(src: string): boolean {
  return /^data:image\//i.test(src);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
