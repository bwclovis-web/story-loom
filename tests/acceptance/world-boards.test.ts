import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import {
  addNoteCard,
  addRecordCard,
  createBoard,
  GEOGRAPHY_TEMPLATE_NOTES,
  getBoard,
  listBoards,
  moveBoardCard,
  removeBoardCard,
} from "@/server/services/boardService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("World boards", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("lets legacy projects open with no boards", async () => {
    expect(await listBoards(t.db, IDS.project)).toEqual([]);
  });

  it("creates blank and geography boards, moves cards, and removes only the card", async () => {
    const blank = await createBoard(t.db, IDS.project, { title: "Scratch", templateKey: "blank" });
    expect(blank.cards).toEqual([]);

    const geo = await createBoard(t.db, IDS.project, { title: "Salt coast", templateKey: "geography" });
    expect(geo.cards).toHaveLength(GEOGRAPHY_TEMPLATE_NOTES.length);
    expect(geo.cards.every((c) => c.kind === "note")).toBe(true);

    const placed = await addRecordCard(t.db, IDS.project, blank.id, {
      recordId: IDS.world,
      x: 120,
      y: 80,
    });
    expect(placed.recordId).toBe(IDS.world);
    expect(placed.kind).toBe("record");

    const again = await addRecordCard(t.db, IDS.project, geo.id, {
      recordId: IDS.world,
      x: 10,
      y: 10,
    });
    expect(again.recordId).toBe(IDS.world);

    const moved = await moveBoardCard(t.db, IDS.project, blank.id, placed.id, { x: 200, y: 150 });
    expect(moved.x).toBe(200);
    expect(moved.y).toBe(150);

    await removeBoardCard(t.db, IDS.project, blank.id, placed.id);
    const after = await getBoard(t.db, IDS.project, blank.id);
    expect(after.cards.find((c) => c.id === placed.id)).toBeUndefined();
    const world = await t.db.record.findUniqueOrThrow({ where: { id: IDS.world } });
    expect(world.title).toBe("The Salt Guild");
    const stillOnGeo = await getBoard(t.db, IDS.project, geo.id);
    expect(stillOnGeo.cards.some((c) => c.recordId === IDS.world)).toBe(true);
  });

  it("round-trips board positions, notes, and source links in backups", async () => {
    const board = await createBoard(t.db, IDS.project, { title: "Map", templateKey: "geography" });
    const note = await addNoteCard(t.db, IDS.project, board.id, {
      noteTitle: "Custom cove",
      noteBody: "Sheltered water east of the quay.",
      x: 90,
      y: 220,
    });
    await addRecordCard(t.db, IDS.project, board.id, { recordId: IDS.dossier, x: 400, y: 60 });
    await moveBoardCard(t.db, IDS.project, board.id, note.id, { x: 95, y: 225 });

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.boards?.length).toBe(1);
    expect(backup.boardCards?.length).toBeGreaterThanOrEqual(GEOGRAPHY_TEMPLATE_NOTES.length + 2);
    expect(backup.counts.boards).toBe(1);

    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const projectId = restored.projects[0]!.id;
      const boards = await listBoards(target.db, projectId);
      expect(boards).toHaveLength(1);
      const view = await getBoard(target.db, projectId, boards[0]!.id);
      expect(view.title).toBe("Map");
      const custom = view.cards.find((c) => c.noteTitle === "Custom cove");
      expect(custom?.x).toBe(95);
      expect(custom?.y).toBe(225);
      expect(custom?.noteBody).toContain("Sheltered water");
      expect(view.cards.some((c) => c.kind === "record" && c.recordTitle?.includes("Mara"))).toBe(true);
    } finally {
      await target.cleanup();
    }

    // Older backups omit boards → none after restore of empty project shape.
    await t.db.boardCard.deleteMany({});
    await t.db.board.deleteMany({});
    const empty = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(empty.boards ?? []).toEqual([]);
    const emptyTarget = await createTestDb();
    try {
      const outcome = await restoreWorkspaceBackup(emptyTarget.db, empty, { idStrategy: "remap" });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(await listBoards(emptyTarget.db, outcome.projects[0]!.id)).toEqual([]);
    } finally {
      await emptyTarget.cleanup();
    }
  });
});
