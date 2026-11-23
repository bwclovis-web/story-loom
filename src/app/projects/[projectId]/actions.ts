"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { WritingContextMode } from "@/domain/characterWritingContext";
import { isWorldScope } from "@/domain/assignments";
import { isRecordType, type RecordType } from "@/domain/recordTypes";
import { isAuthorityStatus } from "@/domain/statuses";
import { errorIssue, type Issue } from "@/domain/issues";
import { parseJsonObject, type JsonObject } from "@/domain/json";
import { getDb } from "@/server/db";
import { MutationRejectedError, StaleRevisionError } from "@/server/services/errors";
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
import { autosaveRecord } from "@/server/services/autosaveService";
import {
  createRecord,
  getRecord,
  moveRecordToTrash,
  setAuthorityStatus,
  restoreRecordFromRevision,
  setProtection,
  updateRecord,
} from "@/server/services/recordService";
import { labelRevision } from "@/server/services/revisionLabelService";
import { resolveReviewItem } from "@/server/services/reviewService";
import { trashProject } from "@/server/services/trashService";
import { groupOfType } from "@/ui/navigation";
import { isWorldType } from "@/ui/world";
import { isReferenceTemplateKey, referenceTemplate, scaffoldBody } from "@/world/referenceTemplates";
import { sanitizeWorldbuildingFields } from "@/world/worldKinds";

export interface FormResult {
  ok: boolean;
  message?: string;
  issues?: Issue[];
  /** Set after a successful save or autosave so the editor can advance expectedRevision. */
  revision?: number;
  coalesced?: boolean;
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "");
}

function parseFields(text: string, type?: RecordType): JsonObject {
  const fields = text.trim() ? parseJsonObject(text) : {};
  return type === "worldbuilding" ? sanitizeWorldbuildingFields(fields) : fields;
}

function failure(error: unknown): FormResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof StaleRevisionError) return { ok: false, issues: error.issues };
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
  // Empty means unassigned. Only World types may carry a scope; the mutation layer enforces it.
  const scopeText = str(formData, "worldScope");
  const worldScope = isWorldScope(scopeText) ? scopeText : null;
  let recordId: string;
  try {
    const batch = await createRecord(getDb(), projectId, {
      type,
      title: str(formData, "title"),
      body,
      // Taxonomy stays in the parsed fields for every World type; only worldbuilding is sanitized for kind.
      fields: parseFields(str(formData, "fields"), type),
      authorityStatus: status,
      worldScope,
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
    const existing = await getRecord(getDb(), projectId, recordId);
    const batch = await updateRecord(getDb(), projectId, {
      recordId,
      expectedRevision: Number(str(formData, "expectedRevision")),
      title: str(formData, "title"),
      body: str(formData, "body"),
      fields: parseFields(str(formData, "fields"), existing.type),
      authorityStatus: isAuthorityStatus(status) ? status : undefined,
      unlockProtected: formData.get("unlockProtected") === "on",
    });
    const revision = batch.outcomes[0].newRevision;
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, message: `Saved as revision ${revision}.`, revision };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Background save for unlocked manuscript records only. Protected records are
 * refused. Rapid calls within a few minutes coalesce into one tip revision.
 */
export async function autosaveRecordAction(
  projectId: string,
  recordId: string,
  input: { expectedRevision: number; title: string; body: string; fields: string },
): Promise<FormResult> {
  try {
    const existing = await getRecord(getDb(), projectId, recordId);
    const result = await autosaveRecord(getDb(), projectId, {
      recordId,
      expectedRevision: input.expectedRevision,
      title: input.title,
      body: input.body,
      fields: parseFields(input.fields, existing.type),
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    return {
      ok: true,
      revision: result.revision,
      coalesced: result.coalesced,
      message: result.coalesced
        ? `Autosaved (revision ${result.revision}).`
        : `Autosaved as revision ${result.revision}.`,
    };
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

/** Names an existing revision as a snapshot. Does not rewrite title, body, or fields. */
export async function labelRevisionAction(projectId: string, recordId: string, formData: FormData) {
  const revisionNumber = Number(str(formData, "revisionNumber"));
  const label = str(formData, "label").trim();
  await labelRevision(getDb(), projectId, {
    recordId,
    revisionNumber,
    label: label || null,
  });
  revalidatePath(`/projects/${projectId}`, "layout");
}

/** Turns protection on or off. Removing protection is confirmed in the UI first. */
export async function setProtectionAction(
  projectId: string,
  recordId: string,
  isProtected: boolean,
  _prev: FormResult,
  _formData: FormData,
): Promise<FormResult> {
  try {
    await setProtection(getDb(), projectId, recordId, isProtected);
    revalidatePath(`/projects/${projectId}`, "layout");
    return {
      ok: true,
      message: isProtected ? "This record is now protected." : "Protection removed.",
    };
  } catch (error) {
    return failure(error);
  }
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
  options?: {
    characterMode?: WritingContextMode;
    focusRecordId?: string | null;
    redactCharacterSpoilers?: boolean;
  },
): Promise<string> {
  const bundle = await exportContextBundle(getDb(), projectId, {
    recordIds: recordIds.length ? recordIds : undefined,
    types: types.length ? types.filter((t): t is RecordType => isRecordType(t)) : undefined,
    includeSchema,
    characterMode: options?.characterMode,
    focusRecordId: options?.focusRecordId || null,
    allowFuturePlans: options?.characterMode === "planning",
    redactCharacterSpoilers: options?.redactCharacterSpoilers === true,
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
