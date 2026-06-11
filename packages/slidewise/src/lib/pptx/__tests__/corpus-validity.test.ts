import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import JSZip from "jszip";
import { parsePptx, serializeDeck } from "../index";

/**
 * Whole-corpus structural-validity net. Drop any number of `.pptx` files into
 * the gitignored `.context/attachments/` dir (the same place the other fixture
 * tests read from) and this round-trips EVERY one through
 * `parsePptx → serializeDeck`, asserting the output is a structurally valid
 * OOXML package:
 *
 *   1. every internal relationship target resolves to a shipped part,
 *   2. every `[Content_Types]` Override points at a part that exists,
 *   3. every shipped part has a declared content type (Default by extension
 *      or an explicit Override),
 *   4. every `ppt/media/*.png` holds real PNG bytes (never SVG markup).
 *
 * These are exactly the four ways the reported bugs corrupted the artifact.
 * The whole suite skips when no decks are present, so CI stays green for
 * outside contributors while it scans the full corpus locally.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const attachmentsDir = path.resolve(
  __dirname,
  "../../../../../../.context/attachments"
);

async function findPptx(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await findPptx(full)));
    else if (/\.(pptx|potx)$/i.test(e.name)) out.push(full);
  }
  return out;
}

function normalise(target: string, base: string): string {
  if (target.startsWith("/")) return target.slice(1);
  let t = target;
  const segs = base.split("/").filter(Boolean);
  while (t.startsWith("../")) {
    segs.pop();
    t = t.slice(3);
  }
  return [...segs, t].filter(Boolean).join("/");
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

interface Problems {
  danglingRels: string[];
  danglingOverrides: string[];
  undeclaredParts: string[];
  invalidPngs: string[];
}

async function validate(buf: ArrayBuffer): Promise<Problems> {
  const zip = await JSZip.loadAsync(buf);
  const present = new Set<string>();
  const relsPaths: string[] = [];
  const mediaPngs: string[] = [];
  zip.forEach((p, e) => {
    if (e.dir) return;
    present.add(p);
    if (p.endsWith(".rels")) relsPaths.push(p);
    if (/^ppt\/media\/.+\.png$/i.test(p)) mediaPngs.push(p);
  });

  const problems: Problems = {
    danglingRels: [],
    danglingOverrides: [],
    undeclaredParts: [],
    invalidPngs: [],
  };

  // 1. Relationship targets.
  for (const relsPath of relsPaths) {
    const xml = await zip.file(relsPath)!.async("string");
    const ownerDir = relsPath.replace(/(^|\/)_rels\/[^/]+$/, "");
    const base = ownerDir === relsPath ? "" : ownerDir;
    const re = /<Relationship\b[^>]*?\/>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const tag = m[0];
      const mode = /\bTargetMode="([^"]+)"/.exec(tag)?.[1];
      const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
      const id = /\bId="([^"]+)"/.exec(tag)?.[1] ?? "?";
      if (!target || mode === "External" || /^https?:\/\//i.test(target)) continue;
      if (!present.has(normalise(target, base))) {
        problems.danglingRels.push(`${relsPath} ${id} → ${target}`);
      }
    }
  }

  // 2 + 3. Content types.
  const ct = await zip.file("[Content_Types].xml")?.async("string");
  if (ct) {
    const defaults = new Set<string>();
    const overrides = new Set<string>();
    let dm: RegExpExecArray | null;
    const defRe = /<Default\b[^>]*Extension="([^"]+)"[^>]*\/>/g;
    while ((dm = defRe.exec(ct))) defaults.add(dm[1].toLowerCase());
    const ovRe = /<Override\b[^>]*PartName="([^"]+)"[^>]*\/>/g;
    let om: RegExpExecArray | null;
    while ((om = ovRe.exec(ct))) {
      overrides.add(om[1]);
      if (!present.has(om[1].replace(/^\//, ""))) {
        problems.danglingOverrides.push(om[1]);
      }
    }
    for (const p of present) {
      if (p === "[Content_Types].xml" || p.endsWith(".rels")) continue;
      const ext = (p.split(".").pop() ?? "").toLowerCase();
      if (defaults.has(ext) || overrides.has("/" + p)) continue;
      problems.undeclaredParts.push(p);
    }
  }

  // 4. PNG media bytes.
  for (const p of mediaPngs) {
    const bytes = await zip.file(p)!.async("uint8array");
    const ok =
      bytes.length >= 4 && PNG_MAGIC.every((b, i) => bytes[i] === b);
    if (!ok) problems.invalidPngs.push(p);
  }

  return problems;
}

const decks = await findPptx(attachmentsDir);

describe.skipIf(decks.length === 0)("corpus structural validity", () => {
  it.each(decks)("serializes a valid package: %s", async (deckPath) => {
    const file = await readFile(deckPath);
    const source = file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength
    ) as ArrayBuffer;

    const deck = await parsePptx(source);
    const blob = await serializeDeck(deck, { source });
    const problems = await validate(await blob.arrayBuffer());

    const summary = [
      problems.danglingRels.length
        ? `dangling rels:\n  ${problems.danglingRels.join("\n  ")}`
        : "",
      problems.danglingOverrides.length
        ? `Content_Types overrides with no part:\n  ${problems.danglingOverrides.join("\n  ")}`
        : "",
      problems.undeclaredParts.length
        ? `parts with no content type:\n  ${problems.undeclaredParts.join("\n  ")}`
        : "",
      problems.invalidPngs.length
        ? `.png parts holding non-PNG bytes:\n  ${problems.invalidPngs.join("\n  ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    expect(summary, summary || undefined).toBe("");
  });
});
