import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import {
  createPromptPreset,
  deletePromptPreset,
  listPromptPresets,
  updatePromptPreset,
} from "@/server/services/promptPresetService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("assistant prompt presets", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("CRUD with audit and surface validation", async () => {
    const created = await createPromptPreset(t.db, IDS.project, {
      title: "Warm voice",
      surface: "selection",
      instructionText: "Keep the tone intimate and sensory.",
    });
    expect(created.surface).toBe("selection");

    const listed = await listPromptPresets(t.db, IDS.project, "selection");
    expect(listed).toHaveLength(1);

    await updatePromptPreset(t.db, IDS.project, created.id, { title: "Warm selection" });
    await deletePromptPreset(t.db, IDS.project, created.id);
    expect(await listPromptPresets(t.db, IDS.project)).toHaveLength(0);

    const audit = await t.db.auditEntry.findMany({
      where: { projectId: IDS.project, action: { startsWith: "assistant_prompt_preset." } },
    });
    expect(audit.map((a) => a.action).sort()).toEqual(
      ["assistant_prompt_preset.create", "assistant_prompt_preset.delete", "assistant_prompt_preset.update"].sort(),
    );
  });

  it("backs up and restores optional assistantPromptPresets", async () => {
    await createPromptPreset(t.db, IDS.project, {
      title: "Chat tone",
      surface: "chat",
      instructionText: "Answer in short paragraphs.",
    });
    await createPromptPreset(t.db, IDS.project, {
      title: "Beat polish",
      surface: "beat",
      instructionText: "Favor concrete action over summary.",
    });

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.assistantPromptPresets?.length).toBe(2);
    expect(backup.counts.assistantPromptPresets).toBe(2);

    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const projectId = restored.projects[0]!.id;
      const presets = await listPromptPresets(target.db, projectId);
      expect(presets).toHaveLength(2);
    } finally {
      await target.cleanup();
    }
  });
});