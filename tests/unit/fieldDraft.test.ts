import { describe, expect, it } from "vitest";
import { fieldDraftText, otherSavedEntries, parseFieldDraft } from "@/world/fieldDraft";
import { applyWorldKindToFields } from "@/world/worldKinds";
import { reviewTemplateMapping, referenceTemplate } from "@/world/referenceTemplates";

describe("reference field draft", () => {
  it("keeps invalid JSON as an error and does not invent an empty object", () => {
    const draft = parseFieldDraft("{");
    expect(draft.ok).toBe(false);
    if (!draft.ok) expect(draft.error.length).toBeGreaterThan(0);
  });

  it("keeps unknown keys, nested values, and non-strings when a kind field changes", () => {
    const before = {
      kind: "place",
      climate: "wet",
      aliases: ["Harbour"],
      nested: { a: 1 },
      count: 2,
      parentPlace: "Coast",
    };
    const next = applyWorldKindToFields(before, "religion", { focus: "tide" });
    expect(next.kind).toBe("religion");
    expect(next.focus).toBe("tide");
    expect(next.climate).toBe("wet");
    expect(next.aliases).toEqual(["Harbour"]);
    expect(next.nested).toEqual({ a: 1 });
    expect(next.count).toBe(2);
    expect(next.parentPlace).toBe("Coast");
    expect(otherSavedEntries(next).map((entry) => entry.key)).toEqual(["climate", "aliases", "nested", "count", "parentPlace"]);
    const text = fieldDraftText(next);
    const again = parseFieldDraft(text);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.nested).toEqual({ a: 1 });
  });

  it("previews missing headings without changing the current body", () => {
    const body = "Opening line.\n\n## Overview\n\nAlready written.\n";
    const mapping = reviewTemplateMapping(referenceTemplate("place"), body, ["climate"]);
    expect(body.startsWith("Opening line.")).toBe(true);
    expect(mapping.matched.map((row) => row.heading)).toEqual(["Overview"]);
    expect(mapping.missing).toContain("Geography");
    expect(mapping.proposedBody.startsWith(body.trimEnd()) || mapping.proposedBody.startsWith(body)).toBe(true);
    expect(mapping.fieldKeys).toEqual(["climate"]);
    const again = reviewTemplateMapping(referenceTemplate("place"), mapping.proposedBody, []);
    expect(again.missing).toEqual([]);
  });
});
