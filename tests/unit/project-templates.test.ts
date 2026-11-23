import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isProjectTemplateId, weavePresetForTemplate } from "@/domain/projectTemplates";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { applyProjectTemplate } from "@/server/services/projectTemplateService";
import { createTestDb, type TestDb } from "../helpers";

describe("project templates (Phase 4)", () => {
  let t: TestDb;
  let workspaceId: string;

  beforeEach(async () => {
    t = await createTestDb();
    const workspace = await createWorkspace(t.db, { name: "Template workspace" });
    workspaceId = workspace.id;
  });

  afterEach(() => t.cleanup());

  it("recognizes template ids and weave presets", () => {
    expect(isProjectTemplateId("novel")).toBe(true);
    expect(isProjectTemplateId("nope")).toBe(false);
    expect(weavePresetForTemplate("mystery")).toBe("mystery");
    expect(weavePresetForTemplate("novel")).toBeNull();
  });

  it("scaffolds a novel with one protected chapter", async () => {
    const project = await createProject(t.db, { workspaceId, title: "River Novel" });
    const applied = await applyProjectTemplate(t.db, project.id, "novel");
    expect(applied.templateId).toBe("novel");
    expect(applied.siblingProjectId).toBeNull();
    expect(applied.weaveGridId).toBeNull();

    const chapters = await t.db.record.findMany({
      where: { projectId: project.id, type: "manuscript_chapter", trashedAt: null },
    });
    expect(chapters).toHaveLength(1);
    expect(chapters[0]?.protected).toBe(true);
    expect(chapters[0]?.body).toContain("opening of your novel");
  });

  it("creates a sibling book for the series template", async () => {
    const project = await createProject(t.db, { workspaceId, title: "Saltmarsh Cycle" });
    const applied = await applyProjectTemplate(t.db, project.id, "series");
    expect(applied.siblingProjectId).toBeTruthy();

    const books = await t.db.project.findMany({
      where: { workspaceId, trashedAt: null },
      orderBy: { bookName: "asc" },
    });
    expect(books).toHaveLength(2);
    expect(books.every((book) => book.seriesName === "Saltmarsh Cycle")).toBe(true);
    expect(books.map((book) => book.bookName).sort()).toEqual(["Book One", "Book Two"]);
  });

  it("adds draft world stubs and a Weave grid for fantasy", async () => {
    const project = await createProject(t.db, { workspaceId, title: "Ashen Gate" });
    const applied = await applyProjectTemplate(t.db, project.id, "fantasy");
    expect(applied.weaveGridId).toBeTruthy();

    const types = await t.db.record.findMany({
      where: { projectId: project.id, trashedAt: null },
      select: { type: true, title: true, authorityStatus: true },
    });
    expect(types.some((row) => row.type === "manuscript_chapter")).toBe(true);
    expect(types.some((row) => row.type === "character_dossier" && row.authorityStatus === "draft")).toBe(true);
    expect(types.some((row) => row.type === "worldbuilding" && row.authorityStatus === "draft")).toBe(true);
    expect(await t.db.weaveGrid.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("defaults unknown templates to novel", async () => {
    const project = await createProject(t.db, { workspaceId, title: "Fallback" });
    const applied = await applyProjectTemplate(t.db, project.id, "not-a-template");
    expect(applied.templateId).toBe("novel");
    expect(await t.db.record.count({ where: { projectId: project.id, type: "manuscript_chapter" } })).toBe(1);
  });
});
