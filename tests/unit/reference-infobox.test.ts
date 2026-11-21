import { describe, expect, it } from "vitest";
import { buildReferenceInfobox } from "@/world/referenceInfobox";

const projectId = "prj_test";

describe("referenceInfobox", () => {
  it("omits pending facts and surfaces accepted facts and open questions", () => {
    const model = buildReferenceInfobox({
      projectId,
      record: {
        id: "rec_place",
        title: "Salt Quay",
        type: "worldbuilding",
        body: "## Open questions\nWho controls the tariffs?\n",
        fields: { kind: "place", climate: "Salt wind" },
      },
      bookOrderIds: ["chap_a", "scene_b"],
      crossRefs: {
        defined: [],
        files: [],
        ids: [],
        mentionedBy: [],
        names: [],
        namedIn: [{ recordId: "scene_b", title: "The quarrel", type: "manuscript_scene", count: 2 }],
        nameForms: [],
      },
      acceptedFacts: [
        {
          id: "f1",
          subjectRecordId: "rec_place",
          statement: "The quay is under curfew.",
          status: "accepted",
          evidenceKind: "author_rewrite",
          evidenceKindLabel: "Author manuscript",
          createdAt: new Date(),
          updatedAt: new Date(),
          evidence: [],
        },
        {
          id: "f2",
          subjectRecordId: "rec_place",
          statement: "Maybe haunted.",
          status: "pending",
          evidenceKind: "planned",
          evidenceKindLabel: "Planned",
          createdAt: new Date(),
          updatedAt: new Date(),
          evidence: [],
        },
      ],
      placeRelations: { outgoing: [], incoming: [] },
      recordRelations: { outgoing: [], incoming: [] },
      placements: [{ surface: "map", surfaceId: "map_1", surfaceTitle: "Harbor chart", itemId: "pin_1" }],
    });
    expect(model?.facts).toEqual(["The quay is under curfew."]);
    expect(model?.rows.some((row) => row.label === "Climate")).toBe(true);
    expect(model?.rows.some((row) => row.label === "First appearance")).toBe(true);
    expect(model?.openQuestions).toContain("tariffs");
    expect(model?.maps).toHaveLength(1);
  });
});