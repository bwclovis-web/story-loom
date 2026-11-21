import { describe, expect, it } from "vitest";
import { codexTrigger, insertCodexTitle, matchCodex } from "@/writing/codexSuggest";

const entries = [
  { id: "rec_mara", title: "Mara Venn", aliases: ["Mara"] },
  { id: "rec_guild", title: "The Salt Guild", aliases: [] },
];

describe("inline reference suggestions", () => {
  it("reads an unfinished [[ or @ at the cursor", () => {
    const wiki = "She met [[Ma";
    expect(codexTrigger(wiki, wiki.length)).toMatchObject({ query: "Ma", kind: "wiki", start: "She met ".length });
    const at = "Ask @Mar";
    expect(codexTrigger(at, at.length)).toMatchObject({ query: "Mar", kind: "at", start: "Ask ".length });
    expect(codexTrigger("mail a@b", "mail a@b".length)).toBeNull();
    const done = "Done [[Mara]] then";
    expect(codexTrigger(done, done.length)).toBeNull();
  });

  it("matches titles and aliases, then inserts the title as plain text", () => {
    expect(matchCodex(entries, "mara").map((entry) => entry.id)).toEqual(["rec_mara"]);
    const partial = "See [[sa";
    const trigger = codexTrigger(partial, partial.length);
    expect(trigger).not.toBeNull();
    expect(insertCodexTitle(partial, trigger!, "The Salt Guild")).toEqual({
      text: "See The Salt Guild",
      cursor: "See The Salt Guild".length,
    });
  });
});
