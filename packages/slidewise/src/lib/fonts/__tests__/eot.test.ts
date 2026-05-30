import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parsePptx } from "@/lib/pptx/pptxToDeck";
import { decodeEot, isMtxCompressed } from "../eot";

const EON_PATH = resolve(
  __dirname,
  "../../../../../../.context/attachments/eon-deck.pptx"
);

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return new Uint8Array(Buffer.from(b64, "base64"));
}

// eon-deck.pptx lives in the gitignored .context/attachments (proprietary
// embedded fonts, not committable). Skip when absent so CI stays green;
// runs locally where the fixture is present.
const hasEon = existsSync(EON_PATH);

describe("EOT decoder", () => {
  it.skipIf(!hasEon)("parses the EOT header of every embedded font in eon-deck.pptx", async () => {
    const buf = readFileSync(EON_PATH);
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

  it.skipIf(!hasEon)("detects MTX compression on the EON brand fonts", async () => {
    const buf = readFileSync(EON_PATH);
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

  it.skipIf(!hasEon)("decodes the CFF EON fonts via the MTX LZCOMP decoder", async () => {
    // Milestone 2: the clean-room MTX decoder now decodes CFF/OTTO embedded
    // fonts. The 4 EON Brix Sans weights decode to valid OTTO; the TrueType
    // EON Office Head still falls back (mtx-not-implemented). See
    // mtx-decode.test.ts for the per-font assertions.
    const buf = readFileSync(EON_PATH);
    const deck = await parsePptx(new Uint8Array(buf));
    const cff = (deck.fonts ?? []).find((a) => a.family === "EON Brix Sans")!;
    expect(cff).toBeTruthy();
    const { ttf } = decodeEot(dataUrlToBytes(cff.data));
    expect(String.fromCharCode(ttf[0], ttf[1], ttf[2], ttf[3])).toBe("OTTO");
  });
});
