import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCAL_PLACEHOLDER_KEY, readAssistantConfig } from "@/assistant/config";
import { prepareBeatDraft } from "@/server/services/beatDraftAssistService";
import { inspectSelectionAssistContext } from "@/server/services/assistantContextInspect";
import { setRecordProtection } from "@/server/services/mutationService";
import { createRecord, getRecord } from "@/server/services/recordService";
import { addWeaveBeat, createWeaveGrid } from "@/server/services/weaveService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

const SCENE_OPEN = "rec_m6_scene_open";
const SCENE_LOCKED = "rec_m6_scene_locked";

describe("AI transparency (Milestone 6)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("local loopback config never puts a real key into status JSON", () => {
    const config = readAssistantConfig({
      OPENAI_MODEL: "llama3.2",
      WORDLY_OPENAI_BASE_URL: "http://127.0.0.1:11434/v1",
    });
    expect(config.status.configured).toBe(true);
    expect(config.apiKey).toBe(LOCAL_PLACEHOLDER_KEY);
    const json = JSON.stringify(config.status);
    expect(json).not.toContain("sk-");
    expect(json).toContain("11434");
  });

  it("context inspect is read-only and lists the selection", async () => {
    await createRecord(t.db, IDS.project, {
      recordId: SCENE_OPEN,
      type: "manuscript_scene",
      title: "Harbour watch",
      body: "The quay smelled of salt and rope.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    await setRecordProtection(t.db, {
      projectId: IDS.project,
      recordId: SCENE_OPEN,
      protected: false,
      actor: "author",
    });
    const scene = await getRecord(t.db, IDS.project, SCENE_OPEN);
    const before = await t.db.proofreadRun.count();
    const runtime = {
      configured: true,
      model: "example-model-1",
      limits: readAssistantConfig({
        WORDLY_OPENAI_API_KEY: "sk-test-not-a-real-key-000000",
        OPENAI_MODEL: "example-model-1",
      }).status.limits,
    };
    const report = await inspectSelectionAssistContext(t.db, runtime, {
      projectId: IDS.project,
      recordId: scene.id,
      revision: scene.currentRevision,
      range: { start: 0, end: scene.body.length },
      action: "rewrite",
      scopeDraftId: "",
    });
    expect(await t.db.proofreadRun.count()).toBe(before);
    expect(report.items.some((i) => i.kind === "manuscript")).toBe(true);
    expect(report.estimatedTokens).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toMatch(/sk-/);
  });

  it("beat draft prepare rejects protected scenes", async () => {
    await createRecord(t.db, IDS.project, {
      recordId: SCENE_LOCKED,
      type: "manuscript_scene",
      title: "Locked quay",
      body: "Guards blocked the steps.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    const scene = await getRecord(t.db, IDS.project, SCENE_LOCKED);
    expect(scene.protected).toBe(true);

    const grid = await createWeaveGrid(t.db, IDS.project, { title: "Quay plot", viewKind: "original" });
    const beat = await addWeaveBeat(t.db, IDS.project, grid.id, {
      title: "Guards arrive",
      body: "Show the blockade without naming the traitor.",
      manuscriptRecordId: scene.id,
      x: 0,
      y: 0,
    });
    const runtime = {
      configured: true,
      model: "example-model-1",
      limits: readAssistantConfig({
        WORDLY_OPENAI_API_KEY: "sk-test-not-a-real-key-000000",
        OPENAI_MODEL: "example-model-1",
      }).status.limits,
    };
    await expect(
      prepareBeatDraft(t.db, runtime, {
        projectId: IDS.project,
        recordId: scene.id,
        revision: scene.currentRevision,
        beatId: beat.id,
        scopeDraftId: "",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await t.db.proofreadRun.count()).toBe(0);
  });
});
