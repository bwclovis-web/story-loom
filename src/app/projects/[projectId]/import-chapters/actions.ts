"use server";

import { revalidatePath } from "next/cache";
import { errorIssue } from "@/domain/issues";
import { getDb } from "@/server/db";
import {
  applyChapterImport,
  previewChapterImport,
  type ChapterDecision,
  type ChapterFile,
  type ChapterFilePreview,
  type ChapterImportItem,
  type ChapterImportOutcome,
} from "@/server/services/chapterImportService";

/** Server actions can be called with anything, so the shape is checked before the service checks the content. */
function isFile(raw: unknown): raw is ChapterFile {
  if (typeof raw !== "object" || raw === null) return false;
  const { filename, content } = raw as Record<string, unknown>;
  return typeof filename === "string" && filename.length <= 500 && typeof content === "string";
}

function isDecision(raw: unknown): raw is ChapterDecision | undefined {
  if (raw === undefined) return true;
  if (typeof raw !== "object" || raw === null) return false;
  const d = raw as Record<string, unknown>;
  if (d.action === "create" || d.action === "skip") return true;
  return d.action === "replace" && typeof d.recordId === "string" && Number.isInteger(d.expectedRevision);
}

export async function previewChaptersAction(projectId: string, files: unknown, tidy: boolean): Promise<ChapterFilePreview[]> {
  if (!Array.isArray(files) || !files.every(isFile)) throw new Error("The files could not be read.");
  return previewChapterImport(getDb(), projectId, files, { tidy: tidy === true });
}

export async function importChaptersAction(
  projectId: string,
  items: unknown,
  confirmProtected: boolean,
  tidy: boolean,
): Promise<ChapterImportOutcome> {
  const ok =
    Array.isArray(items) &&
    items.every((i) => isFile(i) && typeof (i as { title?: unknown }).title === "string" && isDecision((i as { decision?: unknown }).decision));
  if (!ok) return { status: "rejected", issues: [errorIssue("IMPORT_INVALID", "The import could not be read. Nothing was written.")] };
  const outcome = await applyChapterImport(getDb(), {
    projectId,
    items: items as ChapterImportItem[],
    confirmProtectedReplacements: confirmProtected === true,
    tidy: tidy === true,
  });
  if (outcome.status === "applied") revalidatePath(`/projects/${projectId}`, "layout");
  return outcome;
}
