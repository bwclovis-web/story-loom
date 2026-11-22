"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, hasErrors, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import {
  applyChapterImport,
  previewChapterImport,
  type ChapterFile,
  type ChapterFilePreview,
  type ChapterImportItem,
  type ChapterImportOutcome,
} from "@/server/services/chapterImportService";
import {
  applyMarkdownImport,
  previewMarkdownImport,
  type MarkdownFile,
  type MarkdownImportItem,
  type MarkdownImportOutcome,
  type MarkdownImportPreview,
} from "@/server/services/markdownImportService";
import { parseScrivenerPackage, type ScrivenerUnsupportedItem } from "@/server/services/scrivenerImportService";

export interface ScrivenerPreviewPayload {
  projectTitle: string | null;
  chapters: ChapterFile[];
  chapterPreview: ChapterFilePreview[];
  references: MarkdownFile[];
  referencePreview: MarkdownImportPreview | null;
  unsupported: ScrivenerUnsupportedItem[];
  issues: Issue[];
}

function decodeBase64(data: string): Buffer {
  return Buffer.from(data, "base64");
}

export async function previewScrivenerAction(projectId: string, base64: string, tidy: boolean): Promise<ScrivenerPreviewPayload> {
  if (typeof base64 !== "string" || !base64) {
    return {
      projectTitle: null,
      chapters: [],
      chapterPreview: [],
      references: [],
      referencePreview: null,
      unsupported: [],
      issues: [errorIssue("IMPORT_INVALID", "The Scrivener archive could not be read.")],
    };
  }
  const parsed = await parseScrivenerPackage(decodeBase64(base64));
  if (hasErrors(parsed.issues)) {
    return {
      projectTitle: parsed.projectTitle,
      chapters: [],
      chapterPreview: [],
      references: [],
      referencePreview: null,
      unsupported: parsed.unsupported,
      issues: parsed.issues,
    };
  }
  const chapterPreview = parsed.chapters.length
    ? await previewChapterImport(getDb(), projectId, parsed.chapters, { tidy: tidy === true })
    : [];
  const referencePreview = parsed.references.length ? await previewMarkdownImport(getDb(), projectId, parsed.references) : null;
  return {
    projectTitle: parsed.projectTitle,
    chapters: parsed.chapters,
    chapterPreview,
    references: parsed.references,
    referencePreview,
    unsupported: parsed.unsupported,
    issues: parsed.issues,
  };
}

export async function applyScrivenerAction(
  projectId: string,
  input: {
    chapters: ChapterImportItem[];
    confirmProtectedChapters: boolean;
    tidy: boolean;
    references: MarkdownImportItem[];
    confirmProtectedReferences: boolean;
  },
): Promise<{ chapters: ChapterImportOutcome | null; references: MarkdownImportOutcome | null; issues: Issue[] }> {
  const issues: Issue[] = [];
  let chapters: ChapterImportOutcome | null = null;
  let references: MarkdownImportOutcome | null = null;

  if (input.chapters.length) {
    chapters = await applyChapterImport(getDb(), {
      projectId,
      items: input.chapters,
      confirmProtectedReplacements: input.confirmProtectedChapters === true,
      tidy: input.tidy === true,
      sourceKind: "scrivener_import",
    });
    if (chapters.status === "rejected") {
      return { chapters, references: null, issues: chapters.issues };
    }
  }

  if (input.references.length) {
    references = await applyMarkdownImport(getDb(), {
      projectId,
      items: input.references,
      conversationLabel: "scrivener import",
      confirmProtectedReplacements: input.confirmProtectedReferences === true,
    });
    if (references.status === "rejected") {
      return { chapters, references, issues: references.issues };
    }
  }

  if ((!chapters || chapters.status === "applied") && (!references || references.status === "applied")) {
    revalidatePath(`/projects/${projectId}`, "layout");
  }
  return { chapters, references, issues };
}
