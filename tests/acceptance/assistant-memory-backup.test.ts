import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newId } from "@/domain/ids";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import {
  createConversation,
  getAssistantSettings,
  getConversationView,
  updateAssistantSettings,
  updateConversationSummary,
} from "@/server/services/assistantService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

const limits = {
  maxInputChars: 100_000,
  maxOutputTokens: 1000,
  maxRequestsPerHour: 30,
  monthlyTokenCap: 300_000,
  requestTimeoutSeconds: 120,
};

describe("Assistant memory backup", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("round-trips conversation summary and settings; omit restores defaults", async () => {
    const { id: conversationId } = await createConversation(t.db, IDS.project);
    await updateConversationSummary(t.db, IDS.project, conversationId, "Keep Mara at the quay.");
    await updateAssistantSettings(t.db, IDS.project, {
      autoIncludeRecent: true,
      recentContextBudgetChars: 4000,
    });
    const userId = newId("asm");
    await t.db.assistantMessage.create({
      data: {
        id: userId,
        conversationId,
        role: "user",
        mode: "chat",
        content: "What happened at the quay?",
        status: "complete",
        completedAt: new Date(),
      },
    });

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(backup.assistantConversations?.length).toBe(1);
    expect(backup.assistantConversations?.[0]?.summary).toBe("Keep Mara at the quay.");
    expect(backup.assistantMessages?.length).toBe(1);
    expect(backup.projectAssistantSettings?.length).toBe(1);
    expect(backup.projectAssistantSettings?.[0]?.autoIncludeRecent).toBe(true);
    expect(backup.counts.assistantConversations).toBe(1);

    const target = await createTestDb();
    try {
      const restored = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "remap" });
      expect(restored.ok).toBe(true);
      if (!restored.ok) return;
      const projectId = restored.projects[0]!.id;
      const settings = await getAssistantSettings(target.db, projectId);
      expect(settings.autoIncludeRecent).toBe(true);
      expect(settings.recentContextBudgetChars).toBe(4000);
      const conv = await target.db.assistantConversation.findFirst({ where: { projectId } });
      expect(conv?.summary).toBe("Keep Mara at the quay.");
      const view = await getConversationView(target.db, projectId, conv!.id, limits);
      expect(view.summary).toBe("Keep Mara at the quay.");
      expect(view.messages).toHaveLength(1);
    } finally {
      await target.cleanup();
    }

    await t.db.assistantMessage.deleteMany({});
    await t.db.assistantConversation.deleteMany({});
    await t.db.projectAssistantSettings.deleteMany({});
    const emptyBackup = await createWorkspaceBackup(t.db, IDS.workspace);
    expect(emptyBackup.assistantConversations ?? []).toEqual([]);
    const emptyTarget = await createTestDb();
    try {
      const outcome = await restoreWorkspaceBackup(emptyTarget.db, emptyBackup, { idStrategy: "remap" });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const projectId = outcome.projects[0]!.id;
      expect(await getAssistantSettings(emptyTarget.db, projectId)).toEqual({
        autoIncludeRecent: false,
        recentContextBudgetChars: 8000,
      });
      expect(await emptyTarget.db.assistantConversation.count({ where: { projectId } })).toBe(0);
    } finally {
      await emptyTarget.cleanup();
    }
  });
});
