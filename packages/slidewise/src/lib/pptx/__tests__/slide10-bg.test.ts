import { describe, it, expect } from "vitest";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parsePptx } from "../index";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const attachmentsDir = path.resolve(
  __dirname,
  "../../../../../../.context/attachments"
);

async function fixtureExists(name: string): Promise<boolean> {
  try {
    await access(path.join(attachmentsDir, name));
    return true;
  } catch {
    return false;
  }
}

const has = await fixtureExists("eon-deck-v1.pptx");

describe("eon-deck slide 10 column 2 background", () => {
  it.skipIf(!has)("imports column 2 number placeholder with red bg + white text", async () => {
    const buf = await readFile(path.join(attachmentsDir, "eon-deck-v1.pptx"));
    const deck = await parsePptx(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    );
    const slide10 = deck.slides[9];
    const colTwo = slide10.elements.find(
      (e) => e.type === "text" && (e as { text: string }).text === "2"
    ) as { background?: string; color?: string; w: number; h: number } | undefined;
    expect(colTwo).toBeTruthy();
    expect(colTwo!.background?.toUpperCase()).toBe("#EA1B0A");
    expect(colTwo!.color?.toUpperCase()).toBe("#FFFFFF");
    expect(colTwo!.w).toBeGreaterThan(300);
    expect(colTwo!.h).toBeGreaterThan(700);
  });
});
