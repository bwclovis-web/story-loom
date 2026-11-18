import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceBackupV1 } from "@/backup/format.v1";
import { sha256, stableStringify } from "@/domain/json";
import {
  applyAssignments,
  previewAssignments,
} from "@/server/services/assignmentService";
import {
  createWorkspaceBackup,
  restoreWorkspaceBackup,
} from "@/server/services/backupService";
import { getRecord } from "@/server/services/recordService";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { readFileSync } from "node:fs";
import path from "node:path";
import { L } from "../fixtures/legacy/ids";

function comparable(b: WorkspaceBackupV1) {
  const { createdAt: _c, checksum: _s, counts: _n, ...rest } = b;
  return { ...rest, auditEntries: rest.auditEntries.filter((a) => a.action !== "workspace.restore") };
}

describe("assignments and workspace backups", () => {
  let source: TestDb;
  let target: TestDb;
  beforeEach(async () => {
    source = await createTestDb();
    target = await createTestDb();
  });
  afterEach(async () => {
    await source.cleanup();
    await target.cleanup();
  });

  it("restores a legacy fixture without assignments", async () => {
    const raw = readFileSync(path.resolve(__dirname, "../fixtures/legacy", L.files.fullBackup), "utf8");
    const outcome = await restoreWorkspaceBackup(target.db, raw, { idStrategy: "preserve" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const projects = await target.db.project.findMany();
    expect(projects.length).toBeGreaterThan(0);
    for (const p of projects) {
      expect(p.seriesName).toBeNull();
      expect(p.bookName).toBeNull();
      expect(p.draftKind).toBeNull();
      expect(p.assignmentRevision).toBe(0);
    }
    expect(await target.db.manuscriptGroup.count()).toBe(0);
    const withScope = await target.db.record.count({ where: { OR: [{ groupId: { not: null } }, { worldScope: { not: null } }] } });
    expect(withScope).toBe(0);
  });

  it("round-trips assignments in a new backup on an isolated database", async () => {
    await seedProject(source.db);
    const preview = await previewAssignments(source.db, IDS.project, {
      seriesName: "Saltmarsh Annals",
      bookName: "Book One",
      draftKind: "zero_draft",
      groups: [{ label: "Opening", position: 0, chapterIds: [IDS.chapter] }],
      worldScopes: [{ recordId: IDS.dossier, scope: "series" }],
    });
    const applied = await applyAssignments(source.db, IDS.project, {
      plan: preview.plan,
      previewToken: preview.previewToken,
    });
    expect(applied.status).toBe("applied");

    const backup = await createWorkspaceBackup(source.db, IDS.workspace);
    expect(backup.projects[0].seriesName).toBe("Saltmarsh Annals");
    expect(backup.manuscriptGroups?.length).toBe(1);
    expect(backup.records.some((r) => r.id === IDS.chapter && r.groupId)).toBe(true);
    expect(backup.records.some((r) => r.id === IDS.dossier && r.worldScope === "series")).toBe(true);

    const outcome = await restoreWorkspaceBackup(target.db, JSON.stringify(backup), { idStrategy: "preserve" });
    expect(outcome.ok).toBe(true);

    const again = await createWorkspaceBackup(target.db, IDS.workspace);
    expect(comparable(again)).toEqual(comparable(backup));

    const chapter = await getRecord(target.db, IDS.project, IDS.chapter);
    expect(chapter.body).toBe(CHAPTER_PROSE);
    expect(chapter.currentRevision).toBe(1);
    const project = await target.db.project.findUniqueOrThrow({ where: { id: IDS.project } });
    expect(project.seriesName).toBe("Saltmarsh Annals");
    expect(project.assignmentRevision).toBe(1);
    expect(await target.db.manuscriptGroup.count()).toBe(1);
  });

  it("keeps unassigned project backup shape free of assignment keys", async () => {
    await seedProject(source.db);
    const backup = await createWorkspaceBackup(source.db, IDS.workspace);
    expect(backup.projects[0]).not.toHaveProperty("seriesName");
    expect(backup.projects[0]).not.toHaveProperty("assignmentRevision");
    expect(backup.manuscriptGroups).toBeUndefined();
    expect(backup.counts.manuscriptGroups).toBeUndefined();
    expect(backup.records.every((r) => r.groupId === undefined && r.worldScope === undefined)).toBe(true);
    // Checksum still validates.
    const { checksum, ...rest } = backup;
    expect(checksum).toBe(sha256(stableStringify(rest)));
  });
});
