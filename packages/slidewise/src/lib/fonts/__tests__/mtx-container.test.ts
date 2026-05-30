import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parsePptx } from "@/lib/pptx/pptxToDeck";
import { parseMtxContainer } from "../mtx";

const EON_PATH = resolve(__dirname, "../../../../../../.context/attachments/eon-deck.pptx");
function b(d: string) { const c = d.indexOf(","); return new Uint8Array(Buffer.from(c >= 0 ? d.slice(c + 1) : d, "base64")); }

/**
 * MILESTONE 1 — the MTX v3 container parse is verified-correct against every
 * embedded font in eon-deck.pptx: version == 3, blocks ordered, blocks tile
 * the payload exactly. LZCOMP block decompression + CTF glyf reconstruction
 * are later milestones (see mtx.ts / lzcomp.ts).
 */
// eon-deck.pptx lives in the gitignored .context/attachments (proprietary
// embedded fonts, not committable). Skip when absent so CI stays green;
// runs locally where the fixture is present.
const hasEon = existsSync(EON_PATH);

describe("MTX v3 container parse", () => {
  it.skipIf(!hasEon)("parses + validates every embedded EON font", async () => {
    const deck = await parsePptx(new Uint8Array(readFileSync(EON_PATH)));
    expect(deck.fonts && deck.fonts.length).toBeGreaterThan(0);
    for (const asset of deck.fonts ?? []) {
      const eot = b(asset.data);
      const fds = new DataView(eot.buffer, eot.byteOffset).getUint32(4, true);
      const payload = eot.subarray(eot.length - fds);
      const c = parseMtxContainer(payload);
      expect(c.version).toBe(3);
      const total = c.block1.length + c.block2.length + c.block3.length;
      expect(total).toBe(payload.length - 10);
      expect(c.block1.length).toBeGreaterThan(0);
    }
  });
});
