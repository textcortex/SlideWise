import JSZip from "jszip";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import { nanoid } from "nanoid";
import type {
  Deck,
  Slide,
  SlideElement,
  TextElement,
  TextRun,
  ShapeElement,
  ShapeKind,
  ImageElement,
  LineElement,
  TableElement,
  UnknownElement,
} from "@/lib/types";
import { SLIDE_W, SLIDE_H } from "@/lib/types";
import { emuToPx, pointsToPx } from "./units";
import type { ParseDiagnostics } from "./types";

/**
 * Linear transform from raw source-PPTX pixels (EMU/EMU_PER_PX) into
 * Caracas's fixed 1920×1080 canvas. We pick a uniform scale that fits the
 * source slide entirely, then center it — preserves aspect, letterboxes when
 * source is 4:3 and target is 16:9.
 */
interface Fit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface ParseContext {
  diagnostics: ParseDiagnostics;
  zip: JSZip;
  slidePath: string;
  /** rId → media path (e.g. "ppt/media/image1.png") */
  rels: Map<string, string>;
  fit: Fit;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  preserveOrder: false,
  isArray: (name) => ARRAY_TAGS.has(name),
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  format: false,
  suppressEmptyNode: true,
});

// Tags that should always be arrays even when only one occurs.
const ARRAY_TAGS = new Set([
  "p:sp",
  "p:pic",
  "p:cxnSp",
  "p:graphicFrame",
  "p:grpSp",
  "a:p",
  "a:r",
  "a:tr",
  "a:tc",
  "Relationship",
]);

/**
 * Parse a PPTX blob into a Caracas Deck. Coverage:
 *  - Slide background colour
 *  - Text boxes (basic run formatting: font, size, colour, bold, italic, alignment)
 *  - Preset shapes (rect, roundRect, ellipse, triangle, diamond, star5)
 *  - Images (embedded media → data URLs)
 *  - Connector lines (cxnSp)
 *  - Anything else (charts, SmartArt, embedded video, group shapes, tables — TODO)
 *    is preserved as an UnknownElement carrying its raw OOXML so a save round-trip
 *    can later re-emit it without data loss.
 */
export async function parsePptx(blob: Blob | ArrayBuffer): Promise<Deck> {
  const zip = await JSZip.loadAsync(blob);
  const diagnostics: ParseDiagnostics = {
    unknownElementCount: 0,
    droppedAnimations: 0,
    warnings: [],
  };

  const presentationXml = await readXml(zip, "ppt/presentation.xml");
  const presentationRels = await readRels(zip, "ppt/_rels/presentation.xml.rels");

  const fit = computeFit(presentationXml);

  const slideIdList = asArray<{ "@_r:id": string }>(
    presentationXml?.["p:presentation"]?.["p:sldIdLst"]?.["p:sldId"]
  );
  const slidePaths = slideIdList
    .map((entry) => presentationRels.get(entry["@_r:id"]))
    .filter((p): p is string => Boolean(p))
    .map((p) => normalisePath(p, "ppt"));

  const title = await readTitle(zip);

  const slides: Slide[] = [];
  for (const slidePath of slidePaths) {
    const slide = await parseSlide(zip, slidePath, diagnostics, fit);
    if (slide) slides.push(slide);
  }

  if (!slides.length) {
    slides.push({ id: nanoid(8), background: "#FFFFFF", elements: [] });
    diagnostics.warnings.push("PPTX contained no slides; created an empty one.");
  }

  const deck: Deck = { title, slides };
  if (diagnostics.warnings.length) {
    console.info("[caracas/pptx] parse diagnostics:", diagnostics);
  }
  return deck;
}

async function parseSlide(
  zip: JSZip,
  slidePath: string,
  diagnostics: ParseDiagnostics,
  fit: Fit
): Promise<Slide | null> {
  const xml = await readXml(zip, slidePath);
  if (!xml) return null;
  const relsPath = slidePath.replace(
    /([^/]+)\.xml$/,
    "_rels/$1.xml.rels"
  );
  const rels = await readRels(zip, relsPath);

  const ctx: ParseContext = { diagnostics, zip, slidePath, rels, fit };

  const sld = xml["p:sld"];
  const cSld = sld?.["p:cSld"];
  const background = extractBackgroundColor(cSld?.["p:bg"]) ?? "#FFFFFF";

  const spTree = cSld?.["p:spTree"];
  const elements: SlideElement[] = [];

  if (spTree) {
    let z = 1;
    const append = (el: SlideElement | null) => {
      if (!el) return;
      elements.push({ ...el, z: z++ });
    };

    for (const sp of asArray(spTree["p:sp"])) {
      append(await parseSpOrText(sp, ctx));
    }
    for (const pic of asArray(spTree["p:pic"])) {
      append(await parsePic(pic, ctx));
    }
    for (const cxn of asArray(spTree["p:cxnSp"])) {
      append(parseCxn(cxn, ctx.fit));
    }
    for (const gf of asArray(spTree["p:graphicFrame"])) {
      append(parseGraphicFrame(gf, ctx));
    }
    for (const grp of asArray(spTree["p:grpSp"])) {
      append(toUnknown(grp, "p:grpSp", ctx));
    }
  }

  return {
    id: nanoid(8),
    background,
    elements,
  };
}

// ---------------------------------------------------------------------------
// shape / text
// ---------------------------------------------------------------------------

async function parseSpOrText(
  sp: any,
  ctx: ParseContext
): Promise<SlideElement | null> {
  const xfrm = sp?.["p:spPr"]?.["a:xfrm"];
  const geom = readGeometry(xfrm, ctx.fit);
  if (!geom) {
    return toUnknown(sp, "p:sp", ctx);
  }
  const txBody = sp["p:txBody"];
  const prstGeom = sp?.["p:spPr"]?.["a:prstGeom"];
  const presetName = prstGeom?.["@_prst"];

  // Lines are routinely authored as <p:sp prst="line"> rather than the
  // <p:cxnSp> connector form. Detect them up front so they don't leak into
  // shape parsing (which would map them to UnknownElement).
  if (presetName === "line" || presetName === "straightConnector1") {
    const flipV = xfrm?.["@_flipV"] === "1";
    return makeLineFromGeometry(
      geom,
      sp?.["p:spPr"]?.["a:ln"],
      ctx.fit.scale,
      flipV
    );
  }

  const isText = !!txBody && (!presetName || presetName === "rect");

  if (isText) {
    const text = extractRuns(txBody);
    if (!text.runs.length && !text.plain) {
      // Empty text box — still record it so position survives round-trip.
    }
    const first = text.runs[0];
    const align = text.align ?? "left";
    const valign = readBodyVAlign(txBody?.["a:bodyPr"]) ?? "top";
    // Source font sizes are in absolute points; when we letterbox a larger
    // source slide into Caracas's 1920×1080 frame, the typography must scale
    // with the geometry so it doesn't overflow its own text box.
    const scale = ctx.fit.scale;
    const fontSize = first?.fontSize
      ? Math.max(6, Math.round(first.fontSize * scale))
      : 24;
    const fontFamily = first?.fontFamily ?? "Inter";
    const fontWeight = first?.bold ? 700 : 400;
    const color = first?.color ?? "#0E1330";

    // Promote multi-run text to runs[] when more than one run exists OR when
    // the single run carries explicit overrides we'd otherwise drop.
    const runs: TextRun[] = text.runs.map((r) => ({
      text: r.text,
      fontFamily: r.fontFamily,
      fontSize: r.fontSize ? Math.max(6, Math.round(r.fontSize * scale)) : undefined,
      fontWeight: r.bold ? 700 : r.bold === false ? 400 : undefined,
      italic: r.italic,
      underline: r.underline,
      strike: r.strike,
      color: r.color,
      letterSpacing: r.letterSpacing
        ? Math.round(r.letterSpacing * scale)
        : undefined,
    }));
    const hasMixedFormatting = runs.length > 1 && runs.some((r, i) => {
      if (i === 0) return false;
      const a = runs[0];
      return (
        a.color !== r.color ||
        a.fontFamily !== r.fontFamily ||
        a.fontSize !== r.fontSize ||
        a.fontWeight !== r.fontWeight ||
        a.italic !== r.italic ||
        a.underline !== r.underline ||
        a.strike !== r.strike
      );
    });

    const el: TextElement = {
      id: nanoid(8),
      type: "text",
      ...geom,
      z: 0,
      text: text.plain,
      fontFamily,
      fontSize,
      fontWeight,
      italic: !!first?.italic,
      underline: !!first?.underline,
      strike: !!first?.strike,
      color,
      align,
      vAlign: valign,
      lineHeight: text.lineHeightPct ?? 1.2,
      letterSpacing: first?.letterSpacing
        ? Math.round(first.letterSpacing * scale)
        : 0,
      ...(hasMixedFormatting ? { runs } : {}),
    };
    return el;
  }

  const fillColor = extractFillColor(sp?.["p:spPr"]?.["a:solidFill"]) ?? "#4F5BD5";
  const lineProps = sp?.["p:spPr"]?.["a:ln"];
  const stroke = extractFillColor(lineProps?.["a:solidFill"]);
  const strokeWidthEmu = lineProps?.["@_w"]
    ? Number(lineProps["@_w"])
    : undefined;

  const kind = mapPrstToKind(presetName);
  if (!kind) {
    return toUnknown(sp, "p:sp", ctx);
  }

  const radius =
    presetName === "roundRect"
      ? Math.round(Math.min(geom.w, geom.h) * 0.18)
      : undefined;

  const shape: ShapeElement = {
    id: nanoid(8),
    type: "shape",
    ...geom,
    z: 0,
    shape: kind,
    fill: fillColor,
    stroke,
    strokeWidth: strokeWidthEmu
      ? Math.max(1, Math.round(emuToPx(strokeWidthEmu) * ctx.fit.scale))
      : undefined,
    radius,
  };
  return shape;
}

async function parsePic(pic: any, ctx: ParseContext): Promise<SlideElement | null> {
  const xfrm = pic?.["p:spPr"]?.["a:xfrm"];
  const geom = readGeometry(xfrm, ctx.fit);
  if (!geom) return toUnknown(pic, "p:pic", ctx);

  const blipRef = pic?.["p:blipFill"]?.["a:blip"]?.["@_r:embed"];
  if (!blipRef) return toUnknown(pic, "p:pic", ctx);

  const mediaPath = ctx.rels.get(blipRef);
  if (!mediaPath) return toUnknown(pic, "p:pic", ctx);

  const fullPath = normalisePath(mediaPath, dirOf(ctx.slidePath));
  const file = ctx.zip.file(fullPath);
  if (!file) return toUnknown(pic, "p:pic", ctx);

  const base64 = await file.async("base64");
  const ext = (fullPath.split(".").pop() || "png").toLowerCase();
  const mime = mimeForExt(ext);

  const fitMode = pic?.["p:blipFill"]?.["a:stretch"] ? "cover" : "contain";

  const image: ImageElement = {
    id: nanoid(8),
    type: "image",
    ...geom,
    z: 0,
    src: `data:${mime};base64,${base64}`,
    fit: fitMode,
  };
  return image;
}

function parseCxn(cxn: any, fit: Fit): SlideElement | null {
  const xfrm = cxn?.["p:spPr"]?.["a:xfrm"];
  const geom = readGeometry(xfrm, fit);
  if (!geom) return null;
  const flipV = xfrm?.["@_flipV"] === "1";
  return makeLineFromGeometry(geom, cxn?.["p:spPr"]?.["a:ln"], fit.scale, flipV);
}

function makeLineFromGeometry(
  geom: { x: number; y: number; w: number; h: number; rotation: number },
  lineProps: any,
  scale: number,
  flipV: boolean
): LineElement {
  const stroke = extractFillColor(lineProps?.["a:solidFill"]) ?? "#0E1330";
  const strokeWidth = lineProps?.["@_w"]
    ? Math.max(1, Math.round(emuToPx(Number(lineProps["@_w"])) * scale))
    : 4;
  const dashed = !!lineProps?.["a:prstDash"];
  const arrow =
    !!lineProps?.["a:headEnd"] || !!lineProps?.["a:tailEnd"];
  // Caracas LineElement renders a line from (x, y) to (x+w, y+h). PPTX
  // straight lines use cy=0 for horizontal and cx=0 for vertical; ensure a
  // minimum extent so the line is visible, and handle flipV by inverting h.
  const w = geom.w === 0 ? 1 : geom.w;
  const h = flipV ? -geom.h : geom.h;
  const line: LineElement = {
    id: nanoid(8),
    type: "line",
    x: geom.x,
    y: geom.y,
    w,
    h,
    rotation: geom.rotation,
    z: 0,
    stroke,
    strokeWidth,
    dashed,
    arrow,
  };
  return line;
}

function parseGraphicFrame(gf: any, ctx: ParseContext): SlideElement | null {
  const tbl = gf?.["a:graphic"]?.["a:graphicData"]?.["a:tbl"];
  if (tbl) {
    const parsed = parseTable(gf, tbl, ctx);
    if (parsed) return parsed;
  }
  return toUnknown(gf, "p:graphicFrame", ctx);
}

function parseTable(gf: any, tbl: any, ctx: ParseContext): TableElement | null {
  // graphicFrame uses p:xfrm directly (not nested under p:spPr).
  const xfrm = gf?.["p:xfrm"] || gf?.["p:spPr"]?.["a:xfrm"];
  const geom = readGeometry(xfrm, ctx.fit);
  if (!geom) return null;

  const trs = asArray(tbl["a:tr"]);
  if (!trs.length) return null;

  const rows: string[][] = [];
  let firstFontSizePx: number | undefined;
  let firstColor: string | undefined;
  let headerFill = "#0E1330";
  let bodyFill = "#FFFFFF";

  for (let ri = 0; ri < trs.length; ri++) {
    const tr = trs[ri];
    const tcs = asArray(tr["a:tc"]);
    const cells: string[] = [];
    for (const tc of tcs) {
      // Skip merged-cell continuation markers.
      if (tc?.["@_hMerge"] === "1" || tc?.["@_vMerge"] === "1") {
        cells.push("");
        continue;
      }
      const txBody = tc["a:txBody"];
      const text = txBody ? extractRuns(txBody) : { plain: "", runs: [] };
      cells.push(text.plain);

      const r0 = text.runs[0];
      if (firstFontSizePx === undefined && r0?.fontSize) {
        firstFontSizePx = Math.max(
          8,
          Math.round(r0.fontSize * ctx.fit.scale)
        );
      }
      if (!firstColor && r0?.color) firstColor = r0.color;

      const cellFill = extractFillColor(
        tc?.["a:tcPr"]?.["a:solidFill"]
      );
      if (cellFill) {
        if (ri === 0) headerFill = cellFill;
        else bodyFill = cellFill;
      }
    }
    rows.push(cells);
  }

  const table: TableElement = {
    id: nanoid(8),
    type: "table",
    ...geom,
    z: 0,
    rows,
    headerFill,
    rowFill: bodyFill,
    textColor: firstColor ?? "#0E1330",
    fontSize: firstFontSizePx ?? 18,
  };
  return table;
}

function toUnknown(node: any, tag: string, ctx: ParseContext): UnknownElement {
  ctx.diagnostics.unknownElementCount++;
  const xfrm =
    node?.["p:spPr"]?.["a:xfrm"] ||
    node?.["p:grpSpPr"]?.["a:xfrm"] ||
    node?.["a:xfrm"];
  const geom = readGeometry(xfrm, ctx.fit) ?? {
    x: 0,
    y: 0,
    w: 200,
    h: 100,
    rotation: 0,
  };
  return {
    id: nanoid(8),
    type: "unknown",
    ...geom,
    z: 0,
    ooxmlTag: tag,
    ooxmlXml: xmlBuilder.build({ [tag]: node }),
    label: friendlyLabelForTag(tag),
  };
}

function friendlyLabelForTag(tag: string): string {
  switch (tag) {
    case "p:graphicFrame":
      return "Chart / table / SmartArt";
    case "p:grpSp":
      return "Grouped shapes";
    case "p:sp":
      return "Imported shape";
    case "p:pic":
      return "Image";
    default:
      return "Imported content";
  }
}

// ---------------------------------------------------------------------------
// extractors
// ---------------------------------------------------------------------------

function readGeometry(
  xfrm: any,
  fit: Fit
): {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
} | null {
  if (!xfrm) return null;
  const off = xfrm["a:off"];
  const ext = xfrm["a:ext"];
  if (!off || !ext) return null;
  const rawX = emuToPx(Number(off["@_x"] ?? 0));
  const rawY = emuToPx(Number(off["@_y"] ?? 0));
  const rawW = emuToPx(Number(ext["@_cx"] ?? 0));
  const rawH = emuToPx(Number(ext["@_cy"] ?? 0));
  const rot = xfrm["@_rot"] ? Number(xfrm["@_rot"]) / 60000 : 0;
  return {
    x: Math.round(rawX * fit.scale + fit.offsetX),
    y: Math.round(rawY * fit.scale + fit.offsetY),
    w: Math.max(1, Math.round(rawW * fit.scale)),
    h: Math.max(1, Math.round(rawH * fit.scale)),
    rotation: Math.round(rot),
  };
}

function computeFit(presentationXml: any): Fit {
  const sldSz = presentationXml?.["p:presentation"]?.["p:sldSz"];
  const cxEmu = Number(sldSz?.["@_cx"]) || 12192000;
  const cyEmu = Number(sldSz?.["@_cy"]) || 6858000;
  const sourceW = emuToPx(cxEmu);
  const sourceH = emuToPx(cyEmu);
  // Pick uniform scale to fit the source slide entirely inside Caracas's
  // fixed canvas, then center (letterbox).
  const scale = Math.min(SLIDE_W / sourceW, SLIDE_H / sourceH);
  const offsetX = Math.round((SLIDE_W - sourceW * scale) / 2);
  const offsetY = Math.round((SLIDE_H - sourceH * scale) / 2);
  return { scale, offsetX, offsetY };
}

function extractFillColor(solidFill: any): string | undefined {
  if (!solidFill) return undefined;
  const srgb = solidFill["a:srgbClr"]?.["@_val"];
  if (srgb) return `#${srgb.toUpperCase()}`;
  const sys = solidFill["a:sysClr"]?.["@_lastClr"];
  if (sys) return `#${sys.toUpperCase()}`;
  return undefined;
}

function extractBackgroundColor(bg: any): string | undefined {
  return extractFillColor(bg?.["p:bgPr"]?.["a:solidFill"]);
}

function readBodyVAlign(bodyPr: any): "top" | "middle" | "bottom" | undefined {
  const anchor = bodyPr?.["@_anchor"];
  if (anchor === "ctr") return "middle";
  if (anchor === "b") return "bottom";
  if (anchor === "t") return "top";
  return undefined;
}

interface RunInfo {
  text: string;
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  letterSpacing?: number;
}

function extractRuns(txBody: any): {
  runs: RunInfo[];
  plain: string;
  align?: "left" | "center" | "right";
  lineHeightPct?: number;
} {
  const runs: RunInfo[] = [];
  let align: "left" | "center" | "right" | undefined;
  let lineHeightPct: number | undefined;
  const paragraphs = asArray(txBody?.["a:p"]);
  const pieces: string[] = [];

  for (let pi = 0; pi < paragraphs.length; pi++) {
    const p = paragraphs[pi];
    const pPr = p?.["a:pPr"];
    const pPrAlgn = pPr?.["@_algn"];
    if (!align && pPrAlgn) {
      if (pPrAlgn === "ctr") align = "center";
      else if (pPrAlgn === "r") align = "right";
      else align = "left";
    }
    if (lineHeightPct === undefined) {
      const lnPct = pPr?.["a:lnSpc"]?.["a:spcPct"]?.["@_val"];
      if (lnPct) lineHeightPct = Number(lnPct) / 100000;
    }
    const rs = asArray(p?.["a:r"]);
    const paragraphText: string[] = [];
    for (const r of rs) {
      const t = r?.["a:t"];
      const rPr = r?.["a:rPr"] ?? {};
      const text =
        typeof t === "string" ? t : t?.["#text"] ?? "";
      paragraphText.push(text);
      // a:rPr/@spc is "hundredths of a point"; PowerPoint also lets it be
      // negative. Convert to pixels in source space (caller scales by fit).
      const spcRaw = rPr?.["@_spc"];
      const letterSpacing =
        spcRaw !== undefined && spcRaw !== ""
          ? pointsToPx(Number(spcRaw) / 100)
          : undefined;
      runs.push({
        text,
        fontFamily: rPr?.["a:latin"]?.["@_typeface"],
        fontSize: rPr?.["@_sz"]
          ? pointsToPx(Number(rPr["@_sz"]) / 100)
          : undefined,
        bold: rPr?.["@_b"] === "1" || rPr?.["@_b"] === 1,
        italic: rPr?.["@_i"] === "1" || rPr?.["@_i"] === 1,
        underline:
          rPr?.["@_u"] && rPr["@_u"] !== "none",
        strike: rPr?.["@_strike"] === "sngStrike",
        color: extractFillColor(rPr?.["a:solidFill"]),
        letterSpacing,
      });
    }
    pieces.push(paragraphText.join(""));
  }
  return {
    runs,
    plain: pieces.join("\n"),
    align,
    lineHeightPct,
  };
}

function mapPrstToKind(prst?: string): ShapeKind | null {
  if (!prst) return null;
  switch (prst) {
    case "rect":
      return "rect";
    case "roundRect":
      return "rounded";
    case "ellipse":
      return "circle";
    case "triangle":
      return "triangle";
    case "diamond":
      return "diamond";
    case "star5":
      return "star";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// zip + xml helpers
// ---------------------------------------------------------------------------

async function readXml(zip: JSZip, path: string): Promise<any | null> {
  const file = zip.file(path);
  if (!file) return null;
  const text = await file.async("string");
  return xmlParser.parse(text);
}

async function readRels(zip: JSZip, path: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const xml = await readXml(zip, path);
  if (!xml) return map;
  const rels = asArray(xml?.["Relationships"]?.["Relationship"]);
  for (const r of rels) {
    const id = r?.["@_Id"];
    const target = r?.["@_Target"];
    if (id && target) map.set(id, target);
  }
  return map;
}

async function readTitle(zip: JSZip): Promise<string> {
  const file = zip.file("docProps/core.xml");
  if (!file) return "Untitled";
  const text = await file.async("string");
  const m = text.match(/<dc:title[^>]*>([^<]*)<\/dc:title>/);
  return (m?.[1] || "Untitled").trim() || "Untitled";
}

function asArray<T = any>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

function normalisePath(target: string, base: string): string {
  if (target.startsWith("/")) return target.slice(1);
  if (target.startsWith("../")) {
    const segments = base.split("/").filter(Boolean);
    let t = target;
    while (t.startsWith("../")) {
      segments.pop();
      t = t.slice(3);
    }
    return [...segments, t].filter(Boolean).join("/");
  }
  return base ? `${base}/${target}` : target;
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
