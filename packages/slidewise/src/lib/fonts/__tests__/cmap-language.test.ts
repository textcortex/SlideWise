import { describe, it, expect } from "vitest";
import { reconstructTrueType } from "../ctf-glyf";

// PowerPoint-embedded faces (e.g. DM Serif Display) ship format-12 cmap
// subtables with a non-zero `language` on the Windows/Unicode platform. The
// browser sanitizer (OTS) rejects the whole font for this, even though
// fontTools tolerates it. reconstructTrueType must zero `language` on
// non-Macintosh subtables so the decoded font actually loads in a browser.

function u16(v: number): number[] {
  return [(v >> 8) & 0xff, v & 0xff];
}
function u32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function buildCtfWithBadCmap(): Uint8Array {
  // glyf: single empty glyph (numContours = 0).
  const glyf = [0x00, 0x00];
  const maxp = new Array(32).fill(0);
  maxp[4] = 0; maxp[5] = 1; // numGlyphs = 1
  const head = new Array(54).fill(0);

  // cmap: one format-12 subtable, platform 3 / enc 10, language = 1007.
  const subOff = 12; // 4 (header) + 8 (one encoding record)
  const subtable = [
    ...u16(12), ...u16(0), // format 12, reserved
    ...u32(28), // length (16 header + 12 group)
    ...u32(1007), // language (BAD — must become 0)
    ...u32(1), // numGroups
    ...u32(65), ...u32(65), ...u32(0), // one group: 'A' -> glyph 0
  ];
  const cmap = [
    ...u16(0), ...u16(1), // version, numTables
    ...u16(3), ...u16(10), ...u32(subOff), // encoding record
    ...subtable,
  ];

  const tables: Array<{ tag: string; data: number[] }> = [
    { tag: "cmap", data: cmap },
    { tag: "maxp", data: maxp },
    { tag: "head", data: head },
    { tag: "glyf", data: glyf },
  ];
  const dirSize = 12 + tables.length * 16;
  let off = dirSize;
  const header = [...u16(0x0001), ...u16(0x0000), ...u16(tables.length), ...u16(0), ...u16(0), ...u16(0)];
  const dir: number[] = [];
  const body: number[] = [];
  for (const t of tables) {
    dir.push(...t.tag.split("").map((c) => c.charCodeAt(0)));
    dir.push(...u32(0)); // checksum (ignored)
    dir.push(...u32(off));
    dir.push(...u32(t.data.length));
    body.push(...t.data);
    off += t.data.length;
  }
  return new Uint8Array([...header, ...dir, ...body]);
}

function findTable(sfnt: Uint8Array, tag: string): { off: number; len: number } {
  const dv = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const n = dv.getUint16(4);
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    const t = String.fromCharCode(sfnt[o], sfnt[o + 1], sfnt[o + 2], sfnt[o + 3]);
    if (t === tag) return { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
  }
  throw new Error(`no ${tag}`);
}

describe("cmap language sanitization", () => {
  it("zeroes the language field of a non-Mac format-12 subtable", () => {
    const out = reconstructTrueType(buildCtfWithBadCmap());
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const cmap = findTable(out, "cmap");
    const subOff = cmap.off + dv.getUint32(cmap.off + 8); // encoding record offset
    expect(dv.getUint16(subOff)).toBe(12); // format 12 preserved
    expect(dv.getUint32(subOff + 8)).toBe(0); // language zeroed
    // group data still intact ('A' -> glyph 0).
    expect(dv.getUint32(subOff + 16)).toBe(65);
  });
});
