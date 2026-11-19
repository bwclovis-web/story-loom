"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { isLinkableReferenceType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import type { AuthorityStatus } from "@/domain/statuses";
import { listSections } from "@/writing/sections";
import { getDb } from "@/server/db";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import { listRecordImages } from "@/server/services/imageService";
import { linkReference, unlinkReference } from "@/server/services/linkService";
import {
  assignSceneLocation,
  listScenesForLocation,
  removeSceneLocation,
  setSceneLocationPrimary,
  type SceneListFilter,
  type SceneLocationCatalog,
  type SceneLocationSet,
} from "@/server/services/sceneLocationService";
import {
  addReadingPin,
  listReadingPins,
  removeReadingPin,
  reorderReadingPins,
  resolvePinScope,
  type ReadingPinView,
} from "@/server/services/readingPinService";
import { createRecord, getRecord, moveRecordInBook } from "@/server/services/recordService";
import { searchContextReferences, type ContextSearchHit } from "@/server/services/searchService";
import type { FormResult } from "../actions";

function failure(error: unknown): { ok: false; issues: Issue[] } {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

export type CreateManuscriptResult = { ok: true; recordId: string } | { ok: false; issues: Issue[] };

/** New chapter, or new scene inside a chapter. Starts as an empty draft; the editor opens it. */
export async function createManuscriptAction(
  projectId: string,
  input: { kind: "chapter" | "scene"; title: string; parentRecordId?: string; draftId?: string | null },
): Promise<CreateManuscriptResult> {
  try {
    const batch = await createRecord(getDb(), projectId, {
      type: input.kind === "chapter" ? "manuscript_chapter" : "manuscript_scene",
      title: input.title.trim(),
      body: "",
      authorityStatus: "draft",
      parentRecordId: input.kind === "scene" ? (input.parentRecordId ?? null) : null,
      draftId: input.draftId ?? null,
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
  | {
      ok: true;
      id: string;
      title: string;
      typeLabel: string;
      authorityStatus: AuthorityStatus;
      revision: number;
      body: string;
      sections: Array<{ id: string; title: string; level: number; start: number; end: number }>;
      images: Array<{ id: string; name: string; altText: string; caption: string }>;
    }
  | { ok: false; message: string };

/** A reference record's saved text, to read beside the scene. Manuscript records are not previewed here. */
export async function previewReferenceAction(projectId: string, recordId: string): Promise<ReferencePreview> {
  try {
    const db = getDb();
    const record = await getRecord(db, projectId, recordId);
    if (!isLinkableReferenceType(record.type)) return { ok: false, message: "Only reference records open here." };
    const images = await listRecordImages(db, projectId, recordId);
    return {
      ok: true,
      id: record.id,
      title: record.title,
      typeLabel: RECORD_TYPE_LABELS[record.type],
      authorityStatus: record.authorityStatus,
      revision: record.currentRevision,
      body: record.body,
      sections: listSections(record.body).map((s) => ({
        id: s.id,
        title: s.title,
        level: s.level,
        start: s.start,
        end: s.end,
      })),
      images: (images ?? []).map((img) => ({
        id: img.id,
        name: img.name,
        altText: img.altText,
        caption: img.caption,
      })),
    };
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, message: "That record is not in this project." };
    throw error;
  }
}

export async function searchContextReferencesAction(
  projectId: string,
  query: string,
): Promise<{ ok: true; hits: ContextSearchHit[] } | { ok: false; issues: Issue[] }> {
  try {
    const hits = await searchContextReferences(getDb(), { projectId, query });
    return { ok: true, hits };
  } catch (error) {
    return failure(error);
  }
}

export async function listReadingPinsAction(
  projectId: string,
  draftScopeId?: string | null,
): Promise<{ ok: true; scopeDraftId: string; pins: ReadingPinView[] } | { ok: false; issues: Issue[] }> {
  try {
    const db = getDb();
    const scopeDraftId = await resolvePinScope(db, projectId, draftScopeId);
    const pins = await listReadingPins(db, projectId, scopeDraftId);
    return { ok: true, scopeDraftId, pins };
  } catch (error) {
    return failure(error);
  }
}

export async function addReadingPinAction(
  projectId: string,
  recordId: string,
  draftScopeId?: string | null,
): Promise<FormResult & { pins?: ReadingPinView[]; scopeDraftId?: string }> {
  try {
    const db = getDb();
    const scopeDraftId = await resolvePinScope(db, projectId, draftScopeId);
    await addReadingPin(db, projectId, scopeDraftId, recordId);
    const pins = await listReadingPins(db, projectId, scopeDraftId);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, scopeDraftId, pins };
  } catch (error) {
    return failure(error);
  }
}

export async function removeReadingPinAction(
  projectId: string,
  recordId: string,
  draftScopeId?: string | null,
): Promise<FormResult & { pins?: ReadingPinView[]; scopeDraftId?: string }> {
  try {
    const db = getDb();
    const scopeDraftId = await resolvePinScope(db, projectId, draftScopeId);
    await removeReadingPin(db, projectId, scopeDraftId, recordId);
    const pins = await listReadingPins(db, projectId, scopeDraftId);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, scopeDraftId, pins };
  } catch (error) {
    return failure(error);
  }
}

function revalidateSceneLocations(projectId: string, manuscriptRecordId: string) {
  revalidatePath(`/projects/${projectId}/records/${manuscriptRecordId}`);
  revalidatePath(`/projects/${projectId}/world/maps`);
}

export async function assignSceneLocationAction(
  projectId: string,
  manuscriptRecordId: string,
  locationRecordId: string,
  input: { isPrimary: boolean; expectedFingerprint: string },
): Promise<{ ok: true; set: SceneLocationSet } | { ok: false; issues: Issue[] }> {
  try {
    const set = await assignSceneLocation(getDb(), projectId, manuscriptRecordId, locationRecordId, input);
    revalidateSceneLocations(projectId, manuscriptRecordId);
    return { ok: true, set };
  } catch (error) {
    return failure(error);
  }
}

export async function setSceneLocationPrimaryAction(
  projectId: string,
  manuscriptRecordId: string,
  assignmentId: string,
  input: { isPrimary: boolean; expectedFingerprint: string },
): Promise<{ ok: true; set: SceneLocationSet } | { ok: false; issues: Issue[] }> {
  try {
    const set = await setSceneLocationPrimary(getDb(), projectId, manuscriptRecordId, assignmentId, input);
    revalidateSceneLocations(projectId, manuscriptRecordId);
    return { ok: true, set };
  } catch (error) {
    return failure(error);
  }
}

export async function removeSceneLocationAction(
  projectId: string,
  manuscriptRecordId: string,
  assignmentId: string,
  expectedFingerprint: string,
): Promise<{ ok: true; set: SceneLocationSet } | { ok: false; issues: Issue[] }> {
  try {
    const set = await removeSceneLocation(getDb(), projectId, manuscriptRecordId, assignmentId, expectedFingerprint);
    revalidateSceneLocations(projectId, manuscriptRecordId);
    return { ok: true, set };
  } catch (error) {
    return failure(error);
  }
}

export async function listScenesAtLocationAction(
  projectId: string,
  locationRecordId: string,
  filter: SceneListFilter,
): Promise<{ ok: true; catalog: SceneLocationCatalog } | { ok: false; issues: Issue[] }> {
  try {
    const catalog = await listScenesForLocation(getDb(), projectId, locationRecordId, filter);
    return { ok: true, catalog };
  } catch (error) {
    return failure(error);
  }
}

export async function reorderReadingPinsAction(
  projectId: string,
  recordIds: string[],
  draftScopeId?: string | null,
): Promise<FormResult & { pins?: ReadingPinView[]; scopeDraftId?: string }> {
  try {
    const db = getDb();
    const scopeDraftId = await resolvePinScope(db, projectId, draftScopeId);
    const pins = await reorderReadingPins(db, projectId, scopeDraftId, recordIds);
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, scopeDraftId, pins };
  } catch (error) {
    return failure(error);
  }
}
