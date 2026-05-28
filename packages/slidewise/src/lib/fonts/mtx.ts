/**
 * MTX ("MicroType Express") decompression — partial implementation.
 *
 * ## Where this fits
 *
 * EOT fonts inside PPTX `ppt/fonts/*.fntdata` are often MTX-compressed.
 * MTX is a TTF-specific compressor that Microsoft introduced for EOT in
 * the late 1990s — patented (US 7,103,221, now expired), partially
 * documented in the W3C member submission "MTX File Format Specification"
 * (2008, https://www.w3.org/Submission/MTX/), and elsewhere implemented
 * only by Microsoft's closed-source `ttembed` tool and FontForge's GPL
 * `parsettf.c`. There is no maintained JS port.
 *
 * ## What this module does
 *
 * - Parses the MTX outer container (header + per-table directory)
 * - Handles MTX `COMPRESS_NONE` tables (tables stored uncompressed inside
 *   the MTX stream — common for `head`, `hhea`, `hmtx`, `name`, `post`)
 * - Reassembles a plain TTF from the directory's reconstructed tables
 *
 * ## What this module does NOT yet do
 *
 * - **`COMPRESS_GLYPHCOMPRESS`** (the predicate-based glyph encoder).
 *   This is the heart of MTX and what makes embedded fonts small. Without
 *   it, we can't recover `glyf` / `loca` for the typical EON-style brand
 *   font. We throw `EotDecodeError("mtx-not-implemented")` so the caller
 *   can fall back to the `fontRegistry` / system-font chain.
 * - **`COMPRESS_LZCOMPRESS`** (the LZ77-style dictionary coder applied to
 *   string-heavy tables). Implementable but lower-leverage; deferred.
 *
 * Implementing the full set is a real 2–4 week project against a real
 * font corpus. This module is the scaffolding plus the cheap wins.
 *
 * @throws `EotDecodeError` with `kind = "mtx-not-implemented"` for any
 *         compressed sub-table we don't yet decode. Callers should treat
 *         this as "this font isn't browser-loadable in this version of
 *         Slidewise, fall back to fontRegistry".
 */

import { EotDecodeError } from "./eot";

// MTX outer header constants. From the W3C submission §3.
const MTX_VERSION_MAJOR = 1;
const MTX_COMPRESS_NONE = 0;
const MTX_COMPRESS_LZCOMPRESS = 1;
const MTX_COMPRESS_GLYPHCOMPRESS = 2;

interface MtxTableEntry {
  tag: string; // 4-char ASCII (e.g. "head", "glyf")
  /** Method this table is compressed with — see MTX_COMPRESS_* constants. */
  method: number;
  /** Offset within the MTX payload where this table's compressed bytes begin. */
  offset: number;
  /** Compressed length in bytes. */
  compressedLength: number;
  /** Uncompressed (final TTF table) length. */
  length: number;
  /** TTF table checksum (carried through verbatim to the rebuilt TTF). */
  checksum: number;
}

/**
 * Decompress an MTX-format payload back into TTF/OTF bytes.
 *
 * This is the partial implementation — see the module header for
 * which compression sub-methods are and aren't supported.
 */
export function decompressMtx(payload: Uint8Array): Uint8Array {
  const directory = parseMtxDirectory(payload);

  // Walk every table in the directory; if any one is compressed with a
  // method we don't yet implement, bail loudly so the caller knows to
  // fall back rather than ship a broken font.
  const reconstructed = new Map<string, Uint8Array>();
  for (const entry of directory.tables) {
    if (entry.method === MTX_COMPRESS_NONE) {
      const bytes = payload.subarray(
        entry.offset,
        entry.offset + entry.compressedLength
      );
      // For COMPRESS_NONE, compressedLength === length.
      if (bytes.length !== entry.length) {
        throw new EotDecodeError(
          `MTX COMPRESS_NONE size mismatch for '${entry.tag}' (declared ${entry.length}, got ${bytes.length})`,
          "mtx-failed"
        );
      }
      reconstructed.set(entry.tag, new Uint8Array(bytes));
      continue;
    }
    if (entry.method === MTX_COMPRESS_LZCOMPRESS) {
      throw new EotDecodeError(
        `MTX COMPRESS_LZCOMPRESS not yet implemented (table '${entry.tag}')`,
        "mtx-not-implemented"
      );
    }
    if (entry.method === MTX_COMPRESS_GLYPHCOMPRESS) {
      throw new EotDecodeError(
        `MTX COMPRESS_GLYPHCOMPRESS not yet implemented (table '${entry.tag}'). ` +
          `Brand-embedded PowerPoint fonts use this for 'glyf' — full implementation tracked separately.`,
        "mtx-not-implemented"
      );
    }
    throw new EotDecodeError(
      `MTX unknown compression method ${entry.method} for table '${entry.tag}'`,
      "mtx-failed"
    );
  }

  return buildTtf(directory.sfntVersion, reconstructed, directory.tables);
}

/**
 * Parse the MTX outer header + per-table directory.
 *
 * Layout (from W3C submission §3.1, cross-referenced with FontForge):
 *
 *   uint8   majorVersion       (== 1)
 *   uint8   minorVersion
 *   uint16  numTables
 *   uint32  sfntVersion        (mirrors TTF's `0x00010000` / `OTTO`)
 *   ─── per table (numTables entries) ───
 *   char[4] tag                (e.g. "glyf", "head" — direct ASCII, no swap)
 *   uint8   compressionMethod  (0=none, 1=lz, 2=glyphcompress)
 *   uint24  compressedLength   (3-byte big-endian)
 *   uint24  length             (uncompressed length, also 3-byte BE)
 *   uint32  checksum
 *   uint32  offset             (from start of MTX file)
 *
 * Bytes after the directory are the per-table compressed bodies, in the
 * order indicated by `offset`.
 */
function parseMtxDirectory(
  payload: Uint8Array
): { sfntVersion: number; tables: MtxTableEntry[] } {
  if (payload.length < 8) {
    throw new EotDecodeError("MTX payload shorter than header", "mtx-failed");
  }
  const dv = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength
  );
  const major = payload[0];
  if (major !== MTX_VERSION_MAJOR) {
    // PowerPoint-embedded MTX uses a different major version (observed
    // `0x03` on Office 2019+ output) than the W3C submission spec
    // (`version=1`). The Office variant's format isn't publicly
    // documented — Microsoft never released the spec for the post-2010
    // MTX revisions. Until someone reverse-engineers it, treat any
    // unknown major as "not implemented" so the caller falls through
    // to the registry / system-font chain rather than treating this as
    // a hard failure.
    throw new EotDecodeError(
      `MTX major version ${major} not yet supported. Office uses an undocumented variant of the W3C MTX submission; ` +
        `host this font on a CDN and pass it via fontRegistry as the workaround.`,
      "mtx-not-implemented"
    );
  }
  // payload[1] = minor version — unused for parsing decisions.
  const numTables = dv.getUint16(2, false);
  const sfntVersion = dv.getUint32(4, false);
  const dirStart = 8;
  // Each directory entry is 4 + 1 + 3 + 3 + 4 + 4 = 19 bytes.
  const entrySize = 19;
  if (dirStart + numTables * entrySize > payload.length) {
    throw new EotDecodeError(
      `MTX directory (${numTables} tables) exceeds payload`,
      "mtx-failed"
    );
  }
  const tables: MtxTableEntry[] = [];
  for (let i = 0; i < numTables; i++) {
    const base = dirStart + i * entrySize;
    const tag = String.fromCharCode(
      payload[base],
      payload[base + 1],
      payload[base + 2],
      payload[base + 3]
    );
    const method = payload[base + 4];
    const compressedLength = read24BE(payload, base + 5);
    const length = read24BE(payload, base + 8);
    const checksum = dv.getUint32(base + 11, false);
    const offset = dv.getUint32(base + 15, false);
    if (offset + compressedLength > payload.length) {
      throw new EotDecodeError(
        `MTX table '${tag}' body (offset ${offset} + length ${compressedLength}) exceeds payload`,
        "mtx-failed"
      );
    }
    tables.push({
      tag,
      method,
      compressedLength,
      length,
      checksum,
      offset,
    });
  }
  return { sfntVersion, tables };
}

function read24BE(b: Uint8Array, off: number): number {
  return (b[off] << 16) | (b[off + 1] << 8) | b[off + 2];
}

/**
 * Reassemble a TTF/OTF file from the decompressed table set.
 *
 * The output layout is the standard sfnt file structure:
 *   - sfnt header (12 bytes: sfntVersion + numTables + searchRange + entrySelector + rangeShift)
 *   - table directory (16 bytes × numTables: tag + checksum + offset + length)
 *   - padded table bodies, each aligned to a 4-byte boundary
 *
 * Tables in the directory must be sorted by tag (sfnt spec requires it).
 */
function buildTtf(
  sfntVersion: number,
  reconstructed: Map<string, Uint8Array>,
  metadata: MtxTableEntry[]
): Uint8Array {
  // Pair each reconstructed table with its checksum (from the MTX
  // directory) and sort by tag for the output directory.
  const entries = metadata
    .map((m) => {
      const body = reconstructed.get(m.tag);
      if (!body) {
        // Should be impossible if `decompressMtx` validated correctly.
        throw new EotDecodeError(
          `MTX: no reconstructed body for table '${m.tag}'`,
          "mtx-failed"
        );
      }
      return { tag: m.tag, body, checksum: m.checksum };
    })
    .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const numTables = entries.length;
  // sfnt header + table directory.
  const headerSize = 12 + 16 * numTables;
  // Bodies, each padded to a 4-byte multiple.
  const paddedLengths = entries.map((e) => (e.body.length + 3) & ~3);
  const totalBodyLen = paddedLengths.reduce((acc, n) => acc + n, 0);
  const out = new Uint8Array(headerSize + totalBodyLen);
  const dv = new DataView(out.buffer);

  // sfnt header.
  dv.setUint32(0, sfntVersion, false);
  dv.setUint16(4, numTables, false);
  // searchRange = (largest power of 2 ≤ numTables) * 16.
  const log2 = Math.floor(Math.log2(Math.max(1, numTables)));
  const searchRange = (1 << log2) * 16;
  dv.setUint16(6, searchRange, false);
  dv.setUint16(8, log2, false);
  dv.setUint16(10, numTables * 16 - searchRange, false);

  // Per-table directory + bodies.
  let bodyOff = headerSize;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const dirOff = 12 + i * 16;
    // Tag (4 ASCII bytes).
    for (let k = 0; k < 4; k++) {
      out[dirOff + k] = e.tag.charCodeAt(k) & 0xff;
    }
    dv.setUint32(dirOff + 4, e.checksum, false);
    dv.setUint32(dirOff + 8, bodyOff, false);
    dv.setUint32(dirOff + 12, e.body.length, false);
    out.set(e.body, bodyOff);
    bodyOff += paddedLengths[i];
  }

  return out;
}
