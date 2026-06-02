import { describe, it, expect } from "vitest";
import { reconstructTrueType } from "../ctf-glyf";

// Build a minimal CTF-format sfnt with one composite glyph whose LAST
// component carries WE_HAVE_INSTRUCTIONS (0x0100). This mirrors the real
// PowerPoint embedded fonts (e.g. "colon" in DM Serif Display) that broke
// the decoder: it only cleared the instructions bit on the FIRST component,
// so a parser would read a non-existent instructionLength past the glyph
// and reject the whole font. The reconstructed glyf must clear the bit on
// EVERY component and leave no trailing instructionLength.

const WE_HAVE_INSTRUCTIONS = 0x0100;
const ARGS_ARE_XY = 0x0002;
const MORE_COMPONENTS = 0x0020;

function u16(v: number): number[] {
  return [(v >> 8) & 0xff, v & 0xff];
}

function buildCtf(): Uint8Array {
  // --- CTF glyf for glyph 0: composite, 2 byte-arg components ---
  const glyf: number[] = [
    0xff, 0xff, // numContours = -1
    ...u16(0), ...u16(0), ...u16(100), ...u16(100), // bbox
    // component 1: ARGS_ARE_XY | MORE_COMPONENTS, glyphIndex 0, byte args
    ...u16(ARGS_ARE_XY | MORE_COMPONENTS), ...u16(0), 0, 0,
    // component 2 (last): ARGS_ARE_XY | WE_HAVE_INSTRUCTIONS, glyphIndex 1
    ...u16(ARGS_ARE_XY | WE_HAVE_INSTRUCTIONS), ...u16(1), 0, 0,
    // weHaveInstr ⇒ CTF stores pushCount + codeSize (255UShort each)
    0, 0,
  ];
  const maxp = new Array(32).fill(0);
  maxp[4] = 0; maxp[5] = 1; // numGlyphs = 1
  const head = new Array(54).fill(0); // assembleSfnt patches offsets 8 + 50

  const tables: Array<{ tag: string; data: number[] }> = [
    { tag: "maxp", data: maxp },
    { tag: "head", data: head },
    { tag: "glyf", data: glyf },
  ];
  const dirSize = 12 + tables.length * 16;
  let off = dirSize;
  const header: number[] = [
    ...u16(0x0001), ...u16(0x0000), // sfnt version 0x00010000
    ...u16(tables.length), ...u16(0), ...u16(0), ...u16(0),
  ];
  const dir: number[] = [];
  const body: number[] = [];
  for (const t of tables) {
    dir.push(...t.tag.split("").map((c) => c.charCodeAt(0)));
    dir.push(...u16(0), ...u16(0)); // checksum (ignored)
    dir.push(...u16((off >> 16) & 0xffff), ...u16(off & 0xffff)); // offset
    dir.push(...u16((t.data.length >> 16) & 0xffff), ...u16(t.data.length & 0xffff));
    body.push(...t.data);
    off += t.data.length;
  }
  return new Uint8Array([...header, ...dir, ...body]);
}

function tableOffset(sfnt: Uint8Array, tag: string): { off: number; len: number } {
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const n = dv.getUint16(4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const t = String.fromCharCode(sfnt[o], sfnt[o + 1], sfnt[o + 2], sfnt[o + 3]);
    if (t === tag) return { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
  }
  throw new Error(`table ${tag} not found`);
}

describe("CTF composite reconstruction", () => {
  it("clears WE_HAVE_INSTRUCTIONS on every component, not just the first", () => {
    const out = reconstructTrueType(buildCtf());
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);

    const loca = tableOffset(out, "loca");
    const glyf = tableOffset(out, "glyf");
    const g0 = dv.getUint32(loca.off); // long loca
    const g1 = dv.getUint32(loca.off + 4);
    const base = glyf.off + g0;
    const glyphLen = g1 - g0;

    expect(dv.getInt16(base)).toBe(-1); // composite

    // Walk components; assert none keeps WE_HAVE_INSTRUCTIONS and the walk
    // ends within the glyph (no dangling instructionLength to read).
    let p = base + 10; // skip numContours + bbox
    let more = true;
    let count = 0;
    const end = base + glyphLen;
    while (more) {
      expect(p + 4).toBeLessThanOrEqual(end);
      const flags = dv.getUint16(p);
      expect(flags & WE_HAVE_INSTRUCTIONS).toBe(0);
      p += 4; // flags + glyphIndex
      p += flags & 0x0001 ? 4 : 2; // args
      if (flags & 0x0008) p += 2;
      else if (flags & 0x0040) p += 4;
      else if (flags & 0x0080) p += 8;
      more = (flags & MORE_COMPONENTS) !== 0;
      count++;
    }
    expect(count).toBe(2);
    // No bytes beyond the components except 0..3 of padding alignment.
    expect(end - p).toBeLessThanOrEqual(3);
  });
});
