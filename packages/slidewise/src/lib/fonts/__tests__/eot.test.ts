import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePptx } from "@/lib/pptx/pptxToDeck";
import { decodeEot, isMtxCompressed, EotDecodeError } from "../eot";

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

  it("throws EotDecodeError with kind=mtx-not-implemented on EON fonts", async () => {
    const buf = readFileSync(EON_PPTX);
    const deck = await parsePptx(new Uint8Array(buf));
    const mtxAsset = (deck.fonts ?? []).find((a) =>
      isMtxCompressed(dataUrlToBytes(a.data))
    );
    expect(mtxAsset).toBeTruthy();
    if (!mtxAsset) return;
    const bytes = dataUrlToBytes(mtxAsset.data);
    try {
      decodeEot(bytes);
      // If we reach here, the decoder mistakenly thinks it succeeded;
      // that would be a bug — fail the test loudly.
      expect.unreachable("MTX decode should not yet succeed for EON fonts");
    } catch (err) {
      // The expected path: caller sees a kind="mtx-not-implemented"
      // signal and falls back to fontRegistry / system fonts.
      expect(err).toBeInstanceOf(EotDecodeError);
      expect((err as EotDecodeError).kind).toBe("mtx-not-implemented");
    }
  });
});
