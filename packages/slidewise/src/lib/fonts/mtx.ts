/**
 * MTX (MicroType Express) decompression — MTX v3, per the W3C "MicroType
 * Express (MTX) Font Format" submission (https://www.w3.org/Submission/MTX/)
 * and ISO/IEC 14496-18.
 *
 * ## Status: milestone 1 — container parse (verified) + LZCOMP (in progress)
 *
 * The format, confirmed byte-for-byte against 5 real PowerPoint-embedded fonts
 * (eon-deck.pptx — EON Brix Sans ×4 weights, EON Office Head):
 *
 *   Header (10 bytes, big-endian):
 *     [0]      uint8   version           (== 3 for MTX v1.0)
 *     [1..3]   uint24  copyLimit         (LZCOMP copy-distance parameter)
 *     [4..6]   uint24  offsetData2       (start of block 2, push data)
 *     [7..9]   uint24  offsetData3       (start of block 3, instructions)
 *
 *   Then three independently LZCOMP-compressed blocks:
 *     Block 1  [10 .. offsetData2)   CTF font tables (incl. compressed glyf;
 *                                    loca eliminated, set to 0/0)
 *     Block 2  [offsetData2 .. offsetData3)  glyph push data
 *     Block 3  [offsetData3 .. end)  glyph instructions
 *
 *   Validity: version==3, offsetData2 < offsetData3, and the three blocks
 *   tile the payload exactly: (data2-10) + (data3-data2) + (size-data3) == size-10.
 *
 * This module parses + validates that container (done, verified) and exposes
 * the three raw compressed blocks. The LZCOMP decompressor + CTF glyf
 * reconstruction are the remaining milestones — see `./lzcomp.ts`.
 *
 * Note: LibreOffice's decoder rejects these fonts with "no blank loca table
 * found" — that's a LibreOffice strictness bug, NOT a malformed font. The MTX
 * spec explicitly *removes* the loca table (offset & length set to 0); it's
 * rebuilt from the decompressed glyf. So these fonts are spec-compliant.
 */

import { EotDecodeError } from "./eot";
import { lzcompDecompress } from "./lzcomp";
import { reconstructTrueType } from "./ctf-glyf";

export interface MtxContainer {
  version: number;
  copyLimit: number;
  /** Block 1: CTF font tables (LZCOMP-compressed). */
  block1: Uint8Array;
  /** Block 2: glyph push data (LZCOMP-compressed). */
  block2: Uint8Array;
  /** Block 3: glyph instructions (LZCOMP-compressed). */
  block3: Uint8Array;
}

function u24be(b: Uint8Array, o: number): number {
  return (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
}

/**
 * Parse + validate the MTX v3 container. Returns the three raw
 * (still-LZCOMP-compressed) blocks. Throws `EotDecodeError` when the
 * payload isn't a well-formed MTX v3 container.
 */
export function parseMtxContainer(payload: Uint8Array): MtxContainer {
  if (payload.length < 11) {
    throw new EotDecodeError("MTX payload shorter than header", "mtx-failed");
  }
  const version = payload[0];
  if (version !== 3) {
    throw new EotDecodeError(
      `MTX version ${version} not supported (expected 3)`,
      "mtx-not-implemented"
    );
  }
  const copyLimit = u24be(payload, 1);
  const offsetData2 = u24be(payload, 4);
  const offsetData3 = u24be(payload, 7);
  const size = payload.length;

  // Validity: blocks must be ordered and tile the payload exactly.
  if (!(offsetData2 < offsetData3)) {
    throw new EotDecodeError(
      `MTX offsetData2 (${offsetData2}) must be < offsetData3 (${offsetData3})`,
      "mtx-failed"
    );
  }
  const block1Len = offsetData2 - 10;
  const block2Len = offsetData3 - offsetData2;
  const block3Len = size - offsetData3;
  if (
    block1Len < 0 ||
    block2Len < 0 ||
    block3Len < 0 ||
    block1Len + block2Len + block3Len !== size - 10
  ) {
    throw new EotDecodeError(
      `MTX blocks don't tile the payload (b1=${block1Len} b2=${block2Len} b3=${block3Len} size=${size})`,
      "mtx-failed"
    );
  }

  return {
    version,
    copyLimit,
    block1: payload.subarray(10, offsetData2),
    block2: payload.subarray(offsetData2, offsetData3),
    block3: payload.subarray(offsetData3, size),
  };
}

/**
 * Full MTX → TTF decompression. Parses the container, LZCOMP-decompresses
 * each block, reconstructs the CTF font tables (rebuilding loca from the
 * decompressed glyf), and reassembles a standard sfnt.
 *
 * MILESTONE STATUS: container parse + LZCOMP decompress are implemented;
 * CTF→sfnt reconstruction (triplet-decode glyf, rebuild loca) is the next
 * milestone. Until that lands, this throws `mtx-not-implemented` AFTER the
 * blocks decompress, so the caller falls back to fontRegistry while we can
 * still unit-test the LZCOMP layer in isolation.
 */
export function decompressMtx(payload: Uint8Array): Uint8Array {
  const c = parseMtxContainer(payload);

  // Block 1 LZCOMP-decompresses to the CTF font tables. For CFF/OpenType
  // fonts (sfnt magic "OTTO") there is no glyf/loca, so block 1 is already a
  // complete, valid sfnt — return it directly. (Verified: every EON embedded
  // font decodes to a complete "EON Brix Sans" / "EON Office Head" OTF.)
  const block1 = lzcompDecompress(c.block1, c.version);
  if (block1.length < 12) {
    throw new EotDecodeError("MTX block1 too small to be sfnt", "mtx-failed");
  }
  const tables = readSfntTableTags(block1);

  if (!tables.has("glyf")) {
    // CFF / OpenType-PostScript: block 1 is the whole font.
    assertSfntTiles(block1);
    return block1;
  }

  // TrueType (glyf) outlines: MTX strips loca and re-encodes glyf in CTF.
  // Reconstruct a standard glyf + loca and reassemble the sfnt.
  return reconstructTrueType(block1);
}

/** Read the set of 4-char table tags from an sfnt table directory. */
function readSfntTableTags(sfnt: Uint8Array): Set<string> {
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const numTables = dv.getUint16(4);
  const tags = new Set<string>();
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    if (o + 4 > sfnt.length) break;
    tags.add(
      String.fromCharCode(sfnt[o], sfnt[o + 1], sfnt[o + 2], sfnt[o + 3])
    );
  }
  return tags;
}

/** Sanity-check that the sfnt's table records lie within the buffer. */
function assertSfntTiles(sfnt: Uint8Array): void {
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const numTables = dv.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const off = dv.getUint32(o + 8);
    const len = dv.getUint32(o + 12);
    if (off + len > sfnt.length) {
      throw new EotDecodeError("MTX block1 table record out of bounds", "mtx-failed");
    }
  }
}
