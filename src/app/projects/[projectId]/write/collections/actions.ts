"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import type { SmartCollectionFilter, SmartCollectionScope } from "@/domain/smartCollection";
import { getDb } from "@/server/db";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import {
  createSmartCollection,
  deleteSmartCollection,
  listSmartCollections,
  updateSmartCollection,
  type SmartCollectionView,
} from "@/server/services/smartCollectionService";

export interface CollectionActionResult {
  ok: boolean;
  message?: string;
  issues?: Issue[];
}

function failure(error: unknown): CollectionActionResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof NotFoundError) return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", error.message)] };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

function revalidateCollections(projectId: string) {
  revalidatePath(`/projects/${projectId}/write/collections`);
  revalidatePath(`/projects/${projectId}/write`);
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function listSmartCollectionsAction(
  projectId: string,
  scope?: SmartCollectionScope,
): Promise<SmartCollectionView[]> {
  return listSmartCollections(getDb(), projectId, scope);
}

export async function createSmartCollectionAction(
  projectId: string,
  input: { title: string; scope: SmartCollectionScope; filter: SmartCollectionFilter },
): Promise<CollectionActionResult & { collectionId?: string }> {
  try {
    const created = await createSmartCollection(getDb(), projectId, input);
    revalidateCollections(projectId);
    return { ok: true, message: "Collection saved.", collectionId: created.id };
  } catch (error) {
    return failure(error);
  }
}

export async function updateSmartCollectionAction(
  projectId: string,
  collectionId: string,
  input: { title?: string; filter?: SmartCollectionFilter },
): Promise<CollectionActionResult> {
  try {
    await updateSmartCollection(getDb(), projectId, collectionId, input);
    revalidateCollections(projectId);
    return { ok: true, message: "Collection updated." };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteSmartCollectionAction(projectId: string, collectionId: string): Promise<CollectionActionResult> {
  try {
    await deleteSmartCollection(getDb(), projectId, collectionId);
    revalidateCollections(projectId);
    return { ok: true, message: "Collection deleted." };
  } catch (error) {
    return failure(error);
  }
}