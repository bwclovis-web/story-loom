"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import {
  addMarginComment,
  clearSynopsis,
  deleteMarginComment,
  resolveMarginComment,
  upsertSynopsis,
} from "@/server/services/manuscriptAnnotationService";
function recordPage(projectId: string, recordId: string) {
  return `/projects/${projectId}/records/${recordId}`;
}

export async function saveSynopsisAction(projectId: string, recordId: string, body: string) {
  await upsertSynopsis(getDb(), projectId, recordId, body);
  revalidatePath(recordPage(projectId, recordId));
  revalidatePath(`/projects/${projectId}/write`);
}

export async function clearSynopsisAction(projectId: string, recordId: string) {
  await clearSynopsis(getDb(), projectId, recordId);
  revalidatePath(recordPage(projectId, recordId));
  revalidatePath(`/projects/${projectId}/write`);
}

export async function addMarginCommentAction(
  projectId: string,
  recordId: string,
  input: { passageStart: number; passageEnd: number; expectedRevision: number; body?: string },
) {
  await addMarginComment(getDb(), projectId, recordId, input);
  revalidatePath(recordPage(projectId, recordId));
}

export async function resolveMarginCommentAction(projectId: string, recordId: string, annotationId: string) {
  await resolveMarginComment(getDb(), projectId, annotationId);
  revalidatePath(recordPage(projectId, recordId));
}

export async function removeMarginCommentAction(projectId: string, recordId: string, annotationId: string) {
  await deleteMarginComment(getDb(), projectId, annotationId);
  revalidatePath(recordPage(projectId, recordId));
}