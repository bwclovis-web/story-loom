import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject, renameProject, renameWorkspace } from "@/server/services/projectService";
import { listCodexEntries } from "@/server/services/recordService";
import { CHAPTER_PROSE, createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("workspace and manuscript rename", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("renames a manuscript without changing chapter text", async () => {
    const updated = await renameProject(t.db, { projectId: IDS.project, title: "  Renamed novel  " });
    expect(updated.title).toBe("Renamed novel");
    const chapter = await t.db.record.findFirst({ where: { id: IDS.chapter } });
    expect(chapter?.body).toBe(CHAPTER_PROSE);
    const audit = await t.db.auditEntry.findMany({ where: { action: "project.rename" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.projectId).toBe(IDS.project);
  });

  it("writes one workspace rename audit for each live manuscript", async () => {
    await createProject(t.db, { id: "prj_second", workspaceId: IDS.workspace, title: "Second book" });
    await renameWorkspace(t.db, { workspaceId: IDS.workspace, name: "Shelf" });
    const audit = await t.db.auditEntry.findMany({ where: { action: "workspace.rename" }, orderBy: { projectId: "asc" } });
    expect(audit.map((row) => row.projectId)).toEqual(["prj_second", IDS.project].sort());
    const workspace = await t.db.workspace.findFirst({ where: { id: IDS.workspace } });
    expect(workspace?.name).toBe("Shelf");
  });

  it("rejects a blank name", async () => {
    await expect(renameProject(t.db, { projectId: IDS.project, title: "   " })).rejects.toThrow(/required/i);
  });

  it("lists reference titles for inline suggestions and skips chapters", async () => {
    const entries = await listCodexEntries(t.db, IDS.project);
    expect(entries.find((entry) => entry.id === IDS.dossier)?.aliases).toContain("Mara");
    expect(entries.some((entry) => entry.id === IDS.chapter)).toBe(false);
  });
});
