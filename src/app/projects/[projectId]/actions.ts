"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isRecordType, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus } from "@/domain/statuses";
import { errorIssue, type Issue } from "@/domain/issues";
import { parseJsonObject, type JsonObject } from "@/domain/json";
import { getDb } from "@/server/db";
import { MutationRejectedError } from "@/server/services/errors";
import {
  applyChangePackage,
  previewChangePackage,
  type ApplyOutcome,
  type PackagePreview,
} from "@/server/services/changePackageService";
import { findSourceConversation, type SourceConversation } from "@/server/services/assistantProposalService";
import { exportContextBundle } from "@/server/services/contextExportService";
import {
  applyMarkdownImport,
  previewMarkdownImport,
  type MarkdownFile,
  type MarkdownImportItem,
  type MarkdownImportOutcome,
  type MarkdownImportPreview,
} from "@/server/services/markdownImportService";
import {
  createRecord,
  getRecord,
  moveRecordToTrash,
  setAuthorityStatus,
  restoreRecordFromRevision,
  setProtection,
  updateRecord,
} from "@/server/services/recordService";
import { resolveReviewItem } from "@/server/services/reviewService";
import { trashProject } from "@/server/services/trashService";
import { groupOfType } from "@/ui/navigation";
import { isWorldType } from "@/ui/world";
import { isReferenceTemplateKey, referenceTemplate, scaffoldBody } from "@/world/referenceTemplates";

export interface FormResult {
  ok: boolean;
  message?: string;
  issues?: Issue[];
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function parseFields(text: string): JsonObject {
  return text.trim() ? parseJsonObject(text) : {};
}

function failure(error: unknown): FormResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

export async function createRecordAction(projectId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const type = str(formData, "type");
  const status = str(formData, "authorityStatus");
  if (!isRecordType(type) || !isAuthorityStatus(status)) return { ok: false, message: "Invalid type or status" };
  let body = str(formData, "body");
  const outline = str(formData, "outline");
  if (isWorldType(type) && isReferenceTemplateKey(outline) && body.trim() === "") {
    body = scaffoldBody(referenceTemplate(outline));
  }
  let recordId: string;
  try {
    const batch = await createRecord(getDb(), projectId, {
      type,
      title: str(formData, "title"),
      body,
      fields: parseFields(str(formData, "fields")),
      authorityStatus: status,
    });
    recordId = batch.outcomes[0].recordId;
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/projects/${projectId}`);
  redirect(`/projects/${projectId}/records/${recordId}`);
}

export async function restoreRecordAction(
  projectId: string,
  recordId: string,
  fromRevisionNumber: number,
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  try {
    const batch = await restoreRecordFromRevision(getDb(), projectId, {
      recordId,
      expectedRevision: Number(str(formData, "expectedRevision")),
      fromRevisionNumber,
      includeFields: formData.get("includeFields") === "on",
      unlockProtected: formData.get("unlockProtected") === "on",
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    return {
      ok: true,
      message: `Restored revision ${fromRevisionNumber} as revision ${batch.outcomes[0]!.newRevision}. Earlier versions are unchanged.`,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function saveRecordAction(
  projectId: string,
  recordId: string,
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  try {
    const status = str(formData, "authorityStatus");
    const batch = await updateRecord(getDb(), projectId, {
      recordId,
      expectedRevision: Number(str(formData, "expectedRevision")),
      title: str(formData, "title"),
      body: str(formData, "body"),
      fields: parseFields(str(formData, "fields")),
      authorityStatus: isAuthorityStatus(status) ? status : undefined,
      unlockProtected: formData.get("unlockProtected") === "on",
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, message: `Saved as revision ${batch.outcomes[0].newRevision}.` };
  } catch (error) {
    return failure(error);
  }
}

export async function setStatusAction(
  projectId: string,
  recordId: string,
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const status = str(formData, "status");
  if (!isAuthorityStatus(status)) return { ok: false, message: "Invalid status" };
  try {
    const batch = await setAuthorityStatus(getDb(), projectId, {
      recordId,
      expectedRevision: Number(str(formData, "expectedRevision")),
      status,
      supersededBy: str(formData, "supersededBy").trim() || null,
      unlockProtected: formData.get("unlockProtected") === "on",
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, message: `Status set; now revision ${batch.outcomes[0].newRevision}.` };
  } catch (error) {
    return failure(error);
  }
}

export async function setProtectionAction(projectId: string, recordId: string, formData: FormData) {
  await setProtection(getDb(), projectId, recordId, formData.get("protected") === "true");
  revalidatePath(`/projects/${projectId}`, "layout");
}

/** Moves the record (with any scenes and notes inside it) to the Trash, then opens its list page. */
export async function trashRecordAction(projectId: string, recordId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  let destination: string;
  try {
    const db = getDb();
    const record = await getRecord(db, projectId, recordId);
    await moveRecordToTrash(db, projectId, recordId, formData.get("unlockProtected") === "on");
    destination = `/projects/${projectId}/${groupOfType(record.type)}`;
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/", "layout");
  redirect(destination);
}

export async function trashProjectAction(projectId: string): Promise<FormResult> {
  try {
    await trashProject(getDb(), { projectId, actor: "author" });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/", "layout");
  redirect("/");
}

export async function previewPackageAction(projectId: string, raw: string): Promise<PackagePreview> {
  return previewChangePackage(getDb(), raw, { projectId });
}

/** Preview plus the in-app conversation the package came from, if it names one in this project. */
export async function reviewPackageAction(
  projectId: string,
  raw: string,
): Promise<{ preview: PackagePreview; conversation: SourceConversation | null }> {
  const db = getDb();
  const preview = await previewChangePackage(db, raw, { projectId });
  const conversation = await findSourceConversation(db, projectId, preview.header?.source?.conversationLabel);
  return { preview, conversation };
}

export async function applyPackageAction(
  projectId: string,
  raw: string,
  confirmProtected: boolean,
): Promise<ApplyOutcome> {
  const outcome = await applyChangePackage(getDb(), raw, { projectId }, { confirmProtected });
  if (outcome.status === "applied") revalidatePath(`/projects/${projectId}`, "layout");
  return outcome;
}

export async function exportBundleAction(
  projectId: string,
  recordIds: string[],
  types: string[],
  includeSchema: boolean,
): Promise<string> {
  const bundle = await exportContextBundle(getDb(), projectId, {
    recordIds: recordIds.length ? recordIds : undefined,
    types: types.length ? types.filter((t): t is RecordType => isRecordType(t)) : undefined,
    includeSchema,
  });
  return JSON.stringify(bundle, null, 2);
}

export async function previewMarkdownAction(projectId: string, files: MarkdownFile[]): Promise<MarkdownImportPreview> {
  return previewMarkdownImport(getDb(), projectId, files);
}

export async function applyMarkdownAction(
  projectId: string,
  items: MarkdownImportItem[],
  conversationLabel: string,
  confirmProtectedReplacements: boolean,
): Promise<MarkdownImportOutcome> {
  const outcome = await applyMarkdownImport(getDb(), {
    projectId,
    items,
    conversationLabel: conversationLabel.trim() || null,
    confirmProtectedReplacements,
  });
  if (outcome.status === "applied") revalidatePath(`/projects/${projectId}`, "layout");
  return outcome;
}

export async function resolveReviewItemAction(projectId: string, reviewItemId: string) {
  await resolveReviewItem(getDb(), projectId, reviewItemId);
  revalidatePath(`/projects/${projectId}/history`);
}
