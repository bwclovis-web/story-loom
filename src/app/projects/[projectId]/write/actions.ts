"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { isLinkableReferenceType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import type { AuthorityStatus } from "@/domain/statuses";
import { getDb } from "@/server/db";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import { linkReference, unlinkReference } from "@/server/services/linkService";
import { createRecord, getRecord, moveRecordInBook } from "@/server/services/recordService";
import type { FormResult } from "../actions";

function failure(error: unknown): { ok: false; issues: Issue[] } {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

export type CreateManuscriptResult = { ok: true; recordId: string } | { ok: false; issues: Issue[] };

/** New chapter, or new scene inside a chapter. Starts as an empty draft; the editor opens it. */
export async function createManuscriptAction(
  projectId: string,
  input: { kind: "chapter" | "scene"; title: string; parentRecordId?: string },
): Promise<CreateManuscriptResult> {
  try {
    const batch = await createRecord(getDb(), projectId, {
      type: input.kind === "chapter" ? "manuscript_chapter" : "manuscript_scene",
      title: input.title.trim(),
      body: "",
      authorityStatus: "draft",
      parentRecordId: input.kind === "scene" ? (input.parentRecordId ?? null) : null,
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, recordId: batch.outcomes[0].recordId };
  } catch (error) {
    return failure(error);
  }
}

export type MoveInBookActionResult = { ok: true; moved: boolean; position: number; of: number } | { ok: false; issues: Issue[] };

/** Moves a chapter among chapters, or a scene within or into a chapter. Changes no text. */
export async function moveInBookAction(
  projectId: string,
  input: { recordId: string; parentRecordId: string | null; index: number },
): Promise<MoveInBookActionResult> {
  try {
    const result = await moveRecordInBook(getDb(), projectId, input);
    if (result.moved) revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

export async function createNoteAction(projectId: string, parentRecordId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  try {
    await createRecord(getDb(), projectId, {
      type: "scene_note",
      title: String(formData.get("title") ?? "").trim(),
      body: String(formData.get("body") ?? ""),
      authorityStatus: "draft",
      parentRecordId,
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, message: "Note saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function linkReferenceAction(projectId: string, fromRecordId: string, toRecordId: string): Promise<FormResult> {
  try {
    await linkReference(getDb(), projectId, fromRecordId, toRecordId);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function unlinkReferenceAction(projectId: string, fromRecordId: string, toRecordId: string): Promise<FormResult> {
  try {
    await unlinkReference(getDb(), projectId, fromRecordId, toRecordId);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export type ReferencePreview =
  | { ok: true; id: string; title: string; typeLabel: string; authorityStatus: AuthorityStatus; revision: number; body: string }
  | { ok: false; message: string };

/** A reference record's saved text, to read beside the scene. Manuscript records are not previewed here. */
export async function previewReferenceAction(projectId: string, recordId: string): Promise<ReferencePreview> {
  try {
    const record = await getRecord(getDb(), projectId, recordId);
    if (!isLinkableReferenceType(record.type)) return { ok: false, message: "Only reference records open here." };
    return {
      ok: true,
      id: record.id,
      title: record.title,
      typeLabel: RECORD_TYPE_LABELS[record.type],
      authorityStatus: record.authorityStatus,
      revision: record.currentRevision,
      body: record.body,
    };
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, message: "That record is not in this project." };
    throw error;
  }
}
