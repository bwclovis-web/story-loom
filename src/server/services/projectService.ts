import { newId } from "@/domain/ids";
import { MANUSCRIPT_TYPES } from "@/domain/recordTypes";
import type { ProjectSummary } from "@/ui/navigation";
import { countWords } from "@/writing/wordCount";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { NotFoundError } from "./errors";
import { LIVE_PROJECT } from "./trashFilters";

export async function createWorkspace(db: Db, input: { name: string; id?: string }) {
  const name = input.name.trim();
  if (!name) throw new Error("Workspace name is required");
  return db.workspace.create({ data: { id: input.id ?? newId("wsp"), name } });
}

export async function createProject(
  db: Db,
  input: { workspaceId: string; title: string; id?: string; actor?: string },
) {
  const title = input.title.trim();
  if (!title) throw new Error("Project title is required");
  return db.$transaction(async (tx) => {
    const workspace = await tx.workspace.findFirst({ where: { id: input.workspaceId, trashedAt: null } });
    if (!workspace) throw new NotFoundError(`Workspace ${input.workspaceId} not found`);
    const project = await tx.project.create({
      data: { id: input.id ?? newId("prj"), workspaceId: workspace.id, title },
    });
    await writeAudit(tx, {
      projectId: project.id,
      action: "project.create",
      actor: input.actor ?? "author",
      summary: `Created project "${title}"`,
      details: { projectId: project.id, workspaceId: workspace.id },
    });
    return project;
  });
}

/** Workspaces and projects outside the Trash. */
export async function listWorkspacesWithProjects(db: DbOrTx) {
  return db.workspace.findMany({
    where: { trashedAt: null },
    orderBy: { createdAt: "asc" },
    include: { projects: { where: { trashedAt: null }, orderBy: { createdAt: "asc" } } },
  });
}

/** Every project with its record count, chapter count and saved manuscript word total. */
export async function listProjectSummaries(db: DbOrTx): Promise<ProjectSummary[]> {
  const [workspaces, recordCounts, chapters] = await Promise.all([
    listWorkspacesWithProjects(db),
    db.record.groupBy({ by: ["projectId"], where: { trashedAt: null }, _count: { _all: true } }),
    db.record.findMany({
      where: { type: { in: [...MANUSCRIPT_TYPES] }, trashedAt: null },
      select: { projectId: true, type: true, body: true },
    }),
  ]);
  const records = new Map(recordCounts.map((r) => [r.projectId, r._count._all]));
  const chapterCounts = new Map<string, number>();
  const words = new Map<string, number>();
  for (const c of chapters) {
    if (c.type === "manuscript_chapter") chapterCounts.set(c.projectId, (chapterCounts.get(c.projectId) ?? 0) + 1);
    words.set(c.projectId, (words.get(c.projectId) ?? 0) + countWords(c.body));
  }
  return workspaces.flatMap((w) =>
    w.projects.map((p) => ({
      id: p.id,
      title: p.title,
      workspaceId: w.id,
      workspaceName: w.name,
      recordCount: records.get(p.id) ?? 0,
      chapterCount: chapterCounts.get(p.id) ?? 0,
      manuscriptWords: words.get(p.id) ?? 0,
    })),
  );
}

const NAME_MAX = 200;

function requiredName(value: string, label: string): string {
  const name = value.trim();
  if (!name) throw new Error(`${label} is required`);
  if (name.length > NAME_MAX) throw new Error(`${label} is too long`);
  return name;
}

/** Renames a workspace. Each live manuscript in it gets an audit row. */
export async function renameWorkspace(db: Db, input: { workspaceId: string; name: string; actor?: string }) {
  const name = requiredName(input.name, "Workspace name");
  const actor = input.actor ?? "author";
  return db.$transaction(async (tx) => {
    const workspace = await tx.workspace.findFirst({
      where: { id: input.workspaceId, trashedAt: null },
      include: { projects: { where: { trashedAt: null }, select: { id: true } } },
    });
    if (!workspace) throw new NotFoundError(`Workspace ${input.workspaceId} not found`);
    if (workspace.name === name) return workspace;
    const updated = await tx.workspace.update({ where: { id: workspace.id }, data: { name } });
    for (const project of workspace.projects) {
      await writeAudit(tx, {
        projectId: project.id,
        action: "workspace.rename",
        actor,
        summary: `Renamed workspace from "${workspace.name}" to "${name}"`,
        details: { workspaceId: workspace.id, from: workspace.name, to: name },
      });
    }
    return updated;
  });
}

/** Renames a manuscript. Audited on that project. Record text is unchanged. */
export async function renameProject(db: Db, input: { projectId: string; title: string; actor?: string }) {
  const title = requiredName(input.title, "Manuscript title");
  const actor = input.actor ?? "author";
  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: input.projectId, ...LIVE_PROJECT } });
    if (!project) throw new NotFoundError(`Project ${input.projectId} not found`);
    if (project.title === title) return project;
    const updated = await tx.project.update({ where: { id: project.id }, data: { title } });
    await writeAudit(tx, {
      projectId: project.id,
      action: "project.rename",
      actor,
      summary: `Renamed manuscript from "${project.title}" to "${title}"`,
      details: { projectId: project.id, from: project.title, to: title },
    });
    return updated;
  });
}

/** Projects in the Trash, or in a workspace in the Trash, are not found. */
export async function getProject(db: DbOrTx, projectId: string) {
  const project = await findProject(db, projectId);
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);
  return project;
}

/** Sibling books in the same series (same workspace + seriesName). Empty when series is unset. */
export async function listSeriesBookProjects(
  db: DbOrTx,
  projectId: string,
): Promise<Array<{ id: string; title: string; bookName: string | null }>> {
  const project = await findProject(db, projectId);
  if (!project?.seriesName) return [];
  const rows = await db.project.findMany({
    where: {
      workspaceId: project.workspaceId,
      seriesName: project.seriesName,
      trashedAt: null,
    },
    select: { id: true, title: true, bookName: true },
    orderBy: [{ bookName: "asc" }, { title: "asc" }, { id: "asc" }],
  });
  return rows;
}

export async function findProject(db: DbOrTx, projectId: string) {
  return db.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT }, include: { workspace: true } });
}
