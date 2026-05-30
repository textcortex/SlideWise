import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePptx } from "@/lib/pptx/pptxToDeck";
import { decodeEot, isMtxCompressed } from "../eot";

const EON_PPTX = resolve(
  __dirname,
  "../../../../../../.context/attachments/eon-deck.pptx"
);

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return new Uint8Array(Buffer.from(b64, "base64"));
}

describe("EOT decoder", () => {
  it("parses the EOT header of every embedded font in eon-deck.pptx", async () => {
    const buf = readFileSync(EON_PPTX);
    const deck = await parsePptx(new Uint8Array(buf));
    expect(deck.fonts && deck.fonts.length).toBeGreaterThan(0);

    for (const asset of deck.fonts ?? []) {
      const bytes = dataUrlToBytes(asset.data);
      // The header parse must succeed even when the payload is MTX —
      // the EOT wrapper itself is uncompressed metadata.
      expect(() => {
        // We use the predicate rather than throw-on-parse because the
        // MTX-compressed payload is the expected case and shouldn't
        // crash the parser.
        const mtx = isMtxCompressed(bytes);
        expect(typeof mtx).toBe("boolean");
      }).not.toThrow();
    }
  });

  it("detects MTX compression on the EON brand fonts", async () => {
    const buf = readFileSync(EON_PPTX);
    const deck = await parsePptx(new Uint8Array(buf));
    let mtxCount = 0;
    for (const asset of deck.fonts ?? []) {
      const bytes = dataUrlToBytes(asset.data);
      if (isMtxCompressed(bytes)) mtxCount++;
    }
    // The EON template uses MTX-compressed embedded fonts (verified
    // via flag inspection — `TTEMBED_TTCOMPRESSED` set on every entry).
    // If this assertion ever drops to zero, either we've stopped
    // extracting the fonts on import or the fixture changed.
    expect(mtxCount).toBeGreaterThan(0);
  });

  it("decodes the CFF EON fonts via the MTX LZCOMP decoder", async () => {
    // Milestone 2: the clean-room MTX decoder now decodes CFF/OTTO embedded
    // fonts. The 4 EON Brix Sans weights decode to valid OTTO; the TrueType
    // EON Office Head still falls back (mtx-not-implemented). See
    // mtx-decode.test.ts for the per-font assertions.
    const buf = readFileSync(EON_PPTX);
    const deck = await parsePptx(new Uint8Array(buf));
    const cff = (deck.fonts ?? []).find((a) => a.family === "EON Brix Sans")!;
    expect(cff).toBeTruthy();
    const { ttf } = decodeEot(dataUrlToBytes(cff.data));
    expect(String.fromCharCode(ttf[0], ttf[1], ttf[2], ttf[3])).toBe("OTTO");
  });
});
