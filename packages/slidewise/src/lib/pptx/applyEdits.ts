/**
 * `applyEdits` — lossless surgical-edit API.
 *
 * Where `serializeDeck` rebuilds an entire `.pptx` from a deck JSON (the lossy
 * round-trip every fidelity bug comes from), `applyEdits` treats an edit as a
 * **patch on the original bytes**: it unzips the source, copies every part
 * verbatim, and mutates ONLY the slide XML / chart / media parts named by an
 * edit. Untouched slides, masters, layouts, theme, fonts, tags, notes and
 * embeddings come out byte-for-byte identical to the source.
 *
 * Elements are addressed by the same stable ids `parsePptx` returns
 * (`deck.slides[i].elements[j].id`). The host flow is:
 *   `parsePptx(source)` → plan edits against the parsed JSON →
 *   `applyEdits(source, plan)`.
 * Slides are addressed by 1-based source-slide index, since a plan is
 * expressed relative to the template.
 *
 * See `.context/attachments/.../applyEdits` spec for the full contract.
 */
import JSZip from "jszip";

import type {
  ChartElement,
  ChartKind,
  DiagramElement,
  DiagramKind,
  DiagramNode,
  TextRun,
} from "../types";
import { getElementLocation } from "./pptxToDeck";
import { reconcileDanglingRels, type SerializeWarning } from "./deckToPptx";
import {
  synthesiseChart,
  synthesiseDiagram,
  RID_MARKER_RE,
  hexBare,
  freshNvId,
} from "./pptxWriters";
// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

/** A bounding box in Slidewise canvas pixels (the same unit elements use). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A chart series — mirrors `ChartElement["series"][number]`. */
export interface Series {
  name: string;
  values: (number | null)[];
  color?: string;
}

/** A run of styled text — a subset of {@link TextRun}. */
export type Run = TextRun;

export type Edit =
  // TEXT — replace a slot's text. `runs` applies emphasis while preserving the
  // box; omit `runs` to keep the template's run styling and just swap text.
  | { op: "setText"; elementId: string; text: string; runs?: Run[] }
  // CLEAR — blank a leftover sample/placeholder slot.
  | { op: "clearText"; elementId: string }
  // CHART (fill existing) — repopulate a native template chart with real data,
  // keeping its type/colors/embedded workbook. The lossless path we most want.
  | {
      op: "setChartData";
      elementId: string;
      categories: string[];
      series: Series[];
    }
  // CHART (add) — draw a NEW native chart into a region.
  | {
      op: "addChart";
      bounds: Rect;
      kind: ChartKind;
      categories: string[];
      series: Series[];
      palette?: string[];
      title?: string;
    }
  // DIAGRAM — a first-class diagram drawn into a region.
  | {
      op: "addDiagram";
      bounds: Rect;
      kind: DiagramKind;
      nodes: DiagramNode[];
      palette?: string[];
    }
  // TABLE — repopulate a native template table, keeping layout/borders/fills.
  | { op: "setTableData"; elementId: string; rows: string[][]; hasHeader?: boolean }
  // IMAGE — replace an image element's bytes honoring fit.
  | {
      op: "setImage";
      elementId: string;
      data: Uint8Array | string;
      fit?: "contain" | "cover";
    }
  // REMOVE — delete an element entirely.
  | { op: "removeElement"; elementId: string };

export interface PlannedSlide {
  /** EXACTLY ONE source. */
  source:
    | { slideIndex: number } // clone template slide N (1-based) verbatim, then edit
    | { layoutId: string; fills?: Record<string, string> }; // instantiate from a layout
  /** Optional; "transparent" => inherit layout chrome; else a CSS colour. */
  background?: "transparent" | string;
  edits: Edit[];
}

export interface EditPlan {
  /** Deck title (also written to docProps). */
  title?: string;
  /** Output order; this defines the final slide set + order. */
  slides: PlannedSlide[];
}

export interface ApplyEditsOptions {
  onWarning?: (warning: SerializeWarning) => void;
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

export async function applyEdits(
  source: Uint8Array,
  plan: EditPlan,
  options: ApplyEditsOptions = {}
): Promise<Uint8Array> {
  const warn = (w: SerializeWarning) => options.onWarning?.(w);
  const zip = await JSZip.loadAsync(source);
  // A second, read-only view of the source. Clones (controlled slide reuse)
  // copy from here so they never pick up edits already applied in-place to a
  // first-use slide part.
  const pristine = await JSZip.loadAsync(source);

  const presPath = "ppt/presentation.xml";
  const presRelsPath = "ppt/_rels/presentation.xml.rels";
  const presXml = await readText(zip, presPath);
  const presRelsXml = await readText(zip, presRelsPath);
  if (!presXml || !presRelsXml) {
    // Not a presentation package we understand — return the input untouched.
    warn({ code: "element-write-failed", message: "missing ppt/presentation.xml" });
    return source;
  }

  // 1-based source slide index -> source part path (presentation order).
  const sourceSlidePaths = resolveSlideOrder(presXml, presRelsXml);

  // Non-slide relationships in presentation.xml.rels are kept verbatim; slide
  // relationships are rebuilt from the plan.
  const presRels = parseRels(presRelsXml);
  const keptPresRels = presRels.filter(
    (r) => relTypeSuffix(r.type) !== "slide"
  );
  let ridCounter = highestRidNumber(presRels);
  const nextPresRid = () => `rId${++ridCounter}`;

  // Build the output slide set in plan order.
  const usedSourcePaths = new Set<string>();
  const outputSlides: { partPath: string; presRid: string }[] = [];

  for (let i = 0; i < plan.slides.length; i++) {
    const planned = plan.slides[i];
    const built = await buildOutputSlide(
      zip,
      pristine,
      planned,
      i,
      sourceSlidePaths,
      usedSourcePaths,
      warn
    );
    if (!built) continue;
    outputSlides.push({ partPath: built, presRid: nextPresRid() });
  }

  if (!outputSlides.length) {
    warn({
      code: "element-write-failed",
      message: "plan produced no slides; returning source unchanged",
    });
    return source;
  }

  // Rewrite presentation.xml.rels: kept non-slide rels + one slide rel each.
  const newPresRels = [
    ...keptPresRels,
    ...outputSlides.map((s) => ({
      id: s.presRid,
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
      target: relativeTo(s.partPath, "ppt"),
      mode: undefined as string | undefined,
    })),
  ];
  zip.file(presRelsPath, serializeRels(newPresRels));

  // Rewrite <p:sldIdLst> in presentation.xml to the new order.
  zip.file(presPath, rewriteSldIdLst(presXml, outputSlides.map((s) => s.presRid)));

  // Deck title -> docProps/core.xml.
  if (plan.title != null) await setDocTitle(zip, plan.title);

  // Drop source slides (and their now-orphaned exclusive parts) that the plan
  // didn't keep, then repair any rels left dangling by element removals.
  await garbageCollect(zip);
  await reconcileDanglingRels(zip);
  await pruneDanglingContentTypes(zip);

  return zip.generateAsync({ type: "uint8array" });
}

// ----------------------------------------------------------------------------
// Slide selection / cloning
// ----------------------------------------------------------------------------

/**
 * Materialise one planned slide into a concrete output part path, applying its
 * edits. The first use of a source slide keeps the original part (so untouched
 * slides stay byte-identical); a repeat clones the part + its editable deps so
 * the two copies can diverge.
 */
async function buildOutputSlide(
  zip: JSZip,
  pristine: JSZip,
  planned: PlannedSlide,
  outIndex: number,
  sourceSlidePaths: string[],
  used: Set<string>,
  warn: (w: SerializeWarning) => void
): Promise<string | null> {
  // Instantiate from one of the source's own layouts. The layout is already a
  // part of `source`, so binding a fresh slide to it is still a lossless patch
  // (no chrome rewrite) — it inherits theme/master/background and its
  // placeholders become addressable, fillable elements.
  if (!("slideIndex" in planned.source)) {
    const built = await instantiateLayoutSlide(
      zip,
      pristine,
      planned.source.layoutId,
      planned.source.fills,
      outIndex,
      warn
    );
    if (!built) return null; // unresolved layout — warned, skip (don't ship wrong slide)
    await applySlideEdits(zip, built.partPath, planned, outIndex, warn, built.instantiated);
    return built.partPath;
  }

  const idx1 = planned.source.slideIndex;
  const srcPath = sourceSlidePaths[idx1 - 1];
  if (!srcPath) {
    warn({
      code: "element-write-failed",
      message: `slide ${outIndex + 1}: source slideIndex ${idx1} out of range`,
      slideIndex: outIndex,
    });
    return null;
  }

  let partPath = srcPath;
  if (used.has(srcPath)) {
    partPath = await cloneSlideDeep(zip, pristine, srcPath);
  }
  used.add(srcPath);

  await applySlideEdits(zip, partPath, planned, outIndex, warn, new Map());
  return partPath;
}

/**
 * Deep-clone a slide part: copy the slide XML, its `.rels`, and every
 * non-chrome dependency (charts + workbooks, media, notes) to fresh paths,
 * rewriting the slide's rels to the copies. Shared chrome (layout/master/theme)
 * keeps pointing at the originals. Used for controlled slide reuse so edits to
 * one copy never bleed into another.
 */
async function cloneSlideDeep(zip: JSZip, pristine: JSZip, srcPath: string): Promise<string> {
  const newSlidePath = freshPartPath(zip, "ppt/slides", "slide", "xml");
  const slideXml = (await readText(pristine, srcPath)) ?? "";

  const srcRelsXml = await readText(pristine, relsPathFor(srcPath));
  const rels = srcRelsXml ? parseRels(srcRelsXml) : [];
  const srcDir = dirOf(srcPath);

  const cloned: typeof rels = [];
  for (const rel of rels) {
    if (rel.mode === "External" || /^https?:\/\//i.test(rel.target)) {
      cloned.push(rel);
      continue;
    }
    const suffix = relTypeSuffix(rel.type);
    // Shared, read-only chrome — keep pointing at the original part.
    if (suffix === "slideLayout" || suffix === "slideMaster" || suffix === "theme") {
      cloned.push(rel);
      continue;
    }
    const targetFull = normalisePath(rel.target, srcDir);
    const copyFull = await copyPartTree(zip, pristine, targetFull);
    cloned.push({ ...rel, target: relativeTo(copyFull, srcDir) });
  }

  zip.file(newSlidePath, slideXml);
  zip.file(relsPathFor(newSlidePath), serializeRels(cloned));
  await ensureOverride(zip, "/" + newSlidePath, await overrideTypeFor(zip, "/" + srcPath));
  return newSlidePath;
}

/**
 * Copy a part and (recursively) the parts it references to fresh unique paths,
 * returning the new path of the root. Each copied part's `.rels` is rewritten
 * to point at the copies. Idempotent within a single call chain via `seen`.
 */
async function copyPartTree(
  zip: JSZip,
  pristine: JSZip,
  partPath: string,
  seen = new Map<string, string>()
): Promise<string> {
  const existing = seen.get(partPath);
  if (existing) return existing;

  const file = pristine.file(partPath);
  if (!file) return partPath; // missing — leave the reference for reconcile.

  const dir = dirOf(partPath);
  const base = baseOf(partPath);
  const dot = base.lastIndexOf(".");
  const stem = dot >= 0 ? base.slice(0, dot) : base;
  const ext = dot >= 0 ? base.slice(dot + 1) : "bin";
  const newPath = freshPartPath(zip, dir, `${stem}_sw`, ext);
  seen.set(partPath, newPath);

  const data = await file.async("uint8array");
  zip.file(newPath, data);
  await ensureOverride(zip, "/" + newPath, await overrideTypeFor(zip, "/" + partPath));

  const relsXml = await readText(pristine, relsPathFor(partPath));
  if (relsXml) {
    const rels = parseRels(relsXml);
    const rewritten = [] as typeof rels;
    for (const rel of rels) {
      if (rel.mode === "External" || /^https?:\/\//i.test(rel.target)) {
        rewritten.push(rel);
        continue;
      }
      const childFull = normalisePath(rel.target, dir);
      const childCopy = await copyPartTree(zip, pristine, childFull, seen);
      rewritten.push({ ...rel, target: relativeTo(childCopy, dir) });
    }
    zip.file(relsPathFor(newPath), serializeRels(rewritten));
  }
  return newPath;
}

// ----------------------------------------------------------------------------
// Layout instantiation (source: { layoutId, fills })
// ----------------------------------------------------------------------------

/**
 * Deterministic element id for a placeholder slot of a layout-instantiated
 * slide. The host computes the same id (from `summarizeLayouts(deck)` keys) to
 * target the slot with `setText` / `setImage` / `removeElement` edits.
 */
export function layoutSlotElementId(layoutId: string, placeholderKey: string): string {
  return `${layoutId}::${placeholderKey}`;
}

interface LayoutPh {
  /** Raw `<p:ph type>` (undefined => OOXML "body" default). */
  rawType: string | undefined;
  idx: number | undefined;
  /** `placeholderKey`-style: `type:idx` | `type` | `idx` | "". */
  key: string;
  xEmu: number;
  yEmu: number;
  wEmu: number;
  hEmu: number;
  category: "text" | "picture" | "chart" | "table" | "other";
}

const TEXT_PH = new Set(["", "title", "ctrTitle", "subTitle", "body", "obj"]);
const SKIP_PH = new Set(["dt", "ftr", "sldNum"]); // auto chrome fields — inherit, don't instantiate

function phCategory(rawType: string | undefined): LayoutPh["category"] {
  const t = rawType ?? "";
  if (TEXT_PH.has(t)) return "text";
  if (t === "pic" || t === "clipArt") return "picture";
  if (t === "chart") return "chart";
  if (t === "tbl") return "table";
  return "other";
}

function phKey(rawType: string | undefined, idx: number | undefined): string {
  const t = rawType ?? "";
  if (t && idx != null) return `${t}:${idx}`;
  if (t) return t;
  if (idx != null) return String(idx);
  return "";
}

/** Resolve a `fills` entry for a placeholder, matching `placeholderKey` order. */
function fillFor(rawType: string | undefined, idx: number | undefined, fills?: Record<string, string>): string {
  if (!fills) return "";
  const t = rawType ?? "";
  const byTypeIdx = t && idx != null ? fills[`${t}:${idx}`] : undefined;
  const byType = t ? fills[t] : undefined;
  const byIdx = idx != null ? fills[String(idx)] : undefined;
  return byTypeIdx ?? byType ?? byIdx ?? "";
}

/**
 * Read a layout's placeholders with EMU geometry, resolving the geometry from
 * the layout's own `<a:xfrm>` and falling back to the matching master slot.
 * EMU-native (no canvas-px fit round-trip), self-contained for the patch path.
 */
async function readLayoutPlaceholders(pristine: JSZip, layoutPath: string): Promise<LayoutPh[]> {
  const layoutXml = await readText(pristine, layoutPath);
  if (!layoutXml) return [];

  // Master fallback geometry, keyed by `type:idx` and `type`.
  const masterGeo = new Map<string, { x: number; y: number; w: number; h: number }>();
  const layoutRels = parseRels((await readText(pristine, relsPathFor(layoutPath))) ?? EMPTY_RELS);
  const masterRel = layoutRels.find((r) => relTypeSuffix(r.type) === "slideMaster");
  if (masterRel) {
    const masterPath = normalisePath(masterRel.target, dirOf(layoutPath));
    const masterXml = await readText(pristine, masterPath);
    if (masterXml) {
      for (const sp of masterXml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []) {
        const ph = /<p:ph\b[^>]*>/.exec(sp) ?? /<p:ph\b[^>]*\/>/.exec(sp);
        if (!ph) continue;
        const type = /\btype="([^"]+)"/.exec(ph[0])?.[1] ?? "";
        const idx = /\bidx="(\d+)"/.exec(ph[0])?.[1];
        const geo = readXfrmEmu(sp);
        if (!geo) continue;
        if (type && idx != null) masterGeo.set(`${type}:${idx}`, geo);
        if (type) masterGeo.set(type, geo);
        if (idx != null) masterGeo.set(idx, geo);
      }
    }
  }

  const out: LayoutPh[] = [];
  for (const sp of layoutXml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []) {
    const ph = /<p:ph\b[^>]*\/?>/.exec(sp);
    if (!ph) continue;
    const rawType = /\btype="([^"]+)"/.exec(ph[0])?.[1];
    if (rawType && SKIP_PH.has(rawType)) continue;
    const idxStr = /\bidx="(\d+)"/.exec(ph[0])?.[1];
    const idx = idxStr != null ? Number(idxStr) : undefined;

    const geo =
      readXfrmEmu(sp) ??
      (rawType && idx != null ? masterGeo.get(`${rawType}:${idx}`) : undefined) ??
      (rawType ? masterGeo.get(rawType) : undefined) ??
      (idx != null ? masterGeo.get(String(idx)) : undefined);
    if (!geo) continue; // no resolvable geometry → not instantiable

    out.push({
      rawType,
      idx,
      key: phKey(rawType, idx),
      xEmu: geo.x,
      yEmu: geo.y,
      wEmu: geo.w,
      hEmu: geo.h,
      category: phCategory(rawType),
    });
  }
  return out;
}

function readXfrmEmu(sp: string): { x: number; y: number; w: number; h: number } | null {
  const off = /<a:off\b[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"[^>]*\/>/.exec(sp);
  const ext = /<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"[^>]*\/>/.exec(sp);
  if (!off || !ext) return null;
  return { x: Number(off[1]), y: Number(off[2]), w: Number(ext[1]), h: Number(ext[2]) };
}

/**
 * Build a fresh slide bound to a source layout. The new slide's `.rels` points
 * at the existing `ppt/slideLayouts/<layoutId>.xml` (so it inherits theme /
 * master / background chrome verbatim), and each layout placeholder becomes an
 * addressable element keyed by `layoutSlotElementId(layoutId, key)`:
 * text/`obj` → an `<p:sp>` with a `<p:txBody>` (populated from `fills`),
 * picture → a `<p:pic>` with a transparent placeholder blip (so `setImage` can
 * repoint it), and chart/table/other → a positioned `<p:sp>` that exposes the
 * slot geometry (the host fills it with `addChart`/`addDiagram`).
 */
async function instantiateLayoutSlide(
  zip: JSZip,
  pristine: JSZip,
  layoutId: string,
  fills: Record<string, string> | undefined,
  outIndex: number,
  warn: (w: SerializeWarning) => void
): Promise<{ partPath: string; instantiated: Map<string, string> } | null> {
  const layoutPath = `ppt/slideLayouts/${layoutId}.xml`;
  if (!pristine.file(layoutPath)) {
    warn({
      code: "layout-unresolved",
      message: `slide ${outIndex + 1}: layout "${layoutId}" not found at ${layoutPath}`,
      layoutId,
      slideIndex: outIndex,
    });
    return null;
  }

  const placeholders = await readLayoutPlaceholders(pristine, layoutPath);
  const slidePath = freshPartPath(zip, "ppt/slides", "slide", "xml");
  const instantiated = new Map<string, string>();

  const rels: Rel[] = [
    { id: "rId1", type: SLIDE_LAYOUT_REL_TYPE, target: `../slideLayouts/${layoutId}.xml`, mode: undefined },
  ];
  let needsPlaceholderMedia = false;
  const placeholderBlipRid = "rId2";

  const children = placeholders.map((ph) => {
    const elementId = layoutSlotElementId(layoutId, ph.key);
    const xfrm =
      `<a:xfrm><a:off x="${ph.xEmu}" y="${ph.yEmu}"/>` +
      `<a:ext cx="${Math.max(1, ph.wEmu)}" cy="${Math.max(1, ph.hEmu)}"/></a:xfrm>`;
    const phTag =
      `<p:ph${ph.rawType ? ` type="${ph.rawType}"` : ""}${ph.idx != null ? ` idx="${ph.idx}"` : ""}/>`;
    const name = `${ph.rawType ?? "Body"} ${ph.idx ?? ""}`.trim();
    let block: string;
    if (ph.category === "picture") {
      needsPlaceholderMedia = true;
      block =
        `<p:pic>` +
        `<p:nvPicPr><p:cNvPr id="${freshNvId()}" name="${escapeAttr(name)}"/>` +
        `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr>${phTag}</p:nvPr></p:nvPicPr>` +
        `<p:blipFill><a:blip r:embed="${placeholderBlipRid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
        `<p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
        `</p:pic>`;
    } else {
      const fill = ph.category === "text" ? fillFor(ph.rawType, ph.idx, fills) : "";
      const para = fill
        ? `<a:p><a:r><a:rPr lang="en-US"/><a:t>${escapeText(fill)}</a:t></a:r></a:p>`
        : `<a:p/>`;
      block =
        `<p:sp>` +
        `<p:nvSpPr><p:cNvPr id="${freshNvId()}" name="${escapeAttr(name)}"/>` +
        `<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${phTag}</p:nvPr></p:nvSpPr>` +
        `<p:spPr>${xfrm}</p:spPr>` +
        `<p:txBody><a:bodyPr/><a:lstStyle/>${para}</p:txBody>` +
        `</p:sp>`;
    }
    instantiated.set(elementId, block);
    return block;
  });

  const slideXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:p="${NS_P}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    children.join("") +
    `</p:spTree></p:cSld></p:sld>`;

  if (needsPlaceholderMedia) {
    const mediaPath = baseOf(freshPartPath(zip, "ppt/media", "imageSWph", "png"));
    const full = `ppt/media/${mediaPath}`;
    zip.file(full, TRANSPARENT_PNG.slice());
    await ensureDefault(zip, "png", "image/png");
    rels.push({ id: placeholderBlipRid, type: IMAGE_REL_TYPE, target: `../media/${mediaPath}`, mode: undefined });
  }

  zip.file(slidePath, slideXml);
  zip.file(relsPathFor(slidePath), serializeRels(rels));
  await ensureOverride(zip, "/" + slidePath, SLIDE_CONTENT_TYPE);
  return { partPath: slidePath, instantiated };
}

// ----------------------------------------------------------------------------
// Edit application
// ----------------------------------------------------------------------------

async function applySlideEdits(
  zip: JSZip,
  slidePath: string,
  planned: PlannedSlide,
  outIndex: number,
  warn: (w: SerializeWarning) => void,
  instantiated: Map<string, string>
): Promise<void> {
  let slideXml = (await readText(zip, slidePath)) ?? "";
  const relsPath = relsPathFor(slidePath);
  let rels = parseRels((await readText(zip, relsPath)) ?? EMPTY_RELS);
  let relsDirty = false;

  const slideDir = dirOf(slidePath);
  const nextRid = () => {
    const id = `rId${highestRidNumber(rels) + 1}`;
    return id;
  };

  for (const edit of planned.edits) {
    try {
      switch (edit.op) {
        case "setText":
          slideXml = editSetText(slideXml, edit.elementId, edit.text, edit.runs, slidePath, outIndex, warn, instantiated);
          break;
        case "clearText":
          slideXml = editSetText(slideXml, edit.elementId, "", undefined, slidePath, outIndex, warn, instantiated);
          break;
        case "removeElement": {
          const r = editRemoveElement(slideXml, edit.elementId, rels, slidePath, outIndex, warn, instantiated);
          slideXml = r.slideXml;
          if (r.relsChanged) relsDirty = true;
          break;
        }
        case "setTableData":
          slideXml = editSetTableData(slideXml, edit.elementId, edit.rows, slidePath, outIndex, warn, instantiated);
          break;
        case "setChartData":
          await editSetChartData(zip, slideXml, edit, rels, slideDir, slidePath, outIndex, warn, instantiated);
          break;
        case "setImage": {
          const rid = nextRid();
          const r = editSetImage(slideXml, edit, rid, slidePath, outIndex, warn, instantiated);
          if (r) {
            slideXml = r.slideXml;
            zip.file(r.media.fullPath, r.media.data);
            await ensureDefault(zip, r.media.ext, r.media.contentType);
            rels.push({ id: rid, type: IMAGE_REL_TYPE, target: r.media.relTarget, mode: undefined });
            relsDirty = true;
          }
          break;
        }
        case "addChart": {
          const rid = nextRid();
          const r = await editAddChart(zip, slideXml, edit, rid);
          slideXml = r.slideXml;
          rels.push({ id: rid, type: CHART_REL_TYPE, target: r.relTarget, mode: undefined });
          relsDirty = true;
          break;
        }
        case "addDiagram":
          slideXml = editAddDiagram(slideXml, edit);
          break;
      }
    } catch (err) {
      warn({
        code: "element-write-failed",
        message: `slide ${outIndex + 1}: edit "${edit.op}" failed: ${(err as Error).message}`,
        elementId: "elementId" in edit ? edit.elementId : undefined,
        slideIndex: outIndex,
      });
    }
  }

  if (planned.background !== undefined) {
    slideXml = applyBackground(slideXml, planned.background);
  }

  zip.file(slidePath, slideXml);
  if (relsDirty) zip.file(relsPath, serializeRels(rels));
}

// -- text --------------------------------------------------------------------

function editSetText(
  slideXml: string,
  elementId: string,
  text: string,
  runs: Run[] | undefined,
  slidePath: string,
  outIndex: number,
  warn: (w: SerializeWarning) => void,
  instantiated: Map<string, string>
): string {
  const block = locateBlock(slideXml, elementId, slidePath, outIndex, warn, instantiated);
  if (!block) return slideXml;
  const next = rewriteTextBody(block, text, runs);
  return slideXml.replace(block, next);
}

/**
 * Replace the visible text of a shape's `<p:txBody>`. With `runs` omitted we
 * keep the template's first run/paragraph styling and just swap the text; with
 * `runs` we rebuild the paragraph from the supplied runs (bold/colour/etc).
 */
function rewriteTextBody(block: string, text: string, runs?: Run[]): string {
  const txMatch = /<p:txBody>([\s\S]*?)<\/p:txBody>/.exec(block);
  const inner = txMatch?.[1] ?? "";
  const bodyPr = firstElement(inner, "a:bodyPr");
  const lstStyle = firstElement(inner, "a:lstStyle");
  const firstPPr = firstElement(inner, "a:pPr");
  const firstRPr = firstElement(inner, "a:rPr");

  const head = (bodyPr ?? "<a:bodyPr/>") + (lstStyle ?? "<a:lstStyle/>");

  let paras: string;
  if (runs && runs.length) {
    const runXml = runs.map((r) => runToXml(r)).join("");
    paras = `<a:p>${firstPPr ?? ""}${runXml}</a:p>`;
  } else {
    const lines = text.split("\n");
    paras = lines
      .map((line) => {
        if (line === "") return `<a:p>${firstPPr ?? ""}</a:p>`;
        const rPr = firstRPr ?? `<a:rPr lang="en-US"/>`;
        return `<a:p>${firstPPr ?? ""}<a:r>${rPr}<a:t>${escapeText(line)}</a:t></a:r></a:p>`;
      })
      .join("");
  }
  const newTxBody = `<p:txBody>${head}${paras}</p:txBody>`;

  if (txMatch) return block.replace(txMatch[0], newTxBody);
  // No existing txBody (e.g. an empty autoshape) — append one before </p:sp>.
  return block.replace(/<\/p:sp>\s*$/, `${newTxBody}</p:sp>`);
}

function runToXml(r: Run): string {
  const attrs: string[] = [`lang="en-US"`];
  if (r.fontSize != null) attrs.push(`sz="${Math.round(r.fontSize * 100)}"`);
  if (r.fontWeight != null) attrs.push(`b="${r.fontWeight >= 600 ? 1 : 0}"`);
  if (r.italic) attrs.push(`i="1"`);
  if (r.underline) attrs.push(`u="sng"`);
  if (r.strike) attrs.push(`strike="sngStrike"`);
  const kids: string[] = [];
  if (r.color) kids.push(`<a:solidFill><a:srgbClr val="${hexBare(r.color)}"/></a:solidFill>`);
  if (r.fontFamily) kids.push(`<a:latin typeface="${escapeAttr(r.fontFamily)}"/>`);
  const rPr = kids.length
    ? `<a:rPr ${attrs.join(" ")}>${kids.join("")}</a:rPr>`
    : `<a:rPr ${attrs.join(" ")}/>`;
  const textParts = (r.text ?? "").split("\n");
  return textParts
    .map((t, i) => (i === 0 ? "" : "<a:br/>") + `<a:r>${rPr}<a:t>${escapeText(t)}</a:t></a:r>`)
    .join("");
}

// -- remove ------------------------------------------------------------------

function editRemoveElement(
  slideXml: string,
  elementId: string,
  rels: Rel[],
  slidePath: string,
  outIndex: number,
  warn: (w: SerializeWarning) => void,
  instantiated: Map<string, string>
): { slideXml: string; relsChanged: boolean } {
  const block = locateBlock(slideXml, elementId, slidePath, outIndex, warn, instantiated);
  if (!block) return { slideXml, relsChanged: false };
  const without = slideXml.replace(block, "");

  // Drop slide rels referenced only by the removed block (the part itself is
  // reclaimed later by garbageCollect).
  const rids = [...block.matchAll(/r:(?:id|embed|link)="([^"]+)"/g)].map((m) => m[1]);
  let relsChanged = false;
  for (const rid of new Set(rids)) {
    if (!new RegExp(`"${rid}"`).test(without)) {
      const i = rels.findIndex((r) => r.id === rid);
      if (i >= 0) {
        rels.splice(i, 1);
        relsChanged = true;
      }
    }
  }
  return { slideXml: without, relsChanged };
}

// -- table -------------------------------------------------------------------

function editSetTableData(
  slideXml: string,
  elementId: string,
  rows: string[][],
  slidePath: string,
  outIndex: number,
  warn: (w: SerializeWarning) => void,
  instantiated: Map<string, string>
): string {
  const block = locateBlock(slideXml, elementId, slidePath, outIndex, warn, instantiated);
  if (!block) return slideXml;
  const tblMatch = /<a:tbl>[\s\S]*<\/a:tbl>/.exec(block);
  if (!tblMatch) {
    warn({ code: "element-write-failed", message: `setTableData: element ${elementId} is not a table`, elementId, slideIndex: outIndex });
    return slideXml;
  }
  const trRe = /<a:tr\b[\s\S]*?<\/a:tr>/g;
  let r = 0;
  const newTbl = tblMatch[0].replace(trRe, (tr) => {
    const rowData = rows[r++];
    if (!rowData) return tr;
    let c = 0;
    return tr.replace(/<a:tc\b[\s\S]*?<\/a:tc>/g, (tc) => {
      const val = rowData[c++];
      if (val == null) return tc;
      return rewriteTableCell(tc, val);
    });
  });
  const nextBlock = block.replace(tblMatch[0], newTbl);
  return slideXml.replace(block, nextBlock);
}

function rewriteTableCell(tc: string, text: string): string {
  const txMatch = /<a:txBody>([\s\S]*?)<\/a:txBody>/.exec(tc);
  if (!txMatch) return tc;
  const inner = txMatch[1];
  const bodyPr = firstElement(inner, "a:bodyPr") ?? "<a:bodyPr/>";
  const lstStyle = firstElement(inner, "a:lstStyle") ?? "<a:lstStyle/>";
  const firstPPr = firstElement(inner, "a:pPr") ?? "";
  const firstRPr = firstElement(inner, "a:rPr") ?? `<a:rPr lang="en-US"/>`;
  const lines = text.split("\n");
  const paras = lines
    .map((line) =>
      line === ""
        ? `<a:p>${firstPPr}</a:p>`
        : `<a:p>${firstPPr}<a:r>${firstRPr}<a:t>${escapeText(line)}</a:t></a:r></a:p>`
    )
    .join("");
  return tc.replace(txMatch[0], `<a:txBody>${bodyPr}${lstStyle}${paras}</a:txBody>`);
}

// -- chart (fill existing) ---------------------------------------------------

async function editSetChartData(
  zip: JSZip,
  slideXml: string,
  edit: Extract<Edit, { op: "setChartData" }>,
  slideRels: Rel[],
  slideDir: string,
  slidePath: string,
  outIndex: number,
  warn: (w: SerializeWarning) => void,
  instantiated: Map<string, string>
): Promise<void> {
  const block = locateBlock(slideXml, edit.elementId, slidePath, outIndex, warn, instantiated);
  if (!block) return;
  const chartRid = /<c:chart\b[^>]*\br:id="([^"]+)"/.exec(block)?.[1];
  const rel = chartRid ? slideRels.find((r) => r.id === chartRid) : undefined;
  if (!rel) {
    warn({ code: "element-write-failed", message: `setChartData: element ${edit.elementId} has no chart relationship`, elementId: edit.elementId, slideIndex: outIndex });
    return;
  }
  const chartPath = normalisePath(rel.target, slideDir);
  const chartXml = await readText(zip, chartPath);
  if (!chartXml) {
    warn({ code: "element-write-failed", message: `setChartData: chart part ${chartPath} missing`, elementId: edit.elementId, slideIndex: outIndex });
    return;
  }

  const updated = rewriteChartSeries(chartXml, edit.categories, edit.series);

  // Regenerate the embedded workbook so Edit-Data reflects the new data, and
  // make sure the chart references it via <c:externalData>.
  const chartRelsPath = relsPathFor(chartPath);
  const chartDir = dirOf(chartPath);
  const chartRels = parseRels((await readText(zip, chartRelsPath)) ?? EMPTY_RELS);
  const wbRel = chartRels.find((r) => relTypeSuffix(r.type) === "package");
  const workbook = await buildChartWorkbook(edit.categories, edit.series);

  let finalChartXml = updated;
  if (wbRel) {
    // Overwrite the existing embedded workbook in place — the chart already
    // references it via <c:externalData>, so caches + workbook stay in sync.
    zip.file(normalisePath(wbRel.target, chartDir), workbook);
  } else {
    const wbName = baseOf(freshPartPath(zip, "ppt/embeddings", "MicrosoftSWWorkbook", "xlsx"));
    const wbPath = `ppt/embeddings/${wbName}`;
    zip.file(wbPath, workbook);
    await ensureOverride(zip, "/" + wbPath, XLSX_CONTENT_TYPE);
    const wbRid = `rId${highestRidNumber(chartRels) + 1}`;
    chartRels.push({ id: wbRid, type: PACKAGE_REL_TYPE, target: relativeTo(wbPath, chartDir), mode: undefined });
    zip.file(chartRelsPath, serializeRels(chartRels));
    finalChartXml = ensureExternalData(updated, wbRid);
  }
  zip.file(chartPath, finalChartXml);
}

/**
 * Replace each series' `<c:tx>`/`<c:cat>`/`<c:val>` with the new categories +
 * values while leaving the chart type, colours (`<c:spPr>`), data-label and
 * marker settings untouched. Series are matched by position; extras are dropped
 * and missing ones cloned from the first series as a template.
 */
function rewriteChartSeries(chartXml: string, categories: string[], series: Series[]): string {
  const serRe = /<c:ser>[\s\S]*?<\/c:ser>/g;
  const existing = chartXml.match(serRe) ?? [];
  if (!existing.length) return chartXml;

  const template = existing[0];
  const firstSer = existing[0];
  const lastSer = existing[existing.length - 1];
  if (!firstSer || !lastSer) return chartXml;
  const built: string[] = series.map((s, i) => {
    const base = existing[i] ?? template;
    return buildSer(base, i, categories, s);
  });

  // Splice the new series list in place of the old one.
  const firstIdx = chartXml.indexOf(firstSer);
  const lastIdx = chartXml.indexOf(lastSer) + lastSer.length;
  return chartXml.slice(0, firstIdx) + built.join("") + chartXml.slice(lastIdx);
}

function buildSer(template: string, idx: number, categories: string[], s: Series): string {
  let ser = template;
  // idx / order
  ser = ser.replace(/<c:idx val="[^"]*"\/>/, `<c:idx val="${idx}"/>`);
  ser = ser.replace(/<c:order val="[^"]*"\/>/, `<c:order val="${idx}"/>`);

  const col = colLetter(idx + 1); // A reserved for categories
  const n = categories.length;
  const tx = `<c:tx><c:strRef><c:f>Sheet1!$${col}$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${escapeText(s.name || `Series ${idx + 1}`)}</c:v></c:pt></c:strCache></c:strRef></c:tx>`;
  const catPts = categories.map((c, i) => `<c:pt idx="${i}"><c:v>${escapeText(String(c))}</c:v></c:pt>`).join("");
  const cat = `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${n + 1}</c:f><c:strCache><c:ptCount val="${n}"/>${catPts}</c:strCache></c:strRef></c:cat>`;
  const valPts = s.values.map((v, i) => (v == null ? "" : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join("");
  const val = `<c:val><c:numRef><c:f>Sheet1!$${col}$2:$${col}$${n + 1}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${s.values.length}"/>${valPts}</c:numCache></c:numRef></c:val>`;

  if (/<c:tx>[\s\S]*?<\/c:tx>/.test(ser)) ser = ser.replace(/<c:tx>[\s\S]*?<\/c:tx>/, tx);
  else ser = ser.replace(/(<c:order val="[^"]*"\/>)/, `$1${tx}`);

  if (/<c:cat>[\s\S]*?<\/c:cat>/.test(ser)) ser = ser.replace(/<c:cat>[\s\S]*?<\/c:cat>/, cat);
  else ser = ser.replace(/(<c:val>)/, `${cat}$1`);

  if (/<c:val>[\s\S]*?<\/c:val>/.test(ser)) ser = ser.replace(/<c:val>[\s\S]*?<\/c:val>/, val);
  else ser = ser.replace(/(<\/c:ser>)/, `${val}$1`);

  // Apply an explicit series colour when supplied (keeps template colour if not).
  if (s.color) {
    const spPr = `<c:spPr><a:solidFill><a:srgbClr val="${hexBare(s.color)}"/></a:solidFill></c:spPr>`;
    if (/<c:spPr>[\s\S]*?<\/c:spPr>/.test(ser)) ser = ser.replace(/<c:spPr>[\s\S]*?<\/c:spPr>/, spPr);
    else ser = ser.replace(/(<c:tx>[\s\S]*?<\/c:tx>)/, `$1${spPr}`);
  }
  return ser;
}

function ensureExternalData(chartXml: string, rid: string): string {
  if (/<c:externalData\b/.test(chartXml)) return chartXml;
  const ext = `<c:externalData r:id="${rid}"><c:autoUpdate val="0"/></c:externalData>`;
  return chartXml.replace(/<\/c:chartSpace>/, `${ext}</c:chartSpace>`);
}

// -- image -------------------------------------------------------------------

function editSetImage(
  slideXml: string,
  edit: Extract<Edit, { op: "setImage" }>,
  newRid: string,
  slidePath: string,
  outIndex: number,
  warn: (w: SerializeWarning) => void,
  instantiated: Map<string, string>
): { slideXml: string; media: DecodedMedia } | null {
  const block = locateBlock(slideXml, edit.elementId, slidePath, outIndex, warn, instantiated);
  if (!block) return null;
  const blipMatch = /<a:blip\b[^>]*\br:embed="([^"]+)"/.exec(block);
  if (!blipMatch) {
    warn({ code: "element-write-failed", message: `setImage: element ${edit.elementId} has no image blip`, elementId: edit.elementId, slideIndex: outIndex });
    return null;
  }
  const media = decodeMedia(edit.data, edit.elementId);
  // Repoint the blip at a fresh media part rather than overwriting bytes in
  // place — the old media is reclaimed by garbageCollect if nothing else uses
  // it, and a new extension/content-type stays correct.
  const newBlock = block.replace(
    new RegExp(`(<a:blip\\b[^>]*\\br:embed=")${escapeRegExp(blipMatch[1])}(")`),
    `$1${newRid}$2`
  );
  return { slideXml: slideXml.replace(block, newBlock), media };
}

// -- add chart / diagram -----------------------------------------------------

async function editAddChart(
  zip: JSZip,
  slideXml: string,
  edit: Extract<Edit, { op: "addChart" }>,
  rid: string
): Promise<{ slideXml: string; relTarget: string }> {
  const el: ChartElement = {
    id: `add_${rid}`,
    type: "chart",
    x: edit.bounds.x,
    y: edit.bounds.y,
    w: edit.bounds.w,
    h: edit.bounds.h,
    rotation: 0,
    z: 0,
    kind: edit.kind,
    categories: edit.categories,
    series: edit.series,
    ...(edit.title ? { title: edit.title } : {}),
  };
  const synth = synthesiseChart(el);
  const partPath = freshSynthPath(zip, synth.partPath);
  const partRelsPath = relsPathFor(partPath);
  zip.file(partPath, synth.chartXml);
  zip.file(partRelsPath, synth.chartRelsXml);
  await ensureOverride(zip, "/" + partPath, CHART_CONTENT_TYPE);

  const graphicFrame = synth.graphicFrameXml.replace(RID_MARKER_RE, rid);
  const next = spliceIntoSpTree(slideXml, graphicFrame);
  return { slideXml: next, relTarget: relativeTo(partPath, "ppt/slides") };
}

function editAddDiagram(slideXml: string, edit: Extract<Edit, { op: "addDiagram" }>): string {
  const el: DiagramElement = {
    id: `dgm_${Math.abs(hashString(JSON.stringify(edit.nodes))).toString(36)}`,
    type: "diagram",
    x: edit.bounds.x,
    y: edit.bounds.y,
    w: edit.bounds.w,
    h: edit.bounds.h,
    rotation: 0,
    z: 0,
    kind: edit.kind,
    nodes: edit.nodes,
    ...(edit.palette ? { palette: edit.palette } : {}),
  };
  const synth = synthesiseDiagram(el);
  return spliceIntoSpTree(slideXml, synth.xml);
}

function spliceIntoSpTree(slideXml: string, fragment: string): string {
  return slideXml.replace(/<\/p:spTree>/, `${fragment}</p:spTree>`);
}

// -- background --------------------------------------------------------------

function applyBackground(slideXml: string, background: string): string {
  // Strip any existing <p:bg> first.
  let xml = slideXml.replace(/<p:bg>[\s\S]*?<\/p:bg>/, "");
  if (background === "transparent") return xml; // inherit layout chrome
  const bg = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hexBare(background)}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
  // <p:bg> must be the first child of <p:cSld>, before <p:spTree>.
  return xml.replace(/(<p:cSld>)/, `$1${bg}`);
}

// ----------------------------------------------------------------------------
// Package-level helpers
// ----------------------------------------------------------------------------

/** Resolve presentation order to 1-based-indexed source slide part paths. */
function resolveSlideOrder(presXml: string, presRelsXml: string): string[] {
  const rels = parseRels(presRelsXml);
  const byId = new Map(rels.map((r) => [r.id, r]));
  const out: string[] = [];
  for (const m of presXml.matchAll(/<p:sldId\b[^>]*>/g)) {
    const rid = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    if (!rid) continue;
    const rel = byId.get(rid);
    if (!rel) continue;
    out.push(normalisePath(rel.target, "ppt"));
  }
  return out;
}

/** Rewrite <p:sldIdLst> with one <p:sldId> per output slide rId, in order. */
function rewriteSldIdLst(presXml: string, rids: string[]): string {
  let id = 256;
  const entries = rids.map((rid) => `<p:sldId id="${id++}" r:id="${rid}"/>`).join("");
  const lst = `<p:sldIdLst>${entries}</p:sldIdLst>`;
  if (/<p:sldIdLst\s*\/>/.test(presXml)) return presXml.replace(/<p:sldIdLst\s*\/>/, lst);
  if (/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/.test(presXml))
    return presXml.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, lst);
  // No list yet — insert right after <p:presentation ...>.
  return presXml.replace(/(<p:presentation\b[^>]*>)/, `$1${lst}`);
}

async function setDocTitle(zip: JSZip, title: string): Promise<void> {
  const path = "docProps/core.xml";
  const xml = await readText(zip, path);
  if (!xml) return; // no core props part — leave it; not worth synthesising.
  let next: string;
  if (/<dc:title>[\s\S]*?<\/dc:title>/.test(xml)) {
    next = xml.replace(/<dc:title>[\s\S]*?<\/dc:title>/, `<dc:title>${escapeText(title)}</dc:title>`);
  } else {
    next = xml.replace(/(<cp:coreProperties\b[^>]*>)/, `$1<dc:title>${escapeText(title)}</dc:title>`);
  }
  zip.file(path, next);
}

/**
 * Reclaim parts no longer reachable from the package root relationships. After
 * the plan drops source slides, this removes those slide parts and any media /
 * charts / notes that were exclusive to them — no per-rel-type special-casing.
 */
async function garbageCollect(zip: JSZip): Promise<void> {
  const present = new Set<string>();
  zip.forEach((p, e) => {
    if (!e.dir) present.add(p);
  });

  const reachable = new Set<string>();
  const queue: string[] = [];
  const visit = async (relsPath: string, ownerDir: string) => {
    const xml = await readText(zip, relsPath);
    if (!xml) return;
    for (const rel of parseRels(xml)) {
      if (rel.mode === "External" || /^https?:\/\//i.test(rel.target)) continue;
      const full = normalisePath(rel.target, ownerDir);
      if (present.has(full) && !reachable.has(full)) {
        reachable.add(full);
        queue.push(full);
      }
    }
  };

  await visit("_rels/.rels", "");
  while (queue.length) {
    const part = queue.shift()!;
    await visit(relsPathFor(part), dirOf(part));
  }

  for (const p of present) {
    if (p === "[Content_Types].xml") continue;
    if (p === "_rels/.rels") continue; // mandatory package root rels
    if (p.endsWith(".rels")) {
      // Keep a .rels iff the part it describes is reachable.
      const owner = p.replace(/(^|\/)_rels\/([^/]+)\.rels$/, "$1$2");
      if (reachable.has(owner)) continue;
      zip.remove(p);
      continue;
    }
    if (!reachable.has(p)) zip.remove(p);
  }
}

async function pruneDanglingContentTypes(zip: JSZip): Promise<void> {
  const path = "[Content_Types].xml";
  const xml = await readText(zip, path);
  if (!xml) return;
  const present = new Set<string>();
  zip.forEach((p, e) => {
    if (!e.dir) present.add("/" + p);
  });
  let changed = false;
  const next = xml.replace(/<Override\b[^>]*\/>/g, (tag) => {
    const part = /\bPartName="([^"]+)"/.exec(tag)?.[1];
    if (part && !present.has(part)) {
      changed = true;
      return "";
    }
    return tag;
  });
  if (changed) zip.file(path, next);
}

// -- content types -----------------------------------------------------------

async function ensureOverride(zip: JSZip, partName: string, contentType: string | null): Promise<void> {
  if (!contentType) return;
  const path = "[Content_Types].xml";
  const xml = await readText(zip, path);
  if (!xml) return;
  if (new RegExp(`PartName="${escapeRegExp(partName)}"`).test(xml)) return;
  const override = `<Override PartName="${partName}" ContentType="${contentType}"/>`;
  zip.file(path, xml.replace(/<\/Types>/, `${override}</Types>`));
}

async function ensureDefault(zip: JSZip, ext: string, contentType: string): Promise<void> {
  const path = "[Content_Types].xml";
  const xml = await readText(zip, path);
  if (!xml) return;
  if (new RegExp(`Extension="${escapeRegExp(ext)}"`, "i").test(xml)) return;
  const def = `<Default Extension="${ext}" ContentType="${contentType}"/>`;
  zip.file(path, xml.replace(/(<Types\b[^>]*>)/, `$1${def}`));
}

async function overrideTypeFor(zip: JSZip, partName: string): Promise<string | null> {
  const xml = await readText(zip, "[Content_Types].xml");
  if (!xml) return null;
  const m = new RegExp(`<Override\\b[^>]*PartName="${escapeRegExp(partName)}"[^>]*>`).exec(xml);
  return m ? /\bContentType="([^"]+)"/.exec(m[0])?.[1] ?? null : null;
}

// ----------------------------------------------------------------------------
// Element location
// ----------------------------------------------------------------------------

/**
 * Find an element's verbatim XML block inside the slide XML. The block string
 * comes from the parser's location registry (the exact substring it extracted
 * from the source slide), so it is present verbatim in the source — and in any
 * clone, since clones copy the slide XML byte-for-byte.
 */
function locateBlock(
  slideXml: string,
  elementId: string,
  slidePath: string,
  outIndex: number,
  warn: (w: SerializeWarning) => void,
  instantiated: Map<string, string>
): string | null {
  // Instantiated placeholders (layout-from-source slides) aren't in the parse
  // registry — their block lives only in the freshly-built slide XML.
  const fresh = instantiated.get(elementId);
  if (fresh && slideXml.includes(fresh)) return fresh;

  const loc = getElementLocation(elementId);
  if (!loc) {
    warn({
      code: "element-write-failed",
      message: `element ${elementId} not found (was the source parsed in this process?)`,
      elementId,
      slideIndex: outIndex,
    });
    return null;
  }
  if (slideXml.includes(loc.xml)) return loc.xml;
  warn({
    code: "element-write-failed",
    message: `element ${elementId} not present in ${slidePath}`,
    elementId,
    slideIndex: outIndex,
  });
  return null;
}

// ----------------------------------------------------------------------------
// Embedded-workbook generation
// ----------------------------------------------------------------------------

/** Build a minimal valid `.xlsx` mirroring the chart's categories + series so
 *  PowerPoint's Edit-Data shows the real numbers. Layout is canonical:
 *  column A = categories (rows 2..n+1), series i in column B+i (header row 1). */
async function buildChartWorkbook(categories: string[], series: Series[]): Promise<Uint8Array> {
  const n = categories.length;
  const rows: string[] = [];
  // Header row.
  const headerCells = series
    .map((s, i) => inlineStrCell(`${colLetter(i + 1)}1`, s.name || `Series ${i + 1}`))
    .join("");
  rows.push(`<row r="1">${headerCells}</row>`);
  // Data rows.
  for (let r = 0; r < n; r++) {
    const cells: string[] = [inlineStrCell(`A${r + 2}`, String(categories[r]))];
    series.forEach((s, i) => {
      const v = s.values[r];
      if (v != null) cells.push(`<c r="${colLetter(i + 1)}${r + 2}"><v>${v}</v></c>`);
    });
    rows.push(`<row r="${r + 2}">${cells.join("")}</row>`);
  }

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetData>${rows.join("")}</sheetData></worksheet>`;

  const wb = new JSZip();
  wb.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`
  );
  wb.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`
  );
  wb.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`
  );
  wb.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`
  );
  wb.file("xl/worksheets/sheet1.xml", sheet);
  wb.file(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>` +
      `<fills count="1"><fill><patternFill patternType="none"/></fill></fills>` +
      `<borders count="1"><border/></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>` +
      `</styleSheet>`
  );
  return wb.generateAsync({ type: "uint8array" });
}

function inlineStrCell(ref: string, text: string): string {
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeText(text)}</t></is></c>`;
}

// ----------------------------------------------------------------------------
// Media decoding
// ----------------------------------------------------------------------------

interface DecodedMedia {
  fullPath: string;
  relTarget: string;
  data: Uint8Array;
  ext: string;
  contentType: string;
}

function decodeMedia(data: Uint8Array | string, scope: string): DecodedMedia {
  let bytes: Uint8Array;
  let mime = "image/png";
  if (typeof data === "string") {
    const comma = data.indexOf(",");
    const header = data.slice(0, comma);
    mime = /^data:([^;,]+)/.exec(header)?.[1] ?? "image/png";
    bytes = header.includes(";base64")
      ? decodeBase64(data.slice(comma + 1))
      : new TextEncoder().encode(decodeURIComponent(data.slice(comma + 1)));
  } else {
    bytes = data;
    mime = sniffImageMime(data) ?? "image/png";
  }
  const ext = mime.split("/")[1]?.split("+")[0] ?? "png";
  const safe = scope.replace(/[^a-zA-Z0-9]+/g, "_");
  return {
    fullPath: `ppt/media/imageSW_${safe}.${ext}`,
    relTarget: `../media/imageSW_${safe}.${ext}`,
    data: bytes,
    ext,
    contentType: mime,
  };
}

function sniffImageMime(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  return null;
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  if (typeof atob === "function") {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const B = (globalThis as unknown as { Buffer?: { from(b: string, e: string): Uint8Array } }).Buffer;
  if (B) return B.from(clean, "base64");
  throw new Error("[slidewise] no base64 decoder available");
}

// ----------------------------------------------------------------------------
// Relationship + path utilities
// ----------------------------------------------------------------------------

interface Rel {
  id: string;
  type: string;
  target: string;
  mode: string | undefined;
}

const EMPTY_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

function parseRels(xml: string): Rel[] {
  const out: Rel[] = [];
  for (const m of xml.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const tag = m[0];
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const type = /\bType="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    const mode = /\bTargetMode="([^"]+)"/.exec(tag)?.[1];
    if (id && type && target) out.push({ id, type, target, mode });
  }
  return out;
}

function serializeRels(rels: Rel[]): string {
  const body = rels
    .map(
      (r) =>
        `<Relationship Id="${r.id}" Type="${r.type}" Target="${escapeAttr(r.target)}"${r.mode ? ` TargetMode="${r.mode}"` : ""}/>`
    )
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`
  );
}

function highestRidNumber(rels: Rel[]): number {
  let max = 0;
  for (const r of rels) {
    const n = /^rId(\d+)$/.exec(r.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return max;
}

function relTypeSuffix(type: string): string {
  const slash = type.lastIndexOf("/");
  return slash >= 0 ? type.slice(slash + 1) : type;
}

function relsPathFor(partPath: string): string {
  const dir = dirOf(partPath);
  const base = baseOf(partPath);
  return dir ? `${dir}/_rels/${base}.rels` : `_rels/${base}.rels`;
}

function dirOf(p: string): string {
  const slash = p.lastIndexOf("/");
  return slash >= 0 ? p.slice(0, slash) : "";
}

function baseOf(p: string): string {
  const slash = p.lastIndexOf("/");
  return slash >= 0 ? p.slice(slash + 1) : p;
}

/** Resolve a relationship target relative to its owner directory, collapsing
 *  `..` / `.` segments. */
function normalisePath(target: string, baseDir: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segs = (baseDir ? baseDir.split("/") : []).concat(target.split("/"));
  const out: string[] = [];
  for (const s of segs) {
    if (s === "" || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return out.join("/");
}

/** Express `partPath` relative to `fromDir` (a package directory). */
function relativeTo(partPath: string, fromDir: string): string {
  const from = fromDir ? fromDir.split("/") : [];
  const to = partPath.split("/");
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const up = from.slice(i).map(() => "..");
  return [...up, ...to.slice(i)].join("/");
}

/** Allocate an unused part path `dir/<stem>N.ext`. */
function freshPartPath(zip: JSZip, dir: string, stem: string, ext: string): string {
  let n = 1;
  for (;;) {
    const p = `${dir}/${stem}${n}.${ext}`;
    if (!zip.file(p)) return p;
    n++;
  }
}

/** Pick an unused chart-part path near a synthesiser's suggestion. */
function freshSynthPath(zip: JSZip, suggested: string): string {
  if (!zip.file(suggested)) return suggested;
  const dot = suggested.lastIndexOf(".");
  const stem = suggested.slice(0, dot);
  const ext = suggested.slice(dot + 1);
  let n = 2;
  for (;;) {
    const p = `${stem}_${n}.${ext}`;
    if (!zip.file(p)) return p;
    n++;
  }
}

async function readText(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  return file ? file.async("string") : null;
}

function colLetter(n: number): string {
  // 1 -> A, 26 -> Z, 27 -> AA …
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Return the first complete `<tag …/>` or `<tag …>…</tag>` element in `xml`.
 * Unlike a `[\s\S]*?(?:/>|</tag>)` shortcut, this never stops early on a
 * self-closing CHILD (e.g. `<a:srgbClr .../>` inside an `<a:rPr>`). The tags it
 * is used on (`a:rPr`, `a:pPr`, `a:bodyPr`, `a:lstStyle`) don't self-nest.
 */
function firstElement(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*\\/>|<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`);
  return re.exec(xml)?.[0];
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

// OOXML namespaces (for synthesised slide parts).
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// Rel-type + content-type constants.
const IMAGE_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const CHART_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
const PACKAGE_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package";
const SLIDE_LAYOUT_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
const CHART_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SLIDE_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";

/** A CRC-correct 1×1 fully-transparent PNG, used as the placeholder blip for an
 *  instantiated picture slot until the host fills it via `setImage`. */
const TRANSPARENT_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06,
  0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44,
  0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);
