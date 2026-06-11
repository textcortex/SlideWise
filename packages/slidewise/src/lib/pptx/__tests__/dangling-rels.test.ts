import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { reconcileDanglingRels } from "../deckToPptx";

/**
 * Bug: the chrome-preserve path can leave `.rels` pointing at parts that never
 * ship. `reconcileDanglingRels` is the final invariant guard — every internal
 * relationship target must resolve to a part in the package. Two shapes:
 *
 *  1a. A `tags` rel re-pointed to a `slidewise_preserved_N_` name whose part
 *      was clobbered by chrome preservation and re-copied under its ORIGINAL
 *      name → repair by de-prefixing.
 *  1b. A `notesMaster` rel whose part was removed with no source replacement
 *      and isn't referenced by the owner body → drop the relationship.
 */

const RELS_NS =
  'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

function rels(...lines: string[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships ${RELS_NS}>${lines.join("")}</Relationships>`
  );
}

function rel(id: string, type: string, target: string, mode?: string): string {
  const m = mode ? ` TargetMode="${mode}"` : "";
  return `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${m}/>`;
}

async function parse(zip: JSZip, path: string): Promise<string> {
  return zip.file(path)!.async("string");
}

describe("reconcileDanglingRels", () => {
  it("repairs a slidewise_preserved_ tag target to its de-prefixed original part", async () => {
    const zip = new JSZip();
    // The verbatim-copied tag part exists under its ORIGINAL name only.
    zip.file("ppt/tags/tag104.xml", "<p:tagLst/>");
    // The slide body references rId3 (so the rel must NOT be dropped).
    zip.file(
      "ppt/slides/slide1.xml",
      '<p:sld><p:cSld><p:spTree/></p:cSld><p:custDataLst><p:tags r:id="rId3"/></p:custDataLst></p:sld>'
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      rels(
        rel("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"),
        rel("rId3", "tags", "../tags/slidewise_preserved_0_tag104.xml")
      )
    );
    // The referenced layout exists so it stays untouched.
    zip.file("ppt/slideLayouts/slideLayout1.xml", "<p:sldLayout/>");

    await reconcileDanglingRels(zip);

    const out = await parse(zip, "ppt/slides/_rels/slide1.xml.rels");
    // rId3 now resolves to the real, de-prefixed part.
    expect(out).toContain('Target="../tags/tag104.xml"');
    expect(out).not.toContain("slidewise_preserved_0_tag104.xml");
    // The healthy layout rel is preserved.
    expect(out).toContain('Id="rId1"');
    expect(out).toContain("slideLayout1.xml");
  });

  it("drops a notesMaster rel that has no part and isn't body-referenced", async () => {
    const zip = new JSZip();
    // notesSlide body never references rId1 (notesMaster is an implicit rel).
    zip.file("ppt/notesSlides/notesSlide1.xml", "<p:notes><p:cSld/></p:notes>");
    zip.file(
      "ppt/notesSlides/_rels/notesSlide1.xml.rels",
      rels(
        rel("rId1", "notesMaster", "../notesMasters/notesMaster1.xml"),
        rel("rId2", "slide", "../slides/slide1.xml")
      )
    );
    zip.file("ppt/slides/slide1.xml", "<p:sld/>");

    await reconcileDanglingRels(zip);

    const out = await parse(zip, "ppt/notesSlides/_rels/notesSlide1.xml.rels");
    // The dangling notesMaster rel is gone.
    expect(out).not.toContain("notesMaster1.xml");
    expect(out).not.toContain('Id="rId1"');
    // The valid back-reference to the slide survives.
    expect(out).toContain('Id="rId2"');
    expect(out).toContain("../slides/slide1.xml");
  });

  it("leaves External and resolvable rels untouched", async () => {
    const zip = new JSZip();
    zip.file("ppt/media/image1.png", "x");
    zip.file("ppt/slides/slide1.xml", "<p:sld/>");
    const original = rels(
      rel("rId1", "image", "../media/image1.png"),
      rel("rId2", "hyperlink", "https://example.com", "External")
    );
    zip.file("ppt/slides/_rels/slide1.xml.rels", original);

    await reconcileDanglingRels(zip);

    const out = await parse(zip, "ppt/slides/_rels/slide1.xml.rels");
    expect(out).toContain("../media/image1.png");
    expect(out).toContain("https://example.com");
  });

  it("keeps a dangling critical rel (slideLayout) rather than dropping it", async () => {
    // Dropping a slide's only layout rel would make it just as invalid as a
    // dangling one — so a missing, non-droppable type is kept (and warned).
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", "<p:sld><p:cSld><p:spTree/></p:cSld></p:sld>");
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      rels(rel("rId1", "slideLayout", "../slideLayouts/slideLayout7.xml"))
    );

    await reconcileDanglingRels(zip);

    const out = await parse(zip, "ppt/slides/_rels/slide1.xml.rels");
    expect(out).toContain('Id="rId1"');
    expect(out).toContain("slideLayout7.xml");
  });

  it("keeps a genuinely-dangling rel when the body references its rId", async () => {
    // No way to drop safely without corrupting the body — leave it as-is.
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      '<p:sld><p:pic><p:blipFill><a:blip r:embed="rId5"/></p:blipFill></p:pic></p:sld>'
    );
    zip.file(
      "ppt/slides/_rels/slide1.xml.rels",
      rels(rel("rId5", "image", "../media/missing.png"))
    );

    await reconcileDanglingRels(zip);

    const out = await parse(zip, "ppt/slides/_rels/slide1.xml.rels");
    expect(out).toContain('Id="rId5"');
  });
});
