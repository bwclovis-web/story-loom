import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRecord, updateRecord } from "@/server/services/recordService";
import { applyRecordRename, previewRecordRename } from "@/server/services/recordRenameService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("record rename", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });

  afterAll(async () => {
    await t.cleanup();
  });

  it("renames dossier and manuscript matches in one batch", async () => {
    const dossier = await getRecord(t.db, IDS.project, IDS.dossier);
    const preview = await previewRecordRename(t.db, {
      projectId: IDS.project,
      recordId: IDS.dossier,
      newTitle: "Elin Voss",
      newName: "Elin Voss",
      newAliases: ["Elin"],
      hasDrafts: false,
    });
    expect(preview.titleChanges || preview.fieldsChange).toBe(true);
    const ids = preview.matches.filter((m) => !m.ambiguous).map((m) => m.id);
    expect(ids.length).toBeGreaterThan(0);

    const recordRevisions = Object.fromEntries(
      [...new Set(preview.matches.map((m) => m.recordId))].map((id) => [
        id,
        preview.matches.find((m) => m.recordId === id)!.expectedRevision,
      ]),
    );

    await applyRecordRename(t.db, {
      projectId: IDS.project,
      recordId: IDS.dossier,
      newTitle: "Elin Voss",
      newName: "Elin Voss",
      newAliases: ["Elin"],
      selectedMatchIds: ids,
      recordRevision: dossier.currentRevision,
      recordRevisions,
      unlockProtected: true,
      hasDrafts: false,
    });

    const updated = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(updated.title).toBe("Elin Voss");
    const chapter = await getRecord(t.db, IDS.project, IDS.chapter);
    expect(chapter.body).toContain("Elin Voss");
    expect(chapter.body).not.toContain("Mara Venn");
  });
});