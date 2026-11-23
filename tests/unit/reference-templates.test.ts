import { describe, expect, it } from "vitest";
import {
  REFERENCE_TEMPLATES,
  referenceTemplate,
  reviewTemplateMapping,
  scaffoldBody,
} from "@/world/referenceTemplates";

const place = referenceTemplate("place");

describe("World original outlines", () => {
  it("offers Character plus the eight worldbuilding outlines and no others", () => {
    expect(REFERENCE_TEMPLATES.map((template) => template.label)).toEqual([
      "Character",
      "Place",
      "Religion",
      "Culture",
      "Organization",
      "Species",
      "Magic system",
      "Object",
      "Language",
    ]);
  });

  it("keeps freeform text, unknown headings, and status tags, and only appends missing headings", () => {
    const body = "Harbour note, left as written.\n\n## Geography [APPROVED FRAMEWORK]\n\nWhite salt.\n\n## Customs of the quay\n\nBells at dusk.\n";
    const mapping = reviewTemplateMapping(place, body, ["tide", "customNote"]);
    expect(mapping.proposedBody.startsWith(body)).toBe(true);
    expect(mapping.proposedBody).toContain("## Geography [APPROVED FRAMEWORK]");
    expect(mapping.proposedBody).toContain("## Customs of the quay");
    expect(mapping.matched.map((item) => item.heading)).toEqual(["Geography [APPROVED FRAMEWORK]"]);
    expect(mapping.keptHeadings).toEqual(["Customs of the quay"]);
    expect(mapping.freeformKept).toBe(true);
    expect(mapping.missing).toContain("Overview");
    expect(mapping.missing).not.toContain("Geography");
    expect(mapping.fieldKeys).toEqual(["tide", "customNote"]);
    expect(mapping.changesBody).toBe(true);
    const again = reviewTemplateMapping(place, mapping.proposedBody, mapping.fieldKeys);
    expect(again.changesBody).toBe(false);
    expect(again.proposedBody).toBe(mapping.proposedBody);
  });

  it("does not treat a near heading as a match", () => {
    const mapping = reviewTemplateMapping(place, "## Over view\n\nStill free.\n", []);
    expect(mapping.keptHeadings).toEqual(["Over view"]);
    expect(mapping.missing).toContain("Overview");
  });

  it("seeds an empty document with headings only", () => {
    const mapping = reviewTemplateMapping(referenceTemplate("language"), "", ["script"]);
    expect(mapping.proposedBody).toBe(scaffoldBody(referenceTemplate("language")));
    expect(mapping.fieldKeys).toEqual(["script"]);
    expect(mapping.freeformKept).toBe(false);
  });
});
