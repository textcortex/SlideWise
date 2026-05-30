import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parsePptx } from "@/lib/pptx/pptxToDeck";
import { decodeEot } from "../eot";

const EON_PATH = resolve(__dirname, "../../../../../../.context/attachments/eon-deck.pptx");
function b(d: string){const c=d.indexOf(",");return new Uint8Array(Buffer.from(c>=0?d.slice(c+1):d,"base64"));}

/**
 * MILESTONE 2 — the clean-room MTX (MicroType Express) LZCOMP decoder, ported
 * from the W3C MTX submission Appendix C. Verified against the real embedded
 * fonts in eon-deck.pptx: the 4 CFF-based EON Brix Sans weights decode to
 * complete, valid OTTO fonts. The TrueType-glyf EON Office Head falls back
 * with mtx-not-implemented (CTF glyf reconstruction is milestone 3).
 */
// eon-deck.pptx lives in the gitignored .context/attachments (proprietary
// embedded fonts, not committable). Skip when absent so CI stays green;
// runs locally where the fixture is present.
const hasEon = existsSync(EON_PATH);

describe("MTX LZCOMP decode (CFF fonts)", () => {
  it.skipIf(!hasEon)("decodes the 4 CFF EON Brix Sans weights to valid OTTO", async () => {
    const deck = await parsePptx(new Uint8Array(readFileSync(EON_PATH)));
    const cff = (deck.fonts ?? []).filter((a) => a.family === "EON Brix Sans");
    expect(cff.length).toBe(4);
    for (const a of cff) {
      const { ttf } = decodeEot(b(a.data));
      const magic = String.fromCharCode(ttf[0], ttf[1], ttf[2], ttf[3]);
      expect(magic).toBe("OTTO");
      expect(ttf.length).toBeGreaterThan(10000);
    }
  });

  it.skipIf(!hasEon)("reconstructs the TrueType-glyf EON Office Head to a valid sfnt", async () => {
    const deck = await parsePptx(new Uint8Array(readFileSync(EON_PATH)));
    const tt = (deck.fonts ?? []).find((a) => a.family === "EON Office Head")!;
    expect(tt).toBeTruthy();
    const { ttf } = decodeEot(b(tt.data));
    // TrueType outlines reassemble with sfnt version 0x00010000.
    const ver = (ttf[0] << 24) | (ttf[1] << 16) | (ttf[2] << 8) | ttf[3];
    expect(ver >>> 0).toBe(0x00010000);
    // glyf + loca present in the rebuilt directory.
    const numTables = (ttf[4] << 8) | ttf[5];
    const tags = new Set<string>();
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      tags.add(String.fromCharCode(ttf[o], ttf[o+1], ttf[o+2], ttf[o+3]));
    }
    expect(tags.has("glyf")).toBe(true);
    expect(tags.has("loca")).toBe(true);
  });
});
