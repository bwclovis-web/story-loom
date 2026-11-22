"use server";

import { revalidatePath } from "next/cache";
import {
  acceptProfileSuggestions,
  acceptReviewNotes,
  loadCharacterDevelopment,
  saveCharacterDevelopment,
} from "@/server/services/characterDevelopmentService";
import {
  markProfileChecked,
  readCharacterDevelopment,
  type ProfileSuggestion,
  type ReviewObservation,
} from "@/domain/characterDevelopment";
import { sha256 } from "@/domain/json";
import { getDb } from "@/server/db";
import { MutationRejectedError, NotFoundError, StaleRevisionError } from "@/server/services/errors";
import { errorIssue, type Issue } from "@/domain/issues";
import type { FormResult } from "../../actions";

function failure(error: unknown): FormResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof StaleRevisionError) return { ok: false, issues: error.issues };
  if (error instanceof NotFoundError) return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", error.message)] };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", error instanceof Error ? error.message : "The profile could not be saved.")] };
}

export async function saveCharacterDevelopmentAction(
  projectId: string,
  recordId: string,
  expectedRevision: number,
  profileJson: string,
  unlockProtected: boolean,
  allowApprovedBookRewrite: boolean,
): Promise<FormResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(profileJson);
  } catch {
    return { ok: false, issues: [errorIssue("INVALID_JSON", "The profile was not valid JSON.")] };
  }
  const read = readCharacterDevelopment({ characterDevelopment: parsed as never });
  if (read.problems.length) {
    return { ok: false, issues: read.problems.map((problem) => errorIssue("INVALID_CHANGE", problem.message, { path: problem.path })) };
  }
  try {
    const saved = await saveCharacterDevelopment(getDb(), projectId, {
      recordId,
      expectedRevision,
      profile: read.profile,
      unlockProtected,
      allowApprovedBookRewrite,
    });
    revalidatePath(`/projects/${projectId}/records/${recordId}`);
    revalidatePath(`/projects/${projectId}/world/development`);
    return { ok: true, message: "Character development saved.", revision: saved.revision };
  } catch (error) {
    return failure(error);
  }
}

export async function acceptCharacterSuggestionsAction(
  projectId: string,
  recordId: string,
  expectedRevision: number,
  suggestions: ProfileSuggestion[],
  unlockProtected: boolean,
): Promise<FormResult> {
  try {
    const loaded = await loadCharacterDevelopment(getDb(), projectId, recordId);
    if (loaded.record.projectId !== projectId) {
      return { ok: false, message: "Edit this character from the book that holds the dossier." };
    }
    const profile = acceptProfileSuggestions(loaded.profile, suggestions);
    const saved = await saveCharacterDevelopment(getDb(), projectId, {
      recordId,
      expectedRevision,
      profile,
      unlockProtected,
    });
    revalidatePath(`/projects/${projectId}/records/${recordId}`);
    return { ok: true, message: "Suggestions saved as draft notes. They are not canon.", revision: saved.revision };
  } catch (error) {
    return failure(error);
  }
}

export async function acceptCharacterReviewAction(
  projectId: string,
  recordId: string,
  expectedRevision: number,
  observations: ReviewObservation[],
  unlockProtected: boolean,
): Promise<FormResult> {
  try {
    const loaded = await loadCharacterDevelopment(getDb(), projectId, recordId);
    if (loaded.record.projectId !== projectId) {
      return { ok: false, message: "Edit this character from the book that holds the dossier." };
    }
    const profile = acceptReviewNotes(loaded.profile, observations);
    const saved = await saveCharacterDevelopment(getDb(), projectId, {
      recordId,
      expectedRevision,
      profile,
      unlockProtected,
    });
    revalidatePath(`/projects/${projectId}/records/${recordId}`);
    return { ok: true, message: "Review notes saved for you to accept or ignore. The manuscript was not changed.", revision: saved.revision };
  } catch (error) {
    return failure(error);
  }
}

export async function markCharacterProfileCheckedAction(
  projectId: string,
  recordId: string,
  expectedRevision: number,
  unlockProtected: boolean,
): Promise<FormResult> {
  try {
    const loaded = await loadCharacterDevelopment(getDb(), projectId, recordId);
    if (loaded.record.projectId !== projectId) {
      return { ok: false, message: "Edit this character from the book that holds the dossier." };
    }
    const profile = markProfileChecked(loaded.profile, loaded.record.currentRevision, sha256(loaded.record.body));
    const saved = await saveCharacterDevelopment(getDb(), projectId, {
      recordId,
      expectedRevision,
      profile,
      unlockProtected,
    });
    revalidatePath(`/projects/${projectId}/records/${recordId}`);
    return { ok: true, message: "Profile checked against this dossier version.", revision: saved.revision };
  } catch (error) {
    return failure(error);
  }
}
