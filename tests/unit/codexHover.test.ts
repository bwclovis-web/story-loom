import { describe, expect, it } from "vitest";
import {
  buildCodexIndex,
  findCodexHitInLine,
  termsFor,
} from "@/components/writing/MarkdownEditor/codexHover";

const entries = [
  { id: "rec_seren", title: "Seren — Character Dossier", aliases: ["Ren"] },
  { id: "rec_mara", title: "Mara Venn", aliases: [] },
  { id: "rec_guild", title: "The Salt Guild", aliases: ["Salt Guild"] },
];

describe("codex hover matching", () => {
  it("indexes bare names from Title — Kind headings and aliases", () => {
    const terms = termsFor(entries[0]!).map((t) => t.toLocaleLowerCase());
    expect(terms).toEqual(expect.arrayContaining(["seren — character dossier", "seren", "ren"]));
  });

  it("matches a bare character name in prose", () => {
    const index = buildCodexIndex(entries);
    const line = "Seren closed the door.";
    const hit = findCodexHitInLine(line, line.indexOf("Seren") + 2, index);
    expect(hit?.entry.id).toBe("rec_seren");
    expect(line.slice(hit!.from, hit!.to)).toBe("Seren");
  });

  it("matches multi-word names and first/last parts", () => {
    const index = buildCodexIndex(entries);
    const full = "Mara Venn arrived.";
    expect(findCodexHitInLine(full, full.indexOf("Venn"), index)?.entry.id).toBe("rec_mara");
    const first = "Then Mara left.";
    expect(findCodexHitInLine(first, first.indexOf("Mara") + 1, index)?.entry.id).toBe("rec_mara");
  });

  it("matches [[wiki]] link text against bare names", () => {
    const index = buildCodexIndex(entries);
    const line = "See [[Seren]] tomorrow.";
    const at = line.indexOf("Seren");
    const hit = findCodexHitInLine(line, at, index);
    expect(hit?.entry.id).toBe("rec_seren");
    expect(line.slice(hit!.from, hit!.to)).toBe("[[Seren]]");
  });

  it("ignores partial word collisions", () => {
    const index = buildCodexIndex(entries);
    const line = "Serenity was calm.";
    expect(findCodexHitInLine(line, line.indexOf("Seren") + 1, index)).toBeNull();
  });
});
