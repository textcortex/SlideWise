import { describe, it, expect } from "vitest";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import JSZip from "jszip";
import { parsePptx, serializeDeck } from "../index";
import type { TextElement } from "@/lib/types";

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

const hasEon = await fixtureExists("eon-deck-v1.pptx");

describe("patch-mode saves preserve theme refs on text edits", () => {
  it.skipIf(!hasEon)(
    "edits text content without losing themed colors / fonts on slide 10 column 2",
    async () => {
      const buf = await readFile(path.join(attachmentsDir, "eon-deck-v1.pptx"));
      const source = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength
      ) as ArrayBuffer;
      const deck = await parsePptx(source);

      // Slide 10 col 2 number "2" — bg = accent1 (red), text color =
      // schemeClr bg1 (white). The bg is on the slide-level <p:spPr>
      // override, the text colour is in <a:rPr><a:solidFill><a:schemeClr>.
      const slide10 = deck.slides[9];
      const colTwo = slide10.elements.find(
        (e) => e.type === "text" && (e as TextElement).text === "2"
      ) as TextElement | undefined;
      expect(colTwo).toBeTruthy();

      // Edit the text without touching any styling fields.
      colTwo!.text = "II";

      const blob = await serializeDeck(deck, { source });
      const out = await JSZip.loadAsync(await blob.arrayBuffer());
      const slide10Xml = await out
        .file("ppt/slides/slide10.xml")!
        .async("string");

      // Edited text must be present.
      expect(slide10Xml).toContain("<a:t>II</a:t>");

      // The slide-level fill override (schemeClr accent1 → the red bg) must
      // survive the patch path — pptxgenjs would have collapsed this to an
      // inline srgbClr (or dropped it entirely on a placeholder shape).
      expect(slide10Xml).toMatch(
        /<p:spPr>[\s\S]*?<a:solidFill>[\s\S]*?<a:schemeClr val="accent1"\/>[\s\S]*?<\/a:solidFill>[\s\S]*?<\/p:spPr>/
      );

      // The themed text colour <a:rPr>…<a:schemeClr val="bg1"/> must
      // survive — losing it would have rendered the "II" as the default
      // body color (dark) instead of white-on-red.
      expect(slide10Xml).toMatch(
        /<a:rPr[\s\S]*?<a:solidFill>[\s\S]*?<a:schemeClr val="bg1"\/>[\s\S]*?<\/a:solidFill>[\s\S]*?<\/a:rPr>/
      );
    }
  );

  it.skipIf(!hasEon)(
    "moves an element via geometry-only patch, keeping fill / themed color verbatim",
    async () => {
      const buf = await readFile(path.join(attachmentsDir, "eon-deck-v1.pptx"));
      const source = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength
      ) as ArrayBuffer;
      const deck = await parsePptx(source);

      const slide10 = deck.slides[9];
      const colTwo = slide10.elements.find(
        (e) => e.type === "text" && (e as TextElement).text === "2"
      ) as TextElement | undefined;
      expect(colTwo).toBeTruthy();
      const originalX = colTwo!.x;
      colTwo!.x = originalX + 100; // user dragged it right 100 px

      const blob = await serializeDeck(deck, { source });
      const out = await JSZip.loadAsync(await blob.arrayBuffer());
      const slide10Xml = await out
        .file("ppt/slides/slide10.xml")!
        .async("string");

      // The themed fill + text color must remain intact after the move.
      expect(slide10Xml).toMatch(
        /<p:spPr>[\s\S]*?<a:solidFill>[\s\S]*?<a:schemeClr val="accent1"\/>/
      );
      expect(slide10Xml).toMatch(
        /<a:rPr[\s\S]*?<a:schemeClr val="bg1"\/>/
      );
      // The xfrm must reflect the new x.
      const newOffX = Math.round((originalX + 100) * (914400 / 144));
      expect(slide10Xml).toContain(`<a:off x="${newOffX}"`);
    }
  );
});
