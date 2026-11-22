"use server";

import { revalidatePath } from "next/cache";
import { errorIssue } from "@/domain/issues";
import { getDb } from "@/server/db";
import {
  applyDocxReview,
  previewDocxReview,
  type DocxReviewOutcome,
  type DocxReviewPreview,
} from "@/server/services/docxReviewService";

function decodeBase64(data: string): Buffer {
  return Buffer.from(data, "base64");
}

export async function previewDocxReviewAction(
  projectId: string,
  filename: string,
  base64: string,
): Promise<DocxReviewPreview> {
  if (typeof filename !== "string" || typeof base64 !== "string" || !base64) {
    return {
      filename: filename || "document.docx",
      chapters: [],
      unmatchedComments: [],
      hasTrackedChanges: false,
      requiresProtectedConfirmation: false,
      issues: [errorIssue("IMPORT_INVALID", "The Word file could not be read.")],
    };
  }
  return previewDocxReview(getDb(), projectId, { filename, bytes: decodeBase64(base64) });
}

export async function applyDocxReviewAction(
  projectId: string,
  input: {
    filename: string;
    base64: string;
    acceptIndexes: number[];
    importComments: boolean;
    confirmProtected: boolean;
  },
): Promise<DocxReviewOutcome> {
  if (typeof input.filename !== "string" || typeof input.base64 !== "string") {
    return { status: "rejected", issues: [errorIssue("IMPORT_INVALID", "The Word file could not be read.")] };
  }
  const outcome = await applyDocxReview(getDb(), {
    projectId,
    filename: input.filename,
    bytes: decodeBase64(input.base64),
    acceptIndexes: Array.isArray(input.acceptIndexes) ? input.acceptIndexes.filter((n) => Number.isInteger(n)) : [],
    importComments: input.importComments === true,
    confirmProtected: input.confirmProtected === true,
  });
  if (outcome.status === "applied") revalidatePath(`/projects/${projectId}`, "layout");
  return outcome;
}
