import "server-only";
import { toRecordView, type RecordView } from "@/domain/records";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import type { DbOrTx } from "../db";
import { NotFoundError } from "./errors";
import { listRecordNav } from "./recordService";
import { LIVE_PROJECT } from "./trashFilters";

export interface ManuscriptExportScene {
  id: string;
  title: string;
  record: RecordView;
}

export interface ManuscriptExportChapter {
  id: string;
  title: string;
  record: RecordView;
  scenes: ManuscriptExportScene[];
}

export interface ManuscriptExportModel {
  projectId: string;
  projectTitle: string;
  generatedAt: Date;
  sceneTitles: boolean;
  chapters: ManuscriptExportChapter[];
  unplacedScenes: ManuscriptExportScene[];
}

export function exportDateStamp(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function exportSlug(text: string): string {
  const s = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return s || "project";
}

async function projectTitle(db: DbOrTx, projectId: string): Promise<string> {
  const project = await db.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT }, select: { title: true } });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);
  return project.title;
}

/** Saved manuscript chapters and scenes in Write order for PDF, DOCX, and EPUB. */
export async function buildManuscriptExportModel(
  db: DbOrTx,
  projectId: string,
  options: { sceneTitles: boolean; draftId?: string | null; hasDrafts?: boolean },
  now = new Date(),
): Promise<ManuscriptExportModel> {
  const title = await projectTitle(db, projectId);
  const tree = buildManuscriptTree(
    await listRecordNav(db, projectId, { draftId: options.draftId, hasDrafts: options.hasDrafts }),
  );
  if (!tree.chapters.length && !tree.unplaced.length) throw new NotFoundError("This project has no chapters yet.");
  const ids = [...tree.chapters.flatMap((c) => [c.id, ...c.scenes.map((s) => s.id)]), ...tree.unplaced.map((s) => s.id)];
  const rows = await db.record.findMany({ where: { projectId, id: { in: ids }, trashedAt: null } });
  const byId = new Map(rows.map((r) => [r.id, toRecordView(r)]));

  const scene = (id: string, nodeTitle: string): ManuscriptExportScene | null => {
    const record = byId.get(id);
    return record ? { id, title: nodeTitle, record } : null;
  };

  const chapters: ManuscriptExportChapter[] = [];
  for (const chapter of tree.chapters) {
    const record = byId.get(chapter.id);
    if (!record) continue;
    chapters.push({
      id: chapter.id,
      title: chapter.title,
      record,
      scenes: chapter.scenes.flatMap((s) => {
        const row = scene(s.id, s.title);
        return row ? [row] : [];
      }),
    });
  }

  return {
    projectId,
    projectTitle: title,
    generatedAt: now,
    sceneTitles: options.sceneTitles,
    chapters,
    unplacedScenes: tree.unplaced.flatMap((s) => {
      const row = scene(s.id, s.title);
      return row ? [row] : [];
    }),
  };
}