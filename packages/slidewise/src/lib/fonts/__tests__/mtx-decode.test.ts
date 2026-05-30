import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePptx } from "@/lib/pptx/pptxToDeck";
import { decodeEot, EotDecodeError } from "../eot";

const EON = resolve(__dirname, "../../../../../../.context/attachments/eon-deck.pptx");
function b(d: string){const c=d.indexOf(",");return new Uint8Array(Buffer.from(c>=0?d.slice(c+1):d,"base64"));}

/**
 * MILESTONE 2 — the clean-room MTX (MicroType Express) LZCOMP decoder, ported
 * from the W3C MTX submission Appendix C. Verified against the real embedded
 * fonts in eon-deck.pptx: the 4 CFF-based EON Brix Sans weights decode to
 * complete, valid OTTO fonts. The TrueType-glyf EON Office Head falls back
 * with mtx-not-implemented (CTF glyf reconstruction is milestone 3).
 */
describe("MTX LZCOMP decode (CFF fonts)", () => {
  it("decodes the 4 CFF EON Brix Sans weights to valid OTTO", async () => {
    const deck = await parsePptx(new Uint8Array(readFileSync(EON)));
    const cff = (deck.fonts ?? []).filter((a) => a.family === "EON Brix Sans");
    expect(cff.length).toBe(4);
    for (const a of cff) {
      const { ttf } = decodeEot(b(a.data));
      const magic = String.fromCharCode(ttf[0], ttf[1], ttf[2], ttf[3]);
      expect(magic).toBe("OTTO");
      expect(ttf.length).toBeGreaterThan(10000);
    }
  });

  it("falls back cleanly on the TrueType-glyf font (milestone 3 pending)", async () => {
    const deck = await parsePptx(new Uint8Array(readFileSync(EON)));
    const tt = (deck.fonts ?? []).find((a) => a.family === "EON Office Head")!;
    expect(tt).toBeTruthy();
    try {
      decodeEot(b(tt.data));
      expect.unreachable("glyf reconstruction not implemented yet");
    } catch (e) {
      expect(e).toBeInstanceOf(EotDecodeError);
      expect((e as EotDecodeError).kind).toBe("mtx-not-implemented");
    }
  });
});
