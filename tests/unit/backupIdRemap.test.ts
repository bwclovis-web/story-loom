import { describe, expect, it } from "vitest";
import { CHARACTER_DEVELOPMENT_KEY } from "@/domain/characterDevelopment";
import { WORLD_PROFILE_KEY } from "@/domain/worldProfile";
import { remapRecordFields, remapSmartCollectionFilterJson } from "@/server/services/backupIdRemap";

describe("backupIdRemap", () => {
  const map = new Map<string, string>([
    ["prj_old", "prj_new"],
    ["rec_old", "rec_new"],
    ["sev_old", "sev_new"],
    ["drf_old", "drf_new"],
    ["fct_old", "fct_new"],
  ]);

  it("remaps typed worldProfile and characterDevelopment references only", () => {
    const fields = remapRecordFields(
      {
        note: "rec_old lives in the quay prose",
        [WORLD_PROFILE_KEY]: {
          version: 1,
          values: {
            access: "rec_old",
            outlet: { recordId: "rec_old" },
            doorways: [{ line: "Door to rec_old", gloss: "the shop", recordId: "rec_old" }],
          },
          fieldHistory: [
            {
              id: "wfh_1",
              fieldPath: "values.access",
              bookProjectId: "prj_old",
              storyEventId: "sev_old",
              chapterRecordId: "rec_old",
              sceneRecordId: null,
              value: "open",
              note: "Mentioned rec_old in the archive note",
            },
          ],
          migrationHold: [
            {
              id: "hold_1",
              text: "Keep rec_old as literal archive text",
              sourceText: "rec_old source",
            },
          ],
          customExtension: { mysteryId: "rec_old" },
        },
        [CHARACTER_DEVELOPMENT_KEY]: {
          version: 1,
          capabilities: { linkedRecordIds: ["rec_old"], skills: "rec_old skill name" },
          knowledge: [{ id: "k1", bookProjectId: "prj_old", fromStoryEventId: "sev_old", establishedFactId: "fct_old", statement: "rec_old knew" }],
          bookVoices: [{ projectId: "prj_old", voice: { diction: "rec_old tone" } }],
          variantLinks: [{ foundationRecordId: "rec_old" }],
        },
      },
      map,
    );

    const profile = fields[WORLD_PROFILE_KEY] as Record<string, unknown>;
    const history = (profile.fieldHistory as Array<Record<string, unknown>>)[0]!;
    expect(history.bookProjectId).toBe("prj_new");
    expect(history.storyEventId).toBe("sev_new");
    expect(history.chapterRecordId).toBe("rec_new");
    expect(history.note).toBe("Mentioned rec_old in the archive note");
    expect((profile.values as Record<string, unknown>).access).toBe("rec_old");
    expect(((profile.values as Record<string, unknown>).outlet as { recordId: string }).recordId).toBe("rec_new");
    expect((profile.values as { doorways: Array<{ line: string; recordId: string }> }).doorways[0]).toEqual({
      line: "Door to rec_old",
      gloss: "the shop",
      recordId: "rec_new",
    });
    expect((profile.migrationHold as Array<Record<string, string>>)[0]!.text).toBe("Keep rec_old as literal archive text");
    expect((profile.customExtension as { mysteryId: string }).mysteryId).toBe("rec_old");
    expect(fields.note).toBe("rec_old lives in the quay prose");

    const char = fields[CHARACTER_DEVELOPMENT_KEY] as Record<string, unknown>;
    expect((char.capabilities as { linkedRecordIds: string[]; skills: string }).linkedRecordIds).toEqual(["rec_new"]);
    expect((char.capabilities as { skills: string }).skills).toBe("rec_old skill name");
    expect((char.knowledge as Array<Record<string, string>>)[0]!.bookProjectId).toBe("prj_new");
    expect((char.knowledge as Array<Record<string, string>>)[0]!.statement).toBe("rec_old knew");
    expect((char.bookVoices as Array<{ projectId: string }>)[0]!.projectId).toBe("prj_new");
    expect((char.variantLinks as Array<{ foundationRecordId: string }>)[0]!.foundationRecordId).toBe("rec_new");
  });

  it("remaps SmartCollection draftId and linkedRecordId without dropping extras", () => {
    const json = remapSmartCollectionFilterJson(
      JSON.stringify({
        linkedRecordId: "rec_old",
        draftId: "drf_old",
        query: "rec_old",
        category: "transport",
        futureFlag: true,
      }),
      map,
    );
    expect(JSON.parse(json)).toEqual({
      linkedRecordId: "rec_new",
      draftId: "drf_new",
      query: "rec_old",
      category: "transport",
      futureFlag: true,
    });
  });
});
