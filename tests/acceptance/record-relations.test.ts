import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { addRecordCard, createBoard, moveBoardCard } from "@/server/services/boardService";
import { MutationRejectedError } from "@/server/services/errors";
import {
  addRecordRelation,
  listRecordRelationsForRecord,
  removeRecordRelation,
} from "@/server/services/recordRelationService";
import { addWorldMapPin, createWorldMap } from "@/server/services/worldMapService";
import { addRecordImages } from "@/server/services/imageService";
import { createRecord, getRecord, updateRecord } from "@/server/services/recordService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";

const ORG = "rec_test_harbor_guild";
const PLACE = "rec_test_salt_quay";

describe("record relationships", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    const guild = await getRecord(t.db, IDS.project, IDS.world);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: guild.currentRevision,
      fields: { ...guild.fields, kind: "organization" },
    });
    await createRecord(t.db, IDS.project, {
      recordId: ORG,
      type: "worldbuilding",
      title: "Harbor Syndicate",
      body: "A rival archive.",
      fields: { kind: "organization", name: "Harbor Syndicate" },
      authorityStatus: "approved",
    });
    await createRecord(t.db, IDS.project, {
      recordId: PLACE,
      type: "worldbuilding",
      title: "Salt Quay",
      body: "Warehouses at the docks.",
      fields: { kind: "place", name: "Salt Quay" },
      authorityStatus: "approved",
    });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("lists nothing before any relation is added", async () => {
    expect(await listRecordRelationsForRecord(t.db, IDS.project, IDS.dossier)).toEqual({
      outgoing: [],
      incoming: [],
    });
  });

  it("stores relations independently of board and map moves", async () => {
    const member = await addRecordRelation(t.db, IDS.project, {
      fromRecordId: IDS.dossier,
      toRecordId: IDS.world,
      kind: "member_of",
    });
    expect(member.kindLabel).toBe("Member of");

    const [img] = await addRecordImages(
      t.db,
      IDS.project,
      PLACE,
      [{ filename: "quay.png", bytes: makePng(16, 16) }],
      { confirmProtected: false },
    );
    const map = await createWorldMap(t.db, IDS.project, { title: "Harbor chart", imageId: img.id });
    await addWorldMapPin(t.db, IDS.project, map.id, { recordId: IDS.dossier, xNorm: 0.3, yNorm: 0.3 });
    const board = await createBoard(t.db, IDS.project, { title: "Cast", templateKey: "blank" });
    const card = await addRecordCard(t.db, IDS.project, board.id, { recordId: IDS.dossier, x: 0, y: 0 });

    const before = await t.db.recordRelation.count({ where: { projectId: IDS.project } });
    await moveBoardCard(t.db, IDS.project, board.id, card.id, { x: 120, y: 80 });
    expect(await t.db.recordRelation.count({ where: { projectId: IDS.project } })).toBe(before);

    await removeRecordRelation(t.db, IDS.project, member.id);
    expect((await listRecordRelationsForRecord(t.db, IDS.project, IDS.dossier)).outgoing).toHaveLength(0);
  });

  it("rejects self-relations, duplicate triples, and invalid endpoints", async () => {
    await expect(
      addRecordRelation(t.db, IDS.project, {
        fromRecordId: IDS.dossier,
        toRecordId: IDS.dossier,
        kind: "sibling_of",
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    await addRecordRelation(t.db, IDS.project, {
      fromRecordId: IDS.dossier,
      toRecordId: ORG,
      kind: "rival_of",
    });
    await expect(
      addRecordRelation(t.db, IDS.project, {
        fromRecordId: IDS.dossier,
        toRecordId: ORG,
        kind: "rival_of",
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    await expect(
      addRecordRelation(t.db, IDS.project, {
        fromRecordId: IDS.outline,
        toRecordId: IDS.dossier,
        kind: "parent_of",
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
  });

  it("accepts custom labels and round-trips in backup", async () => {
    await addRecordRelation(t.db, IDS.project, {
      fromRecordId: IDS.dossier,
      toRecordId: PLACE,
      kind: "custom",
      customLabel: "Runs errands for",
    });
    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.recordRelations?.length).toBe(1);
    expect(backup.recordRelations?.[0]?.customLabel).toBe("Runs errands for");

    const target = await createTestDb();
    try {
      const outcome = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "preserve" });
      expect(outcome.ok, outcome.ok ? "" : outcome.issues.map((i) => i.message).join("; ")).toBe(true);
      const listed = await listRecordRelationsForRecord(target.db, IDS.project, IDS.dossier);
      expect(listed.outgoing[0]?.kindLabel).toBe("Runs errands for");
    } finally {
      await target.cleanup();
    }
  });
});