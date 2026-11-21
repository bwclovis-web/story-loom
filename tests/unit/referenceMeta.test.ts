import { describe, expect, it } from "vitest";
import { readReferenceMeta, withReferenceMeta } from "@/world/referenceMeta";
import { parseKindTemplateFields } from "@/world/kindTemplates";

describe("reference meta", () => {
  it("sets name, aliases, and role without dropping other keys", () => {
    const next = withReferenceMeta({ age: "43", note: { keep: true } }, { name: " Mara ", aliases: [" Mar ", "Mar", ""], role: " keeper " });
    expect(next).toEqual({ age: "43", note: { keep: true }, name: "Mara", aliases: ["Mar"], role: "keeper" });
    expect(readReferenceMeta(next).aliases).toEqual(["Mar"]);
  });

  it("clears a key when the value is blank", () => {
    const next = withReferenceMeta({ name: "Mara", summary: "old", aliases: ["Mar"] }, { name: " ", summary: "", aliases: [] });
    expect(next).toEqual({});
  });
});

describe("kind template fields", () => {
  it("keeps valid keys and drops reserved or duplicate ones", () => {
    expect(
      parseKindTemplateFields([
        { key: "riverToll", label: "River toll" },
        { key: "kind", label: "Kind" },
        { key: "River", label: "Bad" },
        { key: "riverToll", label: "Again" },
        { key: "terms", label: "Terms", multiline: true },
      ]),
    ).toEqual([
      { key: "riverToll", label: "River toll", multiline: false },
      { key: "terms", label: "Terms", multiline: true },
    ]);
  });
});
