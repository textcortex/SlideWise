/**
 * LZCOMP decompressor for MTX (MicroType Express) — clean-room TypeScript port
 * of the W3C MTX submission Appendix C (BITIO.C / AHUFF.C / LZCOMP.C),
 * https://www.w3.org/Submission/MTX/. Verified against real PowerPoint-embedded
 * fonts (eon-deck.pptx).
 *
 * Pipeline (per block):
 *   1 bit  usingRunLength (when MTX version != 1)
 *   AHUFF dist tree (range 8) + len tree (range 8) created — consume no bits
 *   24 bits out_len
 *   SetDistRange(out_len) → num_DistRanges, DUP2/4/6, NUM_SYMS
 *   AHUFF sym tree (range NUM_SYMS) created
 *   Decode(): a 7168-byte preload dictionary, then a copy-model loop emitting
 *             out_len bytes.
 *
 * Adaptive Huffman (AHUFF): array of {up,left,right,code,weight}, ROOT=1,
 * nodes kept in non-increasing weight order; complete-binary-tree init with
 * leaf for symbol i at index range+i, then a priming sequence; sibling-rule
 * maintained by SwapNodes during UpdateWeight.
 */

import { EotDecodeError } from "./eot";

const PRELOAD_SIZE = 2 * 32 * 96 + 4 * 256; // 7168
const LEN_WIDTH = 3;
const DIST_WIDTH = 3;
const LEN_MIN = 2;
const DIST_MIN = 1;
const MAX_2BYTE_DIST = 512;

class BitReader {
  private bytes: Uint8Array;
  private pos = 0;
  private bit = 0; // MSB-first within byte
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  readBit(): number {
    if (this.pos >= this.bytes.length) return 0;
    const v = (this.bytes[this.pos] >> (7 - this.bit)) & 1;
    if (++this.bit === 8) {
      this.bit = 0;
      this.pos++;
    }
    return v;
  }
  readValue(n: number): number {
    let v = 0;
    for (let i = n - 1; i >= 0; i--) v = (v << 1) | this.readBit();
    return v >>> 0;
  }
}

function bitsUsed(x: number): number {
  let n = 0;
  while (x > 0) {
    n++;
    x >>>= 1;
  }
  return n;
}

const ROOT = 1;

/** Adaptive Huffman, faithful to AHUFF.C. */
class AHuff {
  private up: Int32Array;
  private left: Int32Array;
  private right: Int32Array;
  private code: Int32Array;
  private weight: Float64Array;
  private symbolIndex: Int32Array;
  readonly range: number;

  constructor(range: number) {
    this.range = range;
    const n = 2 * range;
    this.up = new Int32Array(n);
    this.left = new Int32Array(n);
    this.right = new Int32Array(n);
    this.code = new Int32Array(n);
    this.weight = new Float64Array(n);
    this.symbolIndex = new Int32Array(range);

    let bitCount2 = 0;
    if (range > 256 && range < 512) {
      const r2 = range - 256;
      bitCount2 = bitsUsed(r2 - 1) + 1;
    }

    // Complete-binary-tree init: node i has children 2i / 2i+1 and parent
    // i>>1; leaves occupy [range .. 2*range-1] with symbol i at range+i.
    for (let i = 2; i < n; i++) {
      this.up[i] = i >> 1;
      this.weight[i] = 1;
    }
    for (let i = 1; i < range; i++) {
      this.left[i] = 2 * i;
      this.right[i] = 2 * i + 1;
    }
    for (let i = 0; i < range; i++) {
      this.code[i] = -1;
      this.code[range + i] = i;
      this.left[range + i] = -1;
      this.right[range + i] = -1;
      this.symbolIndex[i] = range + i;
    }
    this.initWeight(ROOT);

    // Priming sequence (exactly as AHUFF.C): biases the starting tree.
    if (bitCount2 !== 0) {
      this.updateWeight(this.symbolIndex[256]);
      this.updateWeight(this.symbolIndex[257]);
      for (let i = 0; i < 12; i++) this.updateWeight(this.symbolIndex[range - 3]); // DUP2
      for (let i = 0; i < 6; i++) this.updateWeight(this.symbolIndex[range - 2]); // DUP4
      // DUP6 (range-1): no priming
    } else {
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < range; i++) this.updateWeight(this.symbolIndex[i]);
      }
    }
  }

  private initWeight(a: number): number {
    if (this.code[a] < 0) {
      this.weight[a] = this.initWeight(this.left[a]) + this.initWeight(this.right[a]);
    }
    return this.weight[a];
  }

  private swapNodes(a: number, b: number): void {
    const upa = this.up[a];
    const upb = this.up[b];
    // swap full node records
    const w = this.weight[a]; this.weight[a] = this.weight[b]; this.weight[b] = w;
    const l = this.left[a]; this.left[a] = this.left[b]; this.left[b] = l;
    const r = this.right[a]; this.right[a] = this.right[b]; this.right[b] = r;
    const c = this.code[a]; this.code[a] = this.code[b]; this.code[b] = c;
    // positions keep their original parents
    this.up[a] = upa;
    this.up[b] = upb;
    // fix children's parent pointers / symbol index
    if (this.code[a] < 0) {
      this.up[this.left[a]] = a;
      this.up[this.right[a]] = a;
    } else {
      this.symbolIndex[this.code[a]] = a;
    }
    if (this.code[b] < 0) {
      this.up[this.left[b]] = b;
      this.up[this.right[b]] = b;
    } else {
      this.symbolIndex[this.code[b]] = b;
    }
  }

  private updateWeight(a: number): void {
    while (a !== ROOT) {
      const weightA = this.weight[a];
      let b = a - 1;
      if (this.weight[b] === weightA) {
        do {
          b--;
        } while (this.weight[b] === weightA);
        b++;
        if (b > ROOT) {
          this.swapNodes(a, b);
          a = b;
        }
      }
      this.weight[a] = weightA + 1;
      a = this.up[a];
    }
    this.weight[ROOT] = this.weight[ROOT] + 1;
  }

  readSymbol(br: BitReader): number {
    let a = ROOT;
    let symbol: number;
    do {
      a = br.readBit() ? this.right[a] : this.left[a];
      symbol = this.code[a];
    } while (symbol < 0);
    this.updateWeight(a);
    return symbol;
  }
}

/** SetDistRange — derive num_DistRanges + NUM_SYMS from the output length. */
function setDistRange(outLen: number): {
  numDistRanges: number;
  dup2: number;
  dup4: number;
  dup6: number;
  numSyms: number;
} {
  let numDistRanges = 1;
  let distMax = DIST_MIN + (1 << (DIST_WIDTH * numDistRanges)) - 1;
  while (distMax < outLen) {
    numDistRanges++;
    distMax = DIST_MIN + Math.pow(2, DIST_WIDTH * numDistRanges) - 1;
  }
  const dup2 = 256 + (1 << LEN_WIDTH) * numDistRanges;
  const dup4 = dup2 + 1;
  const dup6 = dup4 + 1;
  return { numDistRanges, dup2, dup4, dup6, numSyms: dup6 + 1 };
}

function decodeLength(
  symbol: number,
  br: BitReader,
  lenTree: AHuff
): { length: number; numDistRanges: number } {
  const bitRange = LEN_WIDTH - 1; // 2
  const mask = 1 << bitRange; // 4
  let value = 0;
  let firstTime = true;
  let numDistRanges = 1;
  let done: boolean;
  do {
    let bits: number;
    if (firstTime) {
      const seed = symbol - 256;
      numDistRanges = ((seed / (1 << LEN_WIDTH)) | 0) + 1;
      bits = seed % (1 << LEN_WIDTH);
      firstTime = false;
    } else {
      bits = lenTree.readSymbol(br);
    }
    done = (bits & mask) === 0;
    bits &= ~mask;
    value = (value << bitRange) | bits;
  } while (!done);
  return { length: value + LEN_MIN, numDistRanges };
}

function decodeDistance(numDistRanges: number, br: BitReader, distTree: AHuff): number {
  let value = 0;
  for (let i = numDistRanges; i > 0; i--) {
    value = (value << DIST_WIDTH) | distTree.readSymbol(br);
  }
  return value + DIST_MIN;
}

function fillPreload(buf: Uint8Array): void {
  // Exactly InitializeModel(decompress): 32×96 (k,j) pairs, then 256×4 of j.
  let i = 0;
  for (let k = 0; k < 32; k++) {
    for (let j = 0; j < 96; j++) {
      buf[i++] = k;
      buf[i++] = j;
    }
  }
  let j = 0;
  while (i < PRELOAD_SIZE && j < 256) {
    buf[i++] = j;
    buf[i++] = j;
    buf[i++] = j;
    buf[i++] = j;
    j++;
  }
}

/**
 * Decompress one LZCOMP block (one of the MTX container's three blocks).
 * Returns the decompressed bytes. `mtxVersion` selects whether the
 * usingRunLength bit is present (absent when version == 1).
 */
export function lzcompDecompress(block: Uint8Array, mtxVersion = 3): Uint8Array {
  const br = new BitReader(block);
  const usingRunLength = mtxVersion === 1 ? 0 : br.readBit();
  if (usingRunLength) {
    // RUNLENGTHCOMP wrapper — rare; SaveBytes layer not yet ported.
    throw new EotDecodeError(
      "MTX block uses RUNLENGTHCOMP wrapper (not yet ported)",
      "mtx-not-implemented"
    );
  }

  // dist + len trees (range 8) are created before out_len is read; they
  // consume no bits at construction.
  const distTree = new AHuff(1 << DIST_WIDTH);
  const lenTree = new AHuff(1 << LEN_WIDTH);

  const outLen = br.readValue(24);
  if (outLen === 0) return new Uint8Array(0);
  const { numSyms, dup2, dup4, dup6 } = setDistRange(outLen);
  const symTree = new AHuff(numSyms);

  const buf = new Uint8Array(PRELOAD_SIZE + outLen);
  fillPreload(buf);
  const base = PRELOAD_SIZE;
  let pos = 0;

  while (pos < outLen) {
    const symbol = symTree.readSymbol(br);
    if (symbol < 256) {
      buf[base + pos++] = symbol;
    } else if (symbol === dup2) {
      buf[base + pos] = buf[base + pos - 2];
      pos++;
    } else if (symbol === dup4) {
      buf[base + pos] = buf[base + pos - 4];
      pos++;
    } else if (symbol === dup6) {
      buf[base + pos] = buf[base + pos - 6];
      pos++;
    } else {
      const { length: len0, numDistRanges } = decodeLength(symbol, br, lenTree);
      const distance = decodeDistance(numDistRanges, br, distTree);
      const length = distance >= MAX_2BYTE_DIST ? len0 + 1 : len0;
      // distance is measured to the END of the copied run.
      const start = pos - distance - length + 1;
      if (base + start < 0) {
        throw new EotDecodeError("LZCOMP copy before preload start", "mtx-failed");
      }
      for (let j = 0; j < length; j++) {
        buf[base + pos] = buf[base + start + j];
        pos++;
      }
    }
  }
  return buf.subarray(base, base + outLen);
}
