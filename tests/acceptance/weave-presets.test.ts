import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MutationRejectedError } from "@/server/services/errors";
import { getSynopsis } from "@/server/services/manuscriptAnnotationService";
import { getRecord } from "@/server/services/recordService";
import {
  createSceneFromWeaveBeat,
  importWeavePresetAsTemplate,
  instantiateWeavePresetGrid,
} from "@/server/services/weavePresetService";
import { applyWeaveTemplate, saveWeaveGridAsTemplate } from "@/server/services/weaveService";
import { WEAVE } from "@/ui/labels";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
  await seedProject(t.db);
});

afterEach(async () => {
  await t.cleanup();
});

describe("weave beat sheet adoption", () => {
  it("opens a plot grid from a starter, with threads, prompts, and setup links", async () => {
    const grid = await instantiateWeavePresetGrid(t.db, IDS.project, "three-act", { viewKind: "original" });
    expect(grid.layoutMode).toBe("plot_grid");
    expect(grid.sourceTemplateId).toBeNull();
    expect(grid.threads.map((thread) => thread.title)).toEqual(["Act I", "Act II", "Act III"]);
    expect(grid.beats).toHaveLength(8);
    expect(grid.beats.map((beat) => beat.title)).toContain("Midpoint");
    expect(grid.beats.every((beat) => beat.threadId)).toBe(true);
    expect(grid.beats.every((beat) => !beat.body.startsWith(`${WEAVE.presetThreadPrefix} `))).toBe(true);
    expect(grid.beats.every((beat) => beat.manuscriptRecordId === null)).toBe(true);
    expect(grid.setupPayoffs).toHaveLength(1);
    expect(grid.setupPayoffs[0]?.note).toMatch(/climax/i);
  });

  it("saves a starter as a template and applies it as its own grid", async () => {
    const template = await importWeavePresetAsTemplate(t.db, IDS.project, "mystery");
    expect(template.beats).toHaveLength(7);
    expect(template.beats[0]?.body.startsWith(`${WEAVE.presetThreadPrefix} Investigation`)).toBe(true);

    const grid = await applyWeaveTemplate(t.db, IDS.project, template.id, { viewKind: "zero_draft_map" });
    expect(grid.viewKind).toBe("zero_draft_map");
    expect(grid.sourceTemplateId).toBe(template.id);
    expect(grid.threads.map((thread) => thread.title)).toEqual(["Investigation", "Misdirection", "Solution"]);
    const reveal = grid.beats.find((beat) => beat.title === "Reveal");
    expect(reveal?.body.startsWith(WEAVE.presetThreadPrefix)).toBe(false);
    expect(reveal?.body).toMatch(/first clue/i);
    expect(reveal?.threadId).toBe(grid.threads.find((thread) => thread.title === "Solution")?.id);

    const saved = await saveWeaveGridAsTemplate(t.db, IDS.project, grid.id, { title: "Mystery copy" });
    expect(saved.beats.find((beat) => beat.title === "Reveal")?.body.startsWith(`${WEAVE.presetThreadPrefix} Solution`)).toBe(true);
  });

  it("rejects an unknown starter", async () => {
    await expect(instantiateWeavePresetGrid(t.db, IDS.project, "missing", { viewKind: "original" })).rejects.toBeInstanceOf(
      MutationRejectedError,
    );
  });
});

describe("create a scene from a beat", () => {
  it("creates a protected scene, synopsis, reference link, and beat binding", async () => {
    const grid = await instantiateWeavePresetGrid(t.db, IDS.project, "romance", { viewKind: "author_rewrite" });
    const beat = grid.beats[0]!;
    await t.db.weaveBeatWorldRef.create({
      data: { id: "wvr_test_mara", beatId: beat.id, projectId: IDS.project, recordId: IDS.dossier },
    });

    const linked = await createSceneFromWeaveBeat(t.db, IDS.project, beat.id, { chapterId: IDS.chapter });
    expect(linked.manuscriptRecordId).toBeTruthy();
    const sceneId = linked.manuscriptRecordId!;
    const scene = await getRecord(t.db, IDS.project, sceneId);
    expect(scene.type).toBe("manuscript_scene");
    expect(scene.title).toBe(beat.title);
    expect(scene.body).toBe("");
    expect(scene.protected).toBe(true);
    expect(scene.currentRevision).toBe(1);
    expect(scene.parentRecordId).toBe(IDS.chapter);

    const synopsis = await getSynopsis(t.db, IDS.project, sceneId);
    expect(synopsis?.body).toBe(beat.body);

    const link = await t.db.recordLink.findUnique({
      where: { fromRecordId_toRecordId: { fromRecordId: sceneId, toRecordId: IDS.dossier } },
    });
    expect(link?.projectId).toBe(IDS.project);

    await expect(createSceneFromWeaveBeat(t.db, IDS.project, beat.id, { chapterId: IDS.chapter })).rejects.toBeInstanceOf(
      MutationRejectedError,
    );
    const still = await t.db.weaveBeat.findUniqueOrThrow({ where: { id: beat.id } });
    expect(still.manuscriptRecordId).toBe(sceneId);
  });

  it("refuses a target that is not a chapter", async () => {
    const grid = await instantiateWeavePresetGrid(t.db, IDS.project, "seven-point", { viewKind: "original" });
    await expect(
      createSceneFromWeaveBeat(t.db, IDS.project, grid.beats[0]!.id, { chapterId: IDS.dossier }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
    expect(await t.db.record.count({ where: { projectId: IDS.project, type: "manuscript_scene" } })).toBe(0);
  });
});
