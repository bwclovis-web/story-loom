import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { addRecordCard, createBoard } from "@/server/services/boardService";
import { MutationRejectedError } from "@/server/services/errors";
import { addRecordImages } from "@/server/services/imageService";
import { loadReferenceInspector } from "@/server/services/referenceInspectorService";
import { applyReviewedTemplate } from "@/server/services/referenceTemplateService";
import { getRecord, setProtection, updateRecord } from "@/server/services/recordService";
import { addWorldMapPin, createWorldMap } from "@/server/services/worldMapService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";

describe("World outlines and reference inspector", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("reviews an outline onto a legacy record without rewriting fields, and refuses a protected update", async () => {
    const original = "Freeform harbour note. Mara keeps the salt ledgers.";
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: 1,
      body: original,
      fields: { tide: "neap", customNote: { keep: true } },
    });
    const dossierBefore = await getRecord(t.db, IDS.project, IDS.dossier);

    const applied = await applyReviewedTemplate(t.db, IDS.project, {
      recordId: IDS.world,
      templateKey: "place",
      expectedRevision: 2,
    });
    expect(applied.applied).toBe(true);
    expect(applied.revision).toBe(3);
    const saved = await getRecord(t.db, IDS.project, IDS.world);
    expect(saved.body.startsWith(original)).toBe(true);
    expect(saved.body).toContain("## Overview\n");
    expect(saved.body).toContain("## Geography\n");
    expect(saved.fields).toEqual({ tide: "neap", customNote: { keep: true } });
    expect(saved.title).toBe("The Salt Guild");
    expect((await getRecord(t.db, IDS.project, IDS.dossier)).body).toBe(dossierBefore.body);

    const again = await applyReviewedTemplate(t.db, IDS.project, {
      recordId: IDS.world,
      templateKey: "place",
      expectedRevision: 3,
    });
    expect(again.applied).toBe(false);
    expect((await getRecord(t.db, IDS.project, IDS.world)).currentRevision).toBe(3);

    await setProtection(t.db, IDS.project, IDS.world, true);
    const locked = applyReviewedTemplate(t.db, IDS.project, {
      recordId: IDS.world,
      templateKey: "religion",
      expectedRevision: 3,
    });
    await expect(locked).rejects.toBeInstanceOf(MutationRejectedError);
    await locked.catch((error: MutationRejectedError) => expect(error.issues.map((issue) => issue.code)).toContain("PROTECTED_RECORD"));
    expect((await getRecord(t.db, IDS.project, IDS.world)).body).toBe(saved.body);

    const unlocked = await applyReviewedTemplate(t.db, IDS.project, {
      recordId: IDS.world,
      templateKey: "religion",
      expectedRevision: 3,
      unlockProtected: true,
    });
    expect(unlocked.applied).toBe(true);
    const afterUnlock = await getRecord(t.db, IDS.project, IDS.world);
    expect(afterUnlock.body.startsWith(saved.body)).toBe(true);
    expect(afterUnlock.fields).toEqual(saved.fields);

    await expect(
      applyReviewedTemplate(t.db, IDS.project, {
        recordId: IDS.chapter,
        templateKey: "place",
        expectedRevision: 1,
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const projectId = restored.projects[0]!.id;
      const rows = await target.db.record.findMany({ where: { projectId, title: "The Salt Guild" } });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.body.startsWith(original)).toBe(true);
      expect(JSON.parse(rows[0]!.fields)).toEqual({ tide: "neap", customNote: { keep: true } });
    } finally {
      await target.cleanup();
    }
  });

  it("opens the same record from a board card and a map pin", async () => {
    const [image] = await addRecordImages(
      t.db,
      IDS.project,
      IDS.world,
      [{ filename: "guild-chart.png", bytes: makePng(32, 24) }],
      { confirmProtected: false },
    );
    const board = await createBoard(t.db, IDS.project, { title: "Guild wall", templateKey: "blank" });
    const card = await addRecordCard(t.db, IDS.project, board.id, { recordId: IDS.world, x: 12, y: 20 });
    const map = await createWorldMap(t.db, IDS.project, { title: "Guild chart", imageId: image.id });
    const pin = await addWorldMapPin(t.db, IDS.project, map.id, { recordId: IDS.world, xNorm: 0.4, yNorm: 0.6 });

    const loaded = await loadReferenceInspector(t.db, IDS.project, IDS.world);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.model.id).toBe(IDS.world);
    expect(loaded.model.title).toBe("The Salt Guild");
    expect(loaded.model.supportsEstablished).toBe(true);
    expect(loaded.established).not.toBeNull();
    expect(loaded.model.images.some((item) => item.name.startsWith("guild-chart"))).toBe(true);
    expect(loaded.model.placements).toEqual(
      expect.arrayContaining([
        { surface: "board", surfaceId: board.id, surfaceTitle: "Guild wall", itemId: card.id },
        { surface: "map", surfaceId: map.id, surfaceTitle: "Guild chart", itemId: pin.id },
      ]),
    );
  });
});
