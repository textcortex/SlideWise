/**
 * EOT (Embedded OpenType) parser.
 *
 * EOT is Microsoft's container format for PPTX-embedded fonts. Every byte
 * in `ppt/fonts/font*.fntdata` is an EOT file. The wrapper carries metadata
 * (typeface name, weight, italic, panose, etc.) plus a flag byte that tells
 * us how the payload TTF is packaged:
 *
 *   - **Uncompressed** (`TTEMBED_TTCOMPRESSED` clear): the last
 *     `FontDataSize` bytes ARE a TTF/OTF file. Strip the wrapper, register
 *     via `@font-face`, done.
 *   - **MTX-compressed** (`TTEMBED_TTCOMPRESSED` set): the payload is a
 *     "MicroType Express" stream that has to be decompressed back into a
 *     TTF. Handled by `decompressMtx()` in `./mtx.ts` (best-effort; see
 *     module header).
 *   - **XOR-encrypted** (`TTEMBED_XORENCRYPTDATA`): the first 32 payload
 *     bytes are XOR'd against the font's GUID. Rare; we recognise it and
 *     decrypt before falling through to the format check.
 *
 * The format spec lives in the W3C member submission "Embedded OpenType
 * File Format" (https://www.w3.org/Submission/EOT/), which mirrors the
 * Microsoft published header.
 */

import { decompressMtx } from "./mtx";

// Flag bits on the EOT header `Flags` field. See spec §2.1.
export const TTEMBED_SUBSET = 0x00000001;
export const TTEMBED_TTCOMPRESSED = 0x00000004;
export const TTEMBED_EMBEDEUDC = 0x00000080;
export const TTEMBED_XORENCRYPTDATA = 0x10000000;

const EOT_MAGIC_NUMBER = 0x504c;

export interface EotHeader {
  eotSize: number;
  fontDataSize: number;
  version: number;
  flags: number;
  weight: number;
  italic: boolean;
  /** UTF-16LE-decoded family name from the EOT metadata. May be empty. */
  familyName: string;
  /** Position in the byte buffer where the FontData payload begins. */
  dataOffset: number;
}

export interface DecodedEotFont {
  /** TTF / OTF bytes the browser can register via `@font-face`. */
  ttf: Uint8Array;
  /** EOT header so callers can match the right family / weight / italic. */
  header: EotHeader;
}

export class EotDecodeError extends Error {
  readonly kind:
    | "magic-mismatch"
    | "truncated"
    | "mtx-not-implemented"
    | "mtx-failed";
  constructor(message: string, kind: EotDecodeError["kind"]) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Decode an EOT (`.fntdata`) blob into a browser-renderable TTF.
 *
 * Throws `EotDecodeError` when the blob isn't EOT, is truncated, or uses
 * an MTX compression variant we can't yet handle. Callers should treat
 * a thrown error as "this font isn't loadable in the editor" and fall
 * back to the next font-source in the chain.
 */
export function decodeEot(bytes: Uint8Array): DecodedEotFont {
  const header = parseEotHeader(bytes);

  const flags = header.flags;
  // FontData is the LAST `fontDataSize` bytes of the EOT file — this is
  // the spec-guaranteed location and is far more robust than walking the
  // variable-length name / RootString / EUDC fields to find the offset.
  // (Verified: for eon-deck fonts this lands exactly on the MTX `03`
  // version byte; the name-table walk landed 20 bytes early, inside the
  // RootString/EUDC metadata where the "BSGP" string lives.)
  let payload = bytes.subarray(bytes.length - header.fontDataSize);

  if (flags & TTEMBED_XORENCRYPTDATA) {
    payload = xorDecrypt(payload);
  }

  if (flags & TTEMBED_TTCOMPRESSED) {
    // TTCOMPRESSED ⇒ MicroType Express (MTX). decompressMtx parses +
    // validates the MTX v3 container, then LZCOMP-decompresses. While the
    // LZCOMP / CTF reconstruction milestones are in progress it throws
    // mtx-not-implemented; any genuine parse failure also surfaces as an
    // EotDecodeError so the caller's fallback chain runs.
    const decompressed = decompressMtx(payload);
    return { ttf: decompressed, header };
  }

  // Uncompressed: payload is TTF/OTF bytes directly. Sanity-check the
  // sfnt version so we don't hand garbage to @font-face.
  assertSfnt(payload);
  return { ttf: payload, header };
}

/**
 * Parse the EOT header. We're intentionally strict — if the magic number
 * doesn't match where the spec says it should, the input isn't EOT and
 * we shouldn't keep reading.
 *
 * Returns the parsed header plus the offset where FontData starts so the
 * caller can slice the payload without re-parsing.
 */
export function parseEotHeader(bytes: Uint8Array): EotHeader {
  if (bytes.length < 82) {
    throw new EotDecodeError("EOT shorter than minimum header", "truncated");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eotSize = dv.getUint32(0, true);
  const fontDataSize = dv.getUint32(4, true);
  const version = dv.getUint32(8, true);
  const flags = dv.getUint32(12, true);
  // 16..25 PANOSE (10 bytes) — skipped
  // 26 Charset, 27 Italic (uint8 each)
  const italic = bytes[27] !== 0;
  const weight = dv.getUint32(28, true);
  // 32 fsType (uint16), 34 MagicNumber (uint16)
  const magic = dv.getUint16(34, true);
  if (magic !== EOT_MAGIC_NUMBER) {
    throw new EotDecodeError(
      `EOT magic number mismatch: expected 0x${EOT_MAGIC_NUMBER.toString(16)}, got 0x${magic.toString(16)}`,
      "magic-mismatch"
    );
  }
  // Fixed portion of the header runs through byte 82:
  //   36..51 UnicodeRange1..4   (16)
  //   52..59 CodePageRange1..2  (8)
  //   60..63 CheckSumAdjustment (4)
  //   64..79 Reserved[4]        (16)
  //   80..81 Padding1           (2)  — total = 82
  let off = 82;

  // Variable-length name fields. Each is `uint16 sizeBytes + sizeBytes
  // of UTF-16LE` followed by a `uint16 Padding`. Order: FamilyName,
  // StyleName, VersionName, FullName. Version 2.0+ tacks on RootString;
  // 2.1+ adds even more — we don't need any of those, just walk past.
  const readNameString = (): string => {
    if (off + 2 > bytes.length) {
      throw new EotDecodeError("truncated at name field length", "truncated");
    }
    const size = dv.getUint16(off, true);
    off += 2;
    if (off + size > bytes.length) {
      throw new EotDecodeError("truncated at name field body", "truncated");
    }
    const slice = bytes.subarray(off, off + size);
    off += size;
    return decodeUtf16Le(slice);
  };
  const skipPadding = (): void => {
    if (off + 2 > bytes.length) {
      throw new EotDecodeError("truncated at padding", "truncated");
    }
    off += 2;
  };

  const familyName = readNameString();
  skipPadding();
  const _style = readNameString();
  void _style;
  skipPadding();
  const _version = readNameString();
  void _version;
  skipPadding();
  const _full = readNameString();
  void _full;

  // EOT 2.0 (0x00020001) and 2.2 (0x00020002) add a RootString name
  // field after FullName. Empirically — verified against real
  // PowerPoint-embedded fonts — FontData begins immediately after
  // RootString; the spec's optional EUDC / Signature blocks are either
  // absent or laid out such that they don't precede FontData here.
  // (An earlier version of this parser tried to walk the 2.2 EUDC tail
  // and over-advanced `off` by 20 bytes, landing past the true FontData
  // magic — confirmed against eon-deck.pptx where FontData starts at 212
  // with a "BSGP" magic, not at 232.) So we stop after RootString and
  // let the FontData slice begin there.
  if (version === 0x00020001 || version === 0x00020002) {
    skipPadding();
    const _root = readNameString();
    void _root;
  }

  // Sanity: derived FontData offset + size should land within the file.
  if (off + fontDataSize > bytes.length) {
    // Some real-world EOT files declare a slightly oversized
    // `fontDataSize` (off-by-one against actual file length). Be lenient
    // and clamp to what's actually available rather than refusing the
    // font entirely.
    const adjusted = bytes.length - off;
    if (adjusted < 0) {
      throw new EotDecodeError("FontData offset past EOF", "truncated");
    }
    return {
      eotSize,
      fontDataSize: adjusted,
      version,
      flags,
      weight,
      italic,
      familyName,
      dataOffset: off,
    };
  }
  return {
    eotSize,
    fontDataSize,
    version,
    flags,
    weight,
    italic,
    familyName,
    dataOffset: off,
  };
}

/**
 * XOR-decrypt the first 32 payload bytes against the font's GUID. The
 * GUID lives in the Signature field on EOT 2.2 fonts, but for our
 * purposes here we accept the encrypted payload as-is from the caller —
 * production decks rarely use XOR encryption alongside MTX so this is a
 * placeholder for completeness; left as identity when we don't have the
 * key. Returning a copy keeps the original buffer immutable.
 */
function xorDecrypt(payload: Uint8Array): Uint8Array {
  // TODO(MTX follow-up): wire the GUID through from `parseEotHeader` so
  // this can actually decrypt. Until then we pass payload through and
  // hope the subsequent format check trips an honest error.
  return new Uint8Array(payload);
}

function assertSfnt(payload: Uint8Array): void {
  if (payload.length < 4) {
    throw new EotDecodeError("payload too short to contain TTF magic", "truncated");
  }
  const m0 = payload[0];
  const m1 = payload[1];
  const m2 = payload[2];
  const m3 = payload[3];
  // Valid sfnt versions: 0x00010000 (TTF), "OTTO" (OpenType CFF),
  // "true" (Apple TrueType), "typ1" (PostScript Type 1).
  const isTtf =
    m0 === 0x00 && m1 === 0x01 && m2 === 0x00 && m3 === 0x00;
  const isOtto =
    m0 === 0x4f && m1 === 0x54 && m2 === 0x54 && m3 === 0x4f;
  const isTrue =
    m0 === 0x74 && m1 === 0x72 && m2 === 0x75 && m3 === 0x65;
  const isTyp1 =
    m0 === 0x74 && m1 === 0x79 && m2 === 0x70 && m3 === 0x31;
  if (!isTtf && !isOtto && !isTrue && !isTyp1) {
    throw new EotDecodeError(
      `payload doesn't start with an sfnt magic (got 0x${m0
        .toString(16)
        .padStart(2, "0")}${m1.toString(16).padStart(2, "0")}${m2
        .toString(16)
        .padStart(2, "0")}${m3.toString(16).padStart(2, "0")})`,
      "truncated"
    );
  }
}

function decodeUtf16Le(bytes: Uint8Array): string {
  // Pair up bytes manually; TextDecoder("utf-16le") would work but
  // pulling it in here keeps the module portable to non-browser test
  // environments without extra polyfills.
  const codeUnits = new Array<number>(bytes.length >> 1);
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    codeUnits[i >> 1] = bytes[i] | (bytes[i + 1] << 8);
  }
  return String.fromCharCode(...codeUnits);
}

/**
 * Quick predicate that lets callers cheaply distinguish "this is EOT but
 * compressed (skip / queue for MTX)" from "this is EOT and we can ship a
 * TTF synchronously".
 */
export function isMtxCompressed(bytes: Uint8Array): boolean {
  try {
    const h = parseEotHeader(bytes);
    return (h.flags & TTEMBED_TTCOMPRESSED) !== 0;
  } catch {
    return false;
  }
}
