/**
 * CTF → TrueType glyf reconstruction (MTX milestone 3).
 *
 * For TrueType-outline fonts, MTX stores the `glyf` table in "Compact Table
 * Format" (CTF) — per-glyph records using the same triplet point encoding
 * that WOFF2 later standardised — and eliminates `loca`. This rebuilds a
 * standard `glyf` + `loca` from the decompressed CTF and reassembles the sfnt.
 *
 * Hinting instructions (the per-glyph push/program streams in MTX blocks 2/3)
 * are intentionally DROPPED: instructionLength is set to 0. Browsers render
 * with their own rasteriser and ignore TrueType hints, so unhinted outlines
 * render identically on screen — and dropping them avoids reconstructing the
 * separated push/instruction interleave.
 *
 * Per-glyph CTF record layout (W3C MTX §5.7–5.11):
 *   SHORT  numContours
 *   if numContours == -1            → composite (bbox + component records)
 *   else:
 *     if numContours == 0x7FFF      → SHORT realNumContours; SHORT bbox[4]
 *     255USHORT contourPoints[numContours]   (endpt of c0, then pts per contour)
 *     BYTE      flags[numPoints]              (bit7 = off-curve; bits0..6 = triplet idx)
 *     triplets  (xCoordinate,yCoordinate)[numPoints]   (relative; WOFF2 encoding)
 *     255USHORT pushCount, codeSize           (instruction stream sizes — skipped)
 */

import { EotDecodeError } from "./eot";

class Reader {
  private dv: DataView;
  private bytes: Uint8Array;
  pos = 0;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8(): number {
    return this.bytes[this.pos++];
  }
  i16(): number {
    const v = this.dv.getInt16(this.pos);
    this.pos += 2;
    return v;
  }
  u16(): number {
    const v = this.dv.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  /** 255UShort (W3C MTX §6.1.1 / WOFF2 255UInt16). */
  u255(): number {
    const code = this.u8();
    if (code === 253) {
      return (this.u8() << 8) | this.u8();
    } else if (code === 255) {
      return this.u8() + 253;
    } else if (code === 254) {
      return this.u8() + 506;
    }
    return code;
  }
  get eof(): boolean {
    return this.pos >= this.bytes.length;
  }
}

function withSign(flag: number, base: number): number {
  // WOFF2/MTX triplet sign rule: odd flag bit → positive, even → negative.
  return flag & 1 ? base : -base;
}

/** Decode one point's (dx, dy) from the triplet stream — WOFF2 algorithm. */
function decodeTriplet(flag: number, r: Reader): { dx: number; dy: number } {
  const f = flag & 0x7f;
  if (f < 10) {
    return { dx: 0, dy: withSign(f, ((f & 14) << 7) + r.u8()) };
  } else if (f < 20) {
    return { dx: withSign(f, (((f - 10) & 14) << 7) + r.u8()), dy: 0 };
  } else if (f < 84) {
    const b0 = f - 20;
    const b1 = r.u8();
    return {
      dx: withSign(f, 1 + (b0 & 0x30) + (b1 >> 4)),
      dy: withSign(f >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f)),
    };
  } else if (f < 120) {
    const b0 = f - 84;
    return {
      dx: withSign(f, 1 + (((b0 / 12) | 0) << 8) + r.u8()),
      dy: withSign(f >> 1, 1 + ((((b0 % 12) >> 2) << 8) | 0) + r.u8()),
    };
  } else if (f < 124) {
    const b1 = r.u8();
    const b2 = r.u8();
    const b3 = r.u8();
    return {
      dx: withSign(f, (b1 << 4) + (b2 >> 4)),
      dy: withSign(f >> 1, ((b2 & 0x0f) << 8) + b3),
    };
  } else {
    const b1 = r.u8();
    const b2 = r.u8();
    const b3 = r.u8();
    const b4 = r.u8();
    return {
      dx: withSign(f, (b1 << 8) + b2),
      dy: withSign(f >> 1, (b3 << 8) + b4),
    };
  }
}

interface TableRec {
  tag: string;
  offset: number;
  length: number;
  checksum: number;
}

function readTableDir(sfnt: Uint8Array): { sfntVersion: number; tables: TableRec[] } {
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const sfntVersion = dv.getUint32(0);
  const numTables = dv.getUint16(4);
  const tables: TableRec[] = [];
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables.push({
      tag: String.fromCharCode(sfnt[o], sfnt[o + 1], sfnt[o + 2], sfnt[o + 3]),
      checksum: dv.getUint32(o + 4),
      offset: dv.getUint32(o + 8),
      length: dv.getUint32(o + 12),
    });
  }
  return { sfntVersion, tables };
}

/**
 * Reconstruct a TrueType `glyf` + `loca` from a CTF-format decompressed sfnt
 * and return a freshly-assembled, browser-valid sfnt. Throws EotDecodeError
 * (kind mtx-not-implemented / mtx-failed) when the CTF can't be parsed.
 */
export function reconstructTrueType(ctf: Uint8Array): Uint8Array {
  const { tables } = readTableDir(ctf);
  const byTag = new Map(tables.map((t) => [t.tag, t]));
  const maxp = byTag.get("maxp");
  const glyfRec = byTag.get("glyf");
  const headRec = byTag.get("head");
  if (!maxp || !glyfRec || !headRec) {
    throw new EotDecodeError("CTF missing maxp/glyf/head", "mtx-failed");
  }
  const dv = new DataView(ctf.buffer, ctf.byteOffset, ctf.byteLength);
  const numGlyphs = dv.getUint16(maxp.offset + 4);

  const r = new Reader(ctf.subarray(glyfRec.offset, glyfRec.offset + glyfRec.length));
  const glyphs: Uint8Array[] = [];
  for (let g = 0; g < numGlyphs; g++) {
    if (r.eof) {
      glyphs.push(new Uint8Array(0));
      continue;
    }
    glyphs.push(reconstructGlyph(r, ctf, glyfRec));
  }

  return assembleSfnt(ctf, tables, glyphs, headRec);
}

function reconstructGlyph(r: Reader, ctf: Uint8Array, glyfRec: TableRec): Uint8Array {
  const numContours = r.i16();
  if (numContours === 0) return new Uint8Array(0);

  if (numContours === -1) {
    return reconstructComposite(r, ctf, glyfRec);
  }

  let nc = numContours;
  let bbox: [number, number, number, number] | null = null;
  if (numContours === 0x7fff) {
    nc = r.i16();
    bbox = [r.i16(), r.i16(), r.i16(), r.i16()];
  }

  // contourPoints → endPtsOfContours + total point count.
  const endPts = new Array<number>(nc);
  let running = 0;
  for (let i = 0; i < nc; i++) {
    const cp = r.u255();
    running = i === 0 ? cp : running + cp;
    endPts[i] = running;
  }
  const numPoints = nc > 0 ? endPts[nc - 1] + 1 : 0;

  const flags = new Array<number>(numPoints);
  for (let i = 0; i < numPoints; i++) flags[i] = r.u8();

  const dxs = new Array<number>(numPoints);
  const dys = new Array<number>(numPoints);
  for (let i = 0; i < numPoints; i++) {
    const { dx, dy } = decodeTriplet(flags[i], r);
    dxs[i] = dx;
    dys[i] = dy;
  }

  // pushCount + codeSize (instruction stream sizes) — read + discard.
  r.u255();
  r.u255();

  // Compute bbox from absolute coords if not explicitly stored.
  if (!bbox) {
    let x = 0, y = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    if (numPoints === 0) {
      bbox = [0, 0, 0, 0];
    } else {
      for (let i = 0; i < numPoints; i++) {
        x += dxs[i];
        y += dys[i];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      bbox = [minX, minY, maxX, maxY];
    }
  }

  return emitSimpleGlyph(nc, bbox, endPts, flags, dxs, dys);
}

function emitSimpleGlyph(
  nc: number,
  bbox: [number, number, number, number],
  endPts: number[],
  flags: number[],
  dxs: number[],
  dys: number[]
): Uint8Array {
  const numPoints = flags.length;
  // header(10) + endPts(2*nc) + instrLen(2) + flags(1*numPoints) + x(2*numPoints) + y(2*numPoints)
  const size = 10 + 2 * nc + 2 + numPoints + 2 * numPoints + 2 * numPoints;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let o = 0;
  dv.setInt16(o, nc); o += 2;
  dv.setInt16(o, bbox[0]); o += 2;
  dv.setInt16(o, bbox[1]); o += 2;
  dv.setInt16(o, bbox[2]); o += 2;
  dv.setInt16(o, bbox[3]); o += 2;
  for (let i = 0; i < nc; i++) { dv.setUint16(o, endPts[i]); o += 2; }
  dv.setUint16(o, 0); o += 2; // instructionLength = 0 (hints dropped)
  // flags: bit0 = ON_CURVE. (No short-vector / repeat compression — x/y are
  // emitted as signed 16-bit deltas, the long form.)
  for (let i = 0; i < numPoints; i++) {
    out[o++] = (flags[i] & 0x80) === 0 ? 0x01 : 0x00;
  }
  for (let i = 0; i < numPoints; i++) { dv.setInt16(o, dxs[i]); o += 2; }
  for (let i = 0; i < numPoints; i++) { dv.setInt16(o, dys[i]); o += 2; }
  return out;
}

// Composite glyph component flag bits (OpenType glyf spec).
const ARG_1_AND_2_ARE_WORDS = 0x0001;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;
const WE_HAVE_INSTRUCTIONS = 0x0100;

function reconstructComposite(r: Reader, ctf: Uint8Array, glyfRec: TableRec): Uint8Array {
  // CTF composite: bbox[4] then component records (copied verbatim from the
  // glyf spec), looping while MORE_COMPONENTS. We re-emit -1 + bbox +
  // components, clearing WE_HAVE_INSTRUCTIONS (hints dropped).
  const bbox: [number, number, number, number] = [r.i16(), r.i16(), r.i16(), r.i16()];
  const start = r.pos;
  let weHaveInstr = false;
  // walk components to find their byte span
  let more = true;
  while (more) {
    const flags = r.u16();
    r.u16(); // glyphIndex
    if (flags & ARG_1_AND_2_ARE_WORDS) { r.u16(); r.u16(); } else { r.u8(); r.u8(); }
    if (flags & WE_HAVE_A_SCALE) r.u16();
    else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) { r.u16(); r.u16(); }
    else if (flags & WE_HAVE_A_TWO_BY_TWO) { r.u16(); r.u16(); r.u16(); r.u16(); }
    if (flags & WE_HAVE_INSTRUCTIONS) weHaveInstr = true;
    more = (flags & MORE_COMPONENTS) !== 0;
  }
  const componentBytes = ctf.subarray(
    glyfRec.offset + start,
    glyfRec.offset + r.pos
  );
  if (weHaveInstr) {
    // skip the CTF pushCount/codeSize for the dropped instructions
    r.u255();
    r.u255();
  }

  const out = new Uint8Array(10 + componentBytes.length);
  const dv = new DataView(out.buffer);
  dv.setInt16(0, -1);
  dv.setInt16(2, bbox[0]);
  dv.setInt16(4, bbox[1]);
  dv.setInt16(6, bbox[2]);
  dv.setInt16(8, bbox[3]);
  out.set(componentBytes, 10);
  // Clear WE_HAVE_INSTRUCTIONS on the first component's flags (we dropped them).
  if (componentBytes.length >= 2) {
    const f = (out[10] << 8) | out[11];
    const cleared = f & ~WE_HAVE_INSTRUCTIONS;
    out[10] = (cleared >> 8) & 0xff;
    out[11] = cleared & 0xff;
  }
  return out;
}

const PAD = (n: number): number => (n + 3) & ~3;

/**
 * Reassemble the sfnt: copy all source tables except glyf/loca, then append
 * the rebuilt glyf + loca. Recomputes the table directory, table checksums,
 * and head.checkSumAdjustment so strict browser sanitizers (OTS) accept it.
 */
function assembleSfnt(
  ctf: Uint8Array,
  srcTables: TableRec[],
  glyphs: Uint8Array[],
  headRec: TableRec
): Uint8Array {
  // Build new glyf (4-byte aligned per glyph) + matching loca.
  const glyphOffsets: number[] = [];
  let glyfLen = 0;
  for (const g of glyphs) {
    glyphOffsets.push(glyfLen);
    glyfLen += PAD(g.length);
  }
  glyphOffsets.push(glyfLen);
  const glyf = new Uint8Array(glyfLen);
  for (let i = 0; i < glyphs.length; i++) glyf.set(glyphs[i], glyphOffsets[i]);

  // loca: long format (head.indexToLocFormat will be set to 1).
  const loca = new Uint8Array((glyphs.length + 1) * 4);
  {
    const dv = new DataView(loca.buffer);
    for (let i = 0; i <= glyphs.length; i++) dv.setUint32(i * 4, glyphOffsets[i]);
  }

  // Assemble the final table set (drop any existing loca; replace glyf).
  type Out = { tag: string; data: Uint8Array };
  const outTables: Out[] = [];
  for (const t of srcTables) {
    if (t.tag === "glyf" || t.tag === "loca") continue;
    let data = ctf.subarray(t.offset, t.offset + t.length);
    if (t.tag === "head") {
      // Force indexToLocFormat = 1 (long loca) and zero checkSumAdjustment.
      data = data.slice();
      const hv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      hv.setUint32(8, 0); // checkSumAdjustment
      hv.setInt16(50, 1); // indexToLocFormat
    }
    outTables.push({ tag: t.tag, data });
  }
  outTables.push({ tag: "glyf", data: glyf });
  outTables.push({ tag: "loca", data: loca });
  outTables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const numTables = outTables.length;
  const headerSize = 12 + 16 * numTables;
  let total = headerSize;
  const layout = outTables.map((t) => {
    const off = total;
    total += PAD(t.data.length);
    return { ...t, off };
  });

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  // sfnt header — TrueType outlines ⇒ version 0x00010000.
  dv.setUint32(0, 0x00010000);
  dv.setUint16(4, numTables);
  const log2 = Math.floor(Math.log2(Math.max(1, numTables)));
  const searchRange = (1 << log2) * 16;
  dv.setUint16(6, searchRange);
  dv.setUint16(8, log2);
  dv.setUint16(10, numTables * 16 - searchRange);

  let headDirOffsetField = -1;
  for (let i = 0; i < layout.length; i++) {
    const t = layout[i];
    const dirOff = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[dirOff + k] = t.tag.charCodeAt(k) & 0xff;
    dv.setUint32(dirOff + 4, tableChecksum(t.data));
    dv.setUint32(dirOff + 8, t.off);
    dv.setUint32(dirOff + 12, t.data.length);
    out.set(t.data, t.off);
    if (t.tag === "head") headDirOffsetField = t.off;
  }

  // head.checkSumAdjustment = 0xB1B0AFBA - checksum(entire file).
  if (headDirOffsetField >= 0) {
    const fileSum = tableChecksum(out);
    const adj = (0xb1b0afba - fileSum) >>> 0;
    dv.setUint32(headDirOffsetField + 8, adj);
  }
  void headRec;
  return out;
}

function tableChecksum(data: Uint8Array): number {
  let sum = 0;
  const n = data.length;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let i = 0;
  for (; i + 4 <= n; i += 4) sum = (sum + dv.getUint32(i)) >>> 0;
  if (i < n) {
    let last = 0;
    for (let k = 0; k < 4; k++) last = (last << 8) | (i + k < n ? data[i + k] : 0);
    sum = (sum + last) >>> 0;
  }
  return sum >>> 0;
}
