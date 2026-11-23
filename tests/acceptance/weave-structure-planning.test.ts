import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { StaleRevisionError } from "@/server/services/errors";
import { createProject } from "@/server/services/projectService";
import {
  addWeaveBeat,
  createWeaveGrid,
  getWeaveGrid,
  listWeaveGrids,
  updateWeaveBeat,
} from "@/server/services/weaveService";
import {
  addIdeaToWeaveStage,
  addWeavePlanningRow,
  adoptWeaveStructures,
  applyWeavePlanChapterMappings,
  createCustomWeaveStructure,
  forkIdeaOnWeaveStage,
  getWeavePlanPlanning,
  listWeaveIdeaManuscriptPlacements,
  placeIdeaOnPlanningRow,
  previewRemoveWeaveStructure,
  removeWeaveStructure,
  resolveWeaveSurface,
  setWeaveIdeaManuscriptPlacements,
  setWeavePreferredSurface,
  unlinkIdeaFromWeaveStage,
  updateWeaveIdeaText,
} from "@/server/services/weaveStructureService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { getWeaveBeatPreset } from "@/world/weaveBeatPresets";

describe("Weave structure planning foundation", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("plans with no manuscript records: two structures, empty stages", async () => {
    const adopted = await adoptWeaveStructures(t.db, IDS.project, {
      presetIds: ["save-the-cat", "heroines-journey-murdock"],
      viewKind: "original",
      title: "Beat-first plan",
      clientRequestId: "req-two-structures",
    });
    expect(adopted.ok).toBe(true);
    if (!adopted.ok) return;
    expect(adopted.preferredSurface).toBe("beat_sheet");
    expect(adopted.structureIds).toHaveLength(2);

    const planning = await getWeavePlanPlanning(t.db, IDS.project, adopted.gridId);
    expect(planning.surface).toBe("beat_sheet");
    expect(planning.structures).toHaveLength(2);
    expect(planning.structures.map((s) => s.sourcePresetId).sort()).toEqual([
      "heroines-journey-murdock",
      "save-the-cat",
    ]);
    expect(planning.structures.every((s) => s.sourceVersion >= 1)).toBe(true);
    expect(planning.structures[0]?.stages.length).toBeGreaterThan(0);
    expect(planning.structures.every((s) => s.stages.every((stage) => stage.ideas.length === 0))).toBe(true);
    expect(planning.grid.beats).toHaveLength(0);
    expect(await t.db.record.count({ where: { projectId: IDS.project, type: "manuscript_scene" } })).toBe(0);
  });

  it("shares an idea across stages and can fork an independent copy", async () => {
    const adopted = await adoptWeaveStructures(t.db, IDS.project, {
      presetIds: ["three-act", "seven-point"],
      viewKind: "original",
    });
    expect(adopted.ok).toBe(true);
    if (!adopted.ok) return;
    const planning = await getWeavePlanPlanning(t.db, IDS.project, adopted.gridId);
    const stageA = planning.structures[0]!.stages[0]!;
    const stageB = planning.structures[1]!.stages[0]!;

    const linked = await addIdeaToWeaveStage(t.db, IDS.project, stageA.id, {
      title: "Harbour knock",
      body: "Someone pounds before dawn.",
    });
    await addIdeaToWeaveStage(t.db, IDS.project, stageB.id, { existingBeatId: linked.beatId });

    const shared = await getWeavePlanPlanning(t.db, IDS.project, adopted.gridId);
    const ideaOnA = shared.structures[0]!.stages[0]!.ideas[0]!;
    const ideaOnB = shared.structures[1]!.stages[0]!.ideas[0]!;
    expect(ideaOnA.beatId).toBe(ideaOnB.beatId);
    expect(ideaOnA.sharedStageCount).toBe(2);
    expect(ideaOnB.body).toBe("Someone pounds before dawn.");

    await updateWeaveIdeaText(t.db, IDS.project, linked.beatId, {
      body: "Shared description changed once.",
      expectedRevision: ideaOnA.contentRevision,
    });
    const afterEdit = await getWeavePlanPlanning(t.db, IDS.project, adopted.gridId);
    expect(afterEdit.structures[0]!.stages[0]!.ideas[0]!.body).toBe("Shared description changed once.");
    expect(afterEdit.structures[1]!.stages[0]!.ideas[0]!.body).toBe("Shared description changed once.");

    const forked = await forkIdeaOnWeaveStage(t.db, IDS.project, stageB.id, linked.beatId);
    expect(forked.beatId).not.toBe(linked.beatId);
    expect(forked.body).toBe("Shared description changed once.");
    await updateWeaveIdeaText(t.db, IDS.project, forked.beatId, {
      body: "Independent copy.",
      expectedRevision: forked.contentRevision,
    });
    const afterFork = await getWeavePlanPlanning(t.db, IDS.project, adopted.gridId);
    expect(afterFork.structures[0]!.stages[0]!.ideas[0]!.body).toBe("Shared description changed once.");
    expect(afterFork.structures[1]!.stages[0]!.ideas[0]!.body).toBe("Independent copy.");
    expect(afterFork.structures[0]!.stages[0]!.ideas[0]!.sharedStageCount).toBe(1);

    await unlinkIdeaFromWeaveStage(t.db, IDS.project, stageA.id, linked.beatId);
    const afterUnlink = await getWeavePlanPlanning(t.db, IDS.project, adopted.gridId);
    expect(afterUnlink.structures[0]!.stages[0]!.ideas).toHaveLength(0);
    expect(await t.db.weaveBeat.count({ where: { id: linked.beatId } })).toBe(1);
  });

  it("warns on repeated adoption, stays idempotent on double submit, and rejects stale idea saves", async () => {
    const first = await adoptWeaveStructures(t.db, IDS.project, {
      presetIds: ["mystery"],
      viewKind: "original",
      clientRequestId: "dup-1",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const again = await adoptWeaveStructures(t.db, IDS.project, {
      presetIds: ["mystery"],
      gridId: first.gridId,
      clientRequestId: "dup-1",
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.structureIds).toEqual(first.structureIds);
    expect(await t.db.weaveStructure.count({ where: { gridId: first.gridId } })).toBe(1);

    const warned = await adoptWeaveStructures(t.db, IDS.project, {
      presetIds: ["mystery"],
      gridId: first.gridId,
      clientRequestId: "dup-2",
    });
    expect(warned.ok).toBe(false);
    if (warned.ok) return;
    expect(warned.needsDuplicateConfirm).toBe(true);
    expect(warned.duplicates[0]?.presetId).toBe("mystery");

    const confirmed = await adoptWeaveStructures(t.db, IDS.project, {
      presetIds: ["mystery"],
      gridId: first.gridId,
      confirmDuplicates: true,
      clientRequestId: "dup-3",
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(await t.db.weaveStructure.count({ where: { gridId: first.gridId } })).toBe(2);

    const planning = await getWeavePlanPlanning(t.db, IDS.project, first.gridId);
    const stage = planning.structures[0]!.stages[0]!;
    const idea = await addIdeaToWeaveStage(t.db, IDS.project, stage.id, {
      title: "Clue",
      body: "First save",
    });
    await updateWeaveIdeaText(t.db, IDS.project, idea.beatId, {
      body: "Second save",
      expectedRevision: idea.contentRevision,
    });
    await expect(
      updateWeaveIdeaText(t.db, IDS.project, idea.beatId, {
        body: "Stale local text that must survive in the client",
        expectedRevision: idea.contentRevision,
      }),
    ).rejects.toBeInstanceOf(StaleRevisionError);
    const beat = await t.db.weaveBeat.findUniqueOrThrow({ where: { id: idea.beatId } });
    expect(beat.body).toBe("Second save");
  });

  it("keeps existing grids on their default surface and preserves beats when removing a structure", async () => {
    const legacy = await createWeaveGrid(t.db, IDS.project, {
      title: "Legacy freeform",
      viewKind: "original",
    });
    expect(legacy.preferredSurface).toBeNull();
    expect(resolveWeaveSurface(legacy)).toBe("freeform");
    const beat = await addWeaveBeat(t.db, IDS.project, legacy.id, {
      title: "Existing beat",
      body: "Author prose stays author prose",
      x: 20,
      y: 40,
    });

    const adopted = await adoptWeaveStructures(t.db, IDS.project, {
      presetIds: ["romance"],
      gridId: legacy.id,
    });
    expect(adopted.ok).toBe(true);
    if (!adopted.ok) return;
    const afterAdopt = await getWeaveGrid(t.db, IDS.project, legacy.id);
    expect(afterAdopt.preferredSurface).toBeNull();
    expect(afterAdopt.surface).toBe("freeform");
    expect(afterAdopt.beats.find((row) => row.id === beat.id)?.body).toBe("Author prose stays author prose");

    const planning = await getWeavePlanPlanning(t.db, IDS.project, legacy.id);
    const structure = planning.structures[0]!;
    await addIdeaToWeaveStage(t.db, IDS.project, structure.stages[0]!.id, { existingBeatId: beat.id });
    const preview = await previewRemoveWeaveStructure(t.db, IDS.project, structure.id);
    expect(preview.distinctIdeaCount).toBe(1);
    expect(preview.linkCount).toBe(1);
    await removeWeaveStructure(t.db, IDS.project, structure.id);
    expect(await t.db.weaveStructure.count({ where: { gridId: legacy.id } })).toBe(0);
    expect(await t.db.weaveBeat.count({ where: { id: beat.id } })).toBe(1);
    expect((await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter } })).body.length).toBeGreaterThan(0);
  });

  it("isolates plans across projects and drafts, and supports planning rows + multi manuscript links", async () => {
    const sibling = await createProject(t.db, {
      workspaceId: IDS.workspace,
      title: "Sibling book",
    });
    const a = await adoptWeaveStructures(t.db, IDS.project, {
      presetIds: ["three-act"],
      viewKind: "original",
    });
    const b = await adoptWeaveStructures(t.db, sibling.id, {
      presetIds: ["three-act"],
      viewKind: "zero_draft_map",
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.gridId).not.toBe(b.gridId);
    expect((await getWeavePlanPlanning(t.db, IDS.project, a.gridId)).structures).toHaveLength(1);
    expect((await getWeavePlanPlanning(t.db, sibling.id, b.gridId)).structures).toHaveLength(1);
    expect(await t.db.weaveStructure.count({ where: { projectId: IDS.project } })).toBe(1);
    expect(await t.db.weaveStructure.count({ where: { projectId: sibling.id } })).toBe(1);

    const rewrite = await adoptWeaveStructures(t.db, IDS.project, {
      presetIds: ["mystery"],
      viewKind: "author_rewrite",
    });
    expect(rewrite.ok).toBe(true);
    if (!rewrite.ok) return;
    expect(rewrite.gridId).not.toBe(a.gridId);

    await setWeavePreferredSurface(t.db, IDS.project, a.gridId, "story_grid");
    const row = await addWeavePlanningRow(t.db, IDS.project, a.gridId, { title: "Opening sequence" });
    const planning = await getWeavePlanPlanning(t.db, IDS.project, a.gridId);
    const idea = await addIdeaToWeaveStage(t.db, IDS.project, planning.structures[0]!.stages[0]!.id, {
      title: "Arrival",
      body: "Boats in fog",
    });
    await placeIdeaOnPlanningRow(t.db, IDS.project, a.gridId, idea.beatId, {
      planningRowId: row.id,
      cellOrder: 0,
    });
    const placed = await t.db.weaveBeat.findUniqueOrThrow({ where: { id: idea.beatId } });
    expect(placed.planningRowId).toBe(row.id);

    const links = await setWeaveIdeaManuscriptPlacements(t.db, IDS.project, idea.beatId, [IDS.chapter]);
    expect(links.primaryId).toBe(IDS.chapter);
    expect(await listWeaveIdeaManuscriptPlacements(t.db, IDS.project, idea.beatId)).toEqual([IDS.chapter]);
    const legacyBeat = await updateWeaveBeat(t.db, IDS.project, a.gridId, idea.beatId, {
      manuscriptRecordId: IDS.chapter,
    });
    expect(legacyBeat.manuscriptRecordId).toBe(IDS.chapter);
  });

  it("round-trips new planning data in backups and still restores older weave-only payloads", async () => {
    const adopted = await adoptWeaveStructures(t.db, IDS.project, {
      presetIds: ["save-the-cat"],
      viewKind: "original",
      title: "Backup plan",
    });
    expect(adopted.ok).toBe(true);
    if (!adopted.ok) return;
    const planning = await getWeavePlanPlanning(t.db, IDS.project, adopted.gridId);
    const idea = await addIdeaToWeaveStage(t.db, IDS.project, planning.structures[0]!.stages[1]!.id, {
      title: "Theme",
      body: "What the story argues",
    });
    await addWeavePlanningRow(t.db, IDS.project, adopted.gridId, { title: "Moment one" });

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.weaveStructures?.length).toBe(1);
    expect(backup.weaveStructureStages?.length).toBe(15);
    expect(backup.weaveStageIdeas?.length).toBe(1);
    expect(backup.weavePlanningRows?.length).toBe(1);
    expect(backup.weaveGrids?.some((g) => g.preferredSurface === "beat_sheet")).toBe(true);

    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, {
        idStrategy: "remap",
        workspaceName: "Restored planning",
      });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const restoredProjectId = restored.projects.find((p) => p.originalId === IDS.project)!.id;
      const grids = await target.db.weaveGrid.findMany({ where: { projectId: restoredProjectId } });
      const restoredGrid = grids.find((g) => g.preferredSurface === "beat_sheet")!;
      const restoredPlanning = await getWeavePlanPlanning(target.db, restoredProjectId, restoredGrid.id);
      expect(restoredPlanning.structures).toHaveLength(1);
      expect(restoredPlanning.structures[0]!.stages).toHaveLength(15);
      expect(restoredPlanning.structures[0]!.stages[1]!.ideas[0]!.body).toBe("What the story argues");
      expect(restoredPlanning.planningRows).toHaveLength(1);
      expect(idea.beatId).toBeTruthy();
    } finally {
      await target.cleanup();
    }

    // Older shape: a grid with beats but no structures / preferredSurface still restores.
    const t2 = await createTestDb();
    try {
      await seedProject(t2.db);
      const legacyGrid = await createWeaveGrid(t2.db, IDS.project, {
        title: "Legacy only",
        viewKind: "zero_draft_map",
      });
      await addWeaveBeat(t2.db, IDS.project, legacyGrid.id, {
        title: "Old beat",
        body: "pre-structure",
        x: 1,
        y: 2,
      });
      const legacyBackup = await createWorkspaceBackup(t2.db, IDS.workspace);
      expect(legacyBackup.weaveStructures ?? []).toHaveLength(0);
      expect(legacyBackup.weaveGrids?.every((g) => g.preferredSurface == null)).toBe(true);
      const target2 = await createTestDb();
      try {
        const oldRestored = await restoreWorkspaceBackup(target2.db, legacyBackup, {
          idStrategy: "remap",
          workspaceName: "Old weave restore",
        });
        expect(oldRestored.ok).toBe(true);
        if (!oldRestored.ok) return;
        const remappedProject = oldRestored.projects.find((p) => p.originalId === IDS.project)!.id;
        const remappedGrids = await listWeaveGrids(target2.db, remappedProject);
        expect(remappedGrids).toHaveLength(1);
        const restoredLegacy = await getWeaveGrid(target2.db, remappedProject, remappedGrids[0]!.id);
        expect(restoredLegacy.preferredSurface).toBeNull();
        expect(restoredLegacy.surface).toBe("freeform");
        expect(restoredLegacy.beats[0]?.body).toBe("pre-structure");
      } finally {
        await target2.cleanup();
      }
    } finally {
      await t2.cleanup();
    }
  });

  it("acceptance: two frameworks, shared idea, story grid, blank chapters, backup both ways", async () => {
    // Invented empty manuscript project path — no chapters required to plan.
    const empty = await createTestDb();
    try {
      const { createProject: createEmptyProject, createWorkspace } = await import(
        "@/server/services/projectService"
      );
      await createWorkspace(empty.db, { id: "wsp_empty_plan", name: "Empty plan workspace" });
      const project = await createEmptyProject(empty.db, {
        workspaceId: "wsp_empty_plan",
        title: "Invented planning book",
      });
      expect(await empty.db.record.count({ where: { projectId: project.id, type: "manuscript_chapter" } })).toBe(0);

      const murdock = getWeaveBeatPreset("heroines-journey-murdock");
      const carriger = getWeaveBeatPreset("heroines-journey-carriger");
      expect(murdock?.attribution).toMatch(/Murdock/);
      expect(carriger?.attribution).toMatch(/Carriger/);
      expect(murdock?.beats.some((b) => /call to adventure/i.test(b.title))).toBe(false);
      expect(carriger?.beats.some((b) => /ordinary world/i.test(b.title))).toBe(false);

      const adopted = await adoptWeaveStructures(empty.db, project.id, {
        presetIds: ["heroines-journey-murdock", "heroines-journey-carriger"],
        viewKind: "original",
        title: "Two journeys",
        clientRequestId: "accept-two",
      });
      expect(adopted.ok).toBe(true);
      if (!adopted.ok) return;
      expect(adopted.preferredSurface).toBe("beat_sheet");

      let planning = await getWeavePlanPlanning(empty.db, project.id, adopted.gridId);
      expect(planning.structures).toHaveLength(2);
      const stageA = planning.structures.find((s) => s.sourcePresetId === "heroines-journey-murdock")!.stages[0]!;
      const stageB = planning.structures.find((s) => s.sourcePresetId === "heroines-journey-carriger")!.stages[0]!;

      const idea = await addIdeaToWeaveStage(empty.db, project.id, stageA.id, {
        title: "Leaving home",
        body: "She packs before anyone wakes.",
      });
      planning = await getWeavePlanPlanning(empty.db, project.id, adopted.gridId);
      expect(
        planning.structures
          .flatMap((s) => s.stages)
          .flatMap((s) => s.ideas)
          .find((row) => row.beatId === idea.beatId)?.body,
      ).toBe("She packs before anyone wakes.");

      await addIdeaToWeaveStage(empty.db, project.id, stageB.id, { existingBeatId: idea.beatId });
      await updateWeaveIdeaText(empty.db, project.id, idea.beatId, {
        body: "Shared packing scene — both frameworks see this.",
        expectedRevision: idea.contentRevision,
      });
      planning = await getWeavePlanPlanning(empty.db, project.id, adopted.gridId);
      const linkedBodies = planning.structures
        .flatMap((s) => s.stages)
        .flatMap((s) => s.ideas)
        .filter((row) => row.beatId === idea.beatId)
        .map((row) => row.body);
      expect(linkedBodies).toEqual([
        "Shared packing scene — both frameworks see this.",
        "Shared packing scene — both frameworks see this.",
      ]);

      const forked = await forkIdeaOnWeaveStage(empty.db, project.id, stageB.id, idea.beatId);
      await updateWeaveIdeaText(empty.db, project.id, forked.beatId, {
        body: "Carriger-only copy after fork.",
        expectedRevision: forked.contentRevision,
      });
      planning = await getWeavePlanPlanning(empty.db, project.id, adopted.gridId);
      const murdockIdea = planning.structures
        .find((s) => s.sourcePresetId === "heroines-journey-murdock")!
        .stages[0]!.ideas[0]!;
      const carrigerIdea = planning.structures
        .find((s) => s.sourcePresetId === "heroines-journey-carriger")!
        .stages[0]!.ideas[0]!;
      expect(murdockIdea.body).toBe("Shared packing scene — both frameworks see this.");
      expect(carrigerIdea.body).toBe("Carriger-only copy after fork.");

      await setWeavePreferredSurface(empty.db, project.id, adopted.gridId, "story_grid");
      const moment = await addWeavePlanningRow(empty.db, project.id, adopted.gridId, { title: "Departure beat" });
      await placeIdeaOnPlanningRow(empty.db, project.id, adopted.gridId, murdockIdea.beatId, {
        planningRowId: moment.id,
      });
      expect(await empty.db.record.count({ where: { projectId: project.id } })).toBe(0);

      const custom = await createCustomWeaveStructure(empty.db, project.id, adopted.gridId, {
        title: "Author scaffold",
        attribution: "Invented for tests",
        stages: [
          { title: "Spark", guidance: "What wakes the desire?", groupTitle: "Begin" },
          { title: "Cost", guidance: "What does saying yes require?", groupTitle: "Middle" },
        ],
      });
      expect(custom.sourcePresetId).toBe("custom");
      expect(custom.stages).toHaveLength(2);

      const mapped = await applyWeavePlanChapterMappings(empty.db, project.id, adopted.gridId, [
        { beatId: murdockIdea.beatId, action: "create", title: "Chapter One" },
      ]);
      expect(mapped.applied).toBe(1);
      expect(mapped.skipped).toBe(0);
      const chapter = await empty.db.record.findFirstOrThrow({
        where: { projectId: project.id, type: "manuscript_chapter" },
      });
      expect(chapter.body).toBe("");
      expect(chapter.title).toBe("Chapter One");

      const retry = await applyWeavePlanChapterMappings(empty.db, project.id, adopted.gridId, [
        { beatId: murdockIdea.beatId, action: "create", title: "Chapter One again" },
      ]);
      expect(retry.skipped).toBe(1);
      expect(retry.applied).toBe(0);
      expect(await empty.db.record.count({ where: { projectId: project.id, type: "manuscript_chapter" } })).toBe(1);

      await setWeavePreferredSurface(empty.db, project.id, adopted.gridId, "chapter_grid");
      await setWeavePreferredSurface(empty.db, project.id, adopted.gridId, "freeform");
      const gridAfterViews = await getWeaveGrid(empty.db, project.id, adopted.gridId);
      expect(gridAfterViews.beats.find((b) => b.id === murdockIdea.beatId)?.body).toBe(
        "Shared packing scene — both frameworks see this.",
      );
      expect(gridAfterViews.beats.find((b) => b.id === murdockIdea.beatId)?.manuscriptRecordId).toBe(chapter.id);

      const backup = await createWorkspaceBackup(empty.db, "wsp_empty_plan");
      const remapTarget = await createTestDb();
      try {
        const remapped = await restoreWorkspaceBackup(remapTarget.db, backup, {
          idStrategy: "remap",
          workspaceName: "Remapped planning",
        });
        expect(remapped.ok).toBe(true);
        if (!remapped.ok) return;
        const remappedProject = remapped.projects.find((p) => p.originalId === project.id)!.id;
        const remappedGrids = await listWeaveGrids(remapTarget.db, remappedProject);
        expect(remappedGrids).toHaveLength(1);
        const remappedPlanning = await getWeavePlanPlanning(
          remapTarget.db,
          remappedProject,
          remappedGrids[0]!.id,
        );
        expect(remappedPlanning.structures.some((s) => s.sourcePresetId === "heroines-journey-carriger")).toBe(true);
        expect(remappedPlanning.structures.some((s) => s.sourcePresetId === "custom")).toBe(true);
        expect(remappedPlanning.planningRows).toHaveLength(1);
      } finally {
        await remapTarget.cleanup();
      }

      const preserveTarget = await createTestDb();
      try {
        const preserved = await restoreWorkspaceBackup(preserveTarget.db, backup, {
          idStrategy: "preserve",
          workspaceName: "Preserved planning",
        });
        expect(preserved.ok).toBe(true);
        if (!preserved.ok) return;
        const preservedPlanning = await getWeavePlanPlanning(preserveTarget.db, project.id, adopted.gridId);
        expect(preservedPlanning.structures).toHaveLength(3);
        expect(
          preservedPlanning.structures
            .flatMap((s) => s.stages)
            .flatMap((s) => s.ideas)
            .some((row) => row.body.includes("Shared packing")),
        ).toBe(true);
      } finally {
        await preserveTarget.cleanup();
      }
    } finally {
      await empty.cleanup();
    }
  });

  it("legacy plan: opening new views or adding a structure does not rewrite prose or positions", async () => {
    const legacy = await createWeaveGrid(t.db, IDS.project, {
      title: "Legacy decisions",
      viewKind: "original",
    });
    const beat = await addWeaveBeat(t.db, IDS.project, legacy.id, {
      title: "Keep me",
      body: "Exact prose",
      x: 111,
      y: 222,
      decision: "keep",
      manuscriptRecordId: IDS.chapter,
    });
    const before = await getWeaveGrid(t.db, IDS.project, legacy.id);
    const beforeBeat = before.beats.find((row) => row.id === beat.id)!;

    await setWeavePreferredSurface(t.db, IDS.project, legacy.id, "beat_sheet");
    await setWeavePreferredSurface(t.db, IDS.project, legacy.id, "story_grid");
    await setWeavePreferredSurface(t.db, IDS.project, legacy.id, "chapter_grid");
    await setWeavePreferredSurface(t.db, IDS.project, legacy.id, "freeform");
    const adopted = await adoptWeaveStructures(t.db, IDS.project, {
      presetIds: ["heroines-journey-carriger"],
      gridId: legacy.id,
    });
    expect(adopted.ok).toBe(true);

    const after = await getWeaveGrid(t.db, IDS.project, legacy.id);
    const afterBeat = after.beats.find((row) => row.id === beat.id)!;
    expect(afterBeat.body).toBe(beforeBeat.body);
    expect(afterBeat.title).toBe(beforeBeat.title);
    expect(afterBeat.x).toBe(beforeBeat.x);
    expect(afterBeat.y).toBe(beforeBeat.y);
    expect(afterBeat.decision).toBe(beforeBeat.decision);
    expect(afterBeat.manuscriptRecordId).toBe(beforeBeat.manuscriptRecordId);
    const chapter = await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter } });
    expect(chapter.id).toBe(IDS.chapter);
    expect(typeof chapter.body).toBe("string");
  });
});
