import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { createProject } from "@/server/services/projectService";
import { createRecord } from "@/server/services/recordService";
import {
  addWeaveBeat,
  addWeaveBeatWorldRef,
  addWeaveSetupPayoff,
  applyWeaveTemplate,
  createWeaveGrid,
  createWeaveTemplate,
  getWeaveGrid,
  listWeaveGrids,
  moveWeaveBeat,
  saveWeaveGridAsTemplate,
  updateWeaveBeat,
  upsertWeaveTemplateBeat,
} from "@/server/services/weaveService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("Plan Weave", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("lets legacy projects open with no Weave grids", async () => {
    expect(await listWeaveGrids(t.db, IDS.project)).toEqual([]);
  });

  it("creates the three views, links beats, and never reorders manuscript on move", async () => {
    const chapterPos = (
      await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter }, select: { position: true, parentRecordId: true } })
    );

    const original = await createWeaveGrid(t.db, IDS.project, {
      title: "Outline grid",
      viewKind: "original",
    });
    const zero = await createWeaveGrid(t.db, IDS.project, {
      title: "Zero map",
      viewKind: "zero_draft_map",
    });
    const rewrite = await createWeaveGrid(t.db, IDS.project, {
      title: "Rewrite plan",
      viewKind: "author_rewrite",
    });
    expect((await listWeaveGrids(t.db, IDS.project)).map((g) => g.viewKind).sort()).toEqual([
      "author_rewrite",
      "original",
      "zero_draft_map",
    ]);

    const beat = await addWeaveBeat(t.db, IDS.project, original.id, {
      title: "Harbour arrival",
      x: 40,
      y: 60,
      manuscriptRecordId: IDS.chapter,
      decision: "keep",
    });
    expect(beat.manuscriptRecordId).toBe(IDS.chapter);
    expect(beat.decision).toBe("keep");

    await addWeaveBeatWorldRef(t.db, IDS.project, original.id, beat.id, IDS.world);
    await updateWeaveBeat(t.db, IDS.project, original.id, beat.id, { decision: "rebuild" });

    const beforeMove = await t.db.record.findUniqueOrThrow({
      where: { id: IDS.chapter },
      select: { position: true, parentRecordId: true },
    });
    await moveWeaveBeat(t.db, IDS.project, original.id, beat.id, { x: 200, y: 180 });
    const afterMove = await t.db.record.findUniqueOrThrow({
      where: { id: IDS.chapter },
      select: { position: true, parentRecordId: true },
    });
    expect(afterMove.position).toBe(beforeMove.position);
    expect(afterMove.parentRecordId).toBe(beforeMove.parentRecordId);
    expect(afterMove.position).toBe(chapterPos.position);

    const zeroBeat = await addWeaveBeat(t.db, IDS.project, zero.id, {
      title: "Same harbour later",
      x: 10,
      y: 10,
      manuscriptRecordId: IDS.chapter,
    });
    await addWeaveBeat(t.db, IDS.project, rewrite.id, { title: "Rewrite beat", x: 20, y: 20 });

    await addWeaveSetupPayoff(t.db, IDS.project, {
      fromBeatId: beat.id,
      toBeatId: zeroBeat.id,
      note: "Plant the quay; pay it off in the map.",
    });
    const view = await getWeaveGrid(t.db, IDS.project, original.id);
    expect(view.setupPayoffs).toHaveLength(1);
    expect(view.beats[0]!.worldRefs.some((r) => r.recordId === IDS.world)).toBe(true);
  });

  it("links setup in an earlier book to payoff in a later book in the same workspace", async () => {
    await createProject(t.db, {
      id: "prj_test_book2",
      workspaceId: IDS.workspace,
      title: "Book Two",
    });
    await t.db.project.update({
      where: { id: IDS.project },
      data: { seriesName: "Salt Annals", bookName: "Book One" },
    });
    await t.db.project.update({
      where: { id: "prj_test_book2" },
      data: { seriesName: "Salt Annals", bookName: "Book Two" },
    });

    const early = await createWeaveGrid(t.db, IDS.project, { title: "Book 1 plan", viewKind: "original" });
    const late = await createWeaveGrid(t.db, "prj_test_book2", { title: "Book 2 plan", viewKind: "original" });
    const setup = await addWeaveBeat(t.db, IDS.project, early.id, { title: "Hidden key", x: 0, y: 0 });
    const payoff = await addWeaveBeat(t.db, "prj_test_book2", late.id, { title: "Door opens", x: 0, y: 0 });

    const link = await addWeaveSetupPayoff(t.db, "prj_test_book2", {
      fromBeatId: setup.id,
      toBeatId: payoff.id,
      note: "Work backward from the reveal",
    });
    expect(link.fromProjectId).toBe(IDS.project);
    expect(link.toProjectId).toBe("prj_test_book2");
  });

  it("applies an editable template as an independent plan copy", async () => {
    const grid = await createWeaveGrid(t.db, IDS.project, { title: "Stable grid", viewKind: "original" });
    await addWeaveBeat(t.db, IDS.project, grid.id, { title: "Inciting", x: 10, y: 10, decision: "keep" });
    await addWeaveBeat(t.db, IDS.project, grid.id, { title: "Midpoint", x: 200, y: 40, decision: "move" });

    const template = await saveWeaveGridAsTemplate(t.db, IDS.project, grid.id, {
      title: "Three-act skeleton",
    });
    expect(template.beats).toHaveLength(2);

    await upsertWeaveTemplateBeat(t.db, IDS.project, template.id, {
      title: "Climax",
      x: 400,
      y: 80,
      decision: "rebuild",
    });

    const copy = await applyWeaveTemplate(t.db, IDS.project, template.id, {
      title: "Rewrite from skeleton",
      viewKind: "author_rewrite",
    });
    expect(copy.viewKind).toBe("author_rewrite");
    expect(copy.sourceTemplateId).toBe(template.id);
    expect(copy.beats).toHaveLength(3);
    expect(copy.beats.map((b) => b.title).sort()).toEqual(["Climax", "Inciting", "Midpoint"]);

    // Independent: editing the template further does not change the copy.
    await upsertWeaveTemplateBeat(t.db, IDS.project, template.id, {
      title: "New beat only on template",
      x: 0,
      y: 0,
    });
    const again = await getWeaveGrid(t.db, IDS.project, copy.id);
    expect(again.beats).toHaveLength(3);
  });

  it("round-trips Weave grids, beats, setup/payoff and templates in backups", async () => {
    const grid = await createWeaveGrid(t.db, IDS.project, { title: "Backup grid", viewKind: "zero_draft_map" });
    const beat = await addWeaveBeat(t.db, IDS.project, grid.id, {
      title: "Ledger wet",
      x: 55,
      y: 66,
      manuscriptRecordId: IDS.chapter,
      decision: "cut",
    });
    await addWeaveBeatWorldRef(t.db, IDS.project, grid.id, beat.id, IDS.dossier);
    const other = await addWeaveBeat(t.db, IDS.project, grid.id, { title: "Payoff beat", x: 100, y: 100 });
    await addWeaveSetupPayoff(t.db, IDS.project, { fromBeatId: beat.id, toBeatId: other.id });
    await createWeaveTemplate(t.db, IDS.project, { title: "Blank scaffold", description: "Empty start" });

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.weaveGrids?.length).toBe(1);
    expect(backup.weaveBeats?.length).toBe(2);
    expect(backup.weaveBeatWorldRefs?.length).toBe(1);
    expect(backup.weaveSetupPayoffs?.length).toBe(1);
    expect(backup.weaveTemplates?.length).toBe(1);
    expect(backup.counts.weaveGrids).toBe(1);

    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const projectId = restored.projects[0]!.id;
      const grids = await listWeaveGrids(target.db, projectId);
      expect(grids).toHaveLength(1);
      const view = await getWeaveGrid(target.db, projectId, grids[0]!.id);
      expect(view.title).toBe("Backup grid");
      expect(view.viewKind).toBe("zero_draft_map");
      expect(view.beats).toHaveLength(2);
      const wet = view.beats.find((b) => b.title === "Ledger wet");
      expect(wet?.x).toBe(55);
      expect(wet?.decision).toBe("cut");
      expect(wet?.worldRefs).toHaveLength(1);
      expect(view.setupPayoffs).toHaveLength(1);
    } finally {
      await target.cleanup();
    }
  });
});
