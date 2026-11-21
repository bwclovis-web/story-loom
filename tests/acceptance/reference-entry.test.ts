import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MutationRejectedError } from "@/server/services/errors";
import { createRecord, getRecord, updateRecord } from "@/server/services/recordService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("reference entry types", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("creates the four reference types and keeps body, status, and extra fields when kind changes", async () => {
    const created = await Promise.all(
      (
        [
          ["rec_ref_character", "character_dossier", "Mara"],
          ["rec_ref_world", "worldbuilding", "Salt Reach"],
          ["rec_ref_rules", "rules_glossary", "Tide law"],
          ["rec_ref_research", "research_note", "Harbour notes"],
        ] as const
      ).map(([recordId, type, title]) =>
        createRecord(t.db, IDS.project, {
          recordId,
          type,
          title,
          body: type === "worldbuilding" ? "Opening line." : "",
          fields: type === "worldbuilding" ? { kind: "place", climate: "wet", aliases: ["Reach"] } : {},
          authorityStatus: "draft",
        }),
      ),
    );
    expect(created).toHaveLength(4);

    const before = await getRecord(t.db, IDS.project, "rec_ref_world");
    await updateRecord(t.db, IDS.project, {
      recordId: "rec_ref_world",
      expectedRevision: before.currentRevision,
      fields: { kind: "religion", focus: "tide", climate: "wet", aliases: ["Reach"] },
    });
    const after = await getRecord(t.db, IDS.project, "rec_ref_world");
    expect(after.body).toBe("Opening line.");
    expect(after.authorityStatus).toBe("draft");
    expect(after.fields.kind).toBe("religion");
    expect(after.fields.climate).toBe("wet");
    expect(after.fields.aliases).toEqual(["Reach"]);
  });

  it("rejects an unacknowledged edit of a protected reference and keeps the saved text", async () => {
    await createRecord(t.db, IDS.project, {
      recordId: "rec_ref_locked",
      type: "research_note",
      title: "Locked note",
      body: "Do not replace this.",
      authorityStatus: "draft",
    });
    await updateRecord(t.db, IDS.project, {
      recordId: "rec_ref_locked",
      expectedRevision: 1,
      fields: { locked: true },
    });
    const current = await getRecord(t.db, IDS.project, "rec_ref_locked");
    await t.db.record.update({ where: { id: current.id }, data: { protected: true } });
    await expect(
      updateRecord(t.db, IDS.project, {
        recordId: "rec_ref_locked",
        expectedRevision: current.currentRevision,
        body: "Replaced without acknowledgement.",
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    const kept = await getRecord(t.db, IDS.project, "rec_ref_locked");
    expect(kept.body).toBe("Do not replace this.");
  });
});
