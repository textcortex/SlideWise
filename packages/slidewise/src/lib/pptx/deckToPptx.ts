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
  UnknownElement,
} from "@/lib/types";
import { pxToInches, pxToPoints } from "./units";
import { SOURCE_PPTX, SOURCE_SLIDE_PATH } from "./pptxToDeck";

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

  for (const slide of deck.slides) {
    addSlide(pptx, slide);
  }

  // Use arraybuffer (universal: works in Node + browser, accepted by JSZip
  // directly) and wrap to Blob only when we're done post-processing.
  const generated = (await pptx.write({
    outputType: "arraybuffer",
  })) as ArrayBuffer;
  return preserveUnknowns(generated, deck, options.source);
}

function addSlide(pptx: pptxgen, slide: Slide): void {
  const s = pptx.addSlide();
  s.background = { color: hexNoHash(slide.background) };

  const sorted = [...slide.elements].sort((a, b) => a.z - b.z);
  for (const el of sorted) {
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
  explicitSource?: Blob | ArrayBuffer | Uint8Array
): Promise<Blob> {
  const wrapBlob = () => new Blob([generated], { type: PPTX_MIME });
  const unknownsBySlide = collectUnknowns(deck);
  if (!unknownsBySlide.size) return wrapBlob();
  // Prefer the caller-supplied source (survives state cloning / localStorage
  // rehydrate); fall back to the non-enumerable attachment from parsePptx
  // for the "parse → serialize" happy path with no state in between.
  const sourceBuffer = await resolveSource(deck, explicitSource);
  if (!sourceBuffer) return wrapBlob();

  const [outZip, srcZip] = await Promise.all([
    JSZip.loadAsync(generated),
    JSZip.loadAsync(sourceBuffer),
  ]);

  // The source's slide-XML paths (in deck order). Used as a fallback when
  // the per-slide non-enumerable attachment has been stripped by state
  // cloning — we then map deck.slides[i] back to source slides[i].
  const sourceSlidePaths = await readSourceSlidePaths(srcZip);

  let sortedIndices = [...unknownsBySlide.keys()].sort((a, b) => a - b);
  for (const slideIndex of sortedIndices) {
    const group = unknownsBySlide.get(slideIndex)!;
    const generatedSlidePath = `ppt/slides/slide${slideIndex + 1}.xml`;
    const generatedRelsPath = `ppt/slides/_rels/slide${slideIndex + 1}.xml.rels`;
    if (!outZip.file(generatedSlidePath)) continue;
    const sourcePath =
      group.sourcePath ?? sourceSlidePaths[slideIndex] ?? undefined;
    if (!sourcePath) continue;
    const sourceRelsPath = relsPathFor(sourcePath);

    await injectUnknownsIntoSlide(
      outZip,
      srcZip,
      generatedSlidePath,
      generatedRelsPath,
      sourceRelsPath,
      group.unknowns
    );
  }

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
  const attached = (deck as unknown as Record<string, unknown>)[SOURCE_PPTX];
  return attached instanceof ArrayBuffer ? attached : undefined;
}

interface UnknownGroup {
  unknowns: UnknownElement[];
  sourcePath: string | undefined;
}

function collectUnknowns(deck: Deck): Map<number, UnknownGroup> {
  const out = new Map<number, UnknownGroup>();
  for (let i = 0; i < deck.slides.length; i++) {
    const slide = deck.slides[i];
    const unknowns = slide.elements.filter(
      (e): e is UnknownElement => e.type === "unknown" && !!e.ooxmlXml
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
 * For one slide: rewrite the preserved fragments so their rIds don't
 * collide with whatever pptxgenjs already allocated, copy the
 * referenced rels + media from the source zip, and splice the
 * fragments in before the closing `</p:spTree>`.
 */
async function injectUnknownsIntoSlide(
  outZip: JSZip,
  srcZip: JSZip,
  generatedSlidePath: string,
  generatedRelsPath: string,
  sourceRelsPath: string,
  unknowns: UnknownElement[]
): Promise<void> {
  const slideXml = await outZip.file(generatedSlidePath)!.async("string");
  const closeIdx = slideXml.lastIndexOf("</p:spTree>");
  if (closeIdx < 0) return;

  const srcRelsXml = (await srcZip.file(sourceRelsPath)?.async("string")) ?? null;
  const outRelsXml =
    (await outZip.file(generatedRelsPath)?.async("string")) ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  const srcRels = parseRels(srcRelsXml);
  const outRels = parseRels(outRelsXml);
  let nextRid = highestRid(outRels) + 1;
  const newRelLines: string[] = [];
  const ridMap = new Map<string, string>();
  // Source slide's directory (used to resolve relative rel targets like
  // "../media/imageN.png" against the source archive).
  const sourceSlidePath = sourceRelsPath.replace(/_rels\/([^/]+)\.rels$/, "$1");
  const sourceDir = dirOf(sourceSlidePath);
  const outDir = dirOf(generatedSlidePath);
  const rewritten: string[] = [];

  for (const u of unknowns) {
    // Every r:id / r:embed / r:link inside the preserved fragment refers
    // to a relationship in the SOURCE slide's rels. Renumber to fresh
    // rIds, copy the matching source rel into the generated rels, and
    // copy the media payload into the generated zip (at a fresh path so
    // pptxgenjs-allocated media doesn't clash with the preserved media).
    // Match every `r:*="rIdN"` attribute. The relationship-namespaced
    // attribute names depend on the schema: `r:id` / `r:embed` / `r:link`
    // for slides + drawings, but charts use `r:id`, SmartArt uses `r:dm`
    // (data model) / `r:cs` (colors) / `r:qs` (quick styles) / `r:lo`
    // (layout), and embedded objects use `r:id`/`r:image`. Restricting to
    // the value pattern `rId\d+` keeps unrelated `r:*` attributes
    // untouched.
    const xml = u.ooxmlXml.replace(
      /\b(r:[a-zA-Z]+)="(rId\d+)"/g,
      (_match, attr, srcRid) => {
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
            // Always copy to a uniquely-prefixed path so we never collide
            // with media pptxgenjs already wrote.
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
    rewritten.push(xml);
  }

  if (rewritten.length) {
    const inject = rewritten.join("");
    const updatedSlide = slideXml.slice(0, closeIdx) + inject + slideXml.slice(closeIdx);
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
