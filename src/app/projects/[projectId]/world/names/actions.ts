"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { defaultCaseSensitive } from "@/spelling/dictionary";
import { getDb } from "@/server/db";
import { addDictionaryEntry, DictionaryError } from "@/server/services/dictionaryService";
import { MutationRejectedError } from "@/server/services/errors";
import { createRecord } from "@/server/services/recordService";

function failure(error: unknown): { ok: false; issues: Issue[] } {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

export async function addGeneratedNameToDictionaryAction(
  projectId: string,
  input: { word: string; scope: "project" | "workspace" },
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  const word = input.word.trim();
  if (!word) return { ok: false, issues: [errorIssue("INVALID_CHANGE", "Choose a name to add.")] };
  try {
    await addDictionaryEntry(
      getDb(),
      projectId,
      { word, scope: input.scope, caseSensitive: defaultCaseSensitive(word), note: "" },
      "manual",
    );
    revalidatePath(`/projects/${projectId}/dictionary`);
    revalidatePath(`/projects/${projectId}/world/names`);
    return { ok: true };
  } catch (error) {
    if (error instanceof DictionaryError) {
      return { ok: false, issues: [errorIssue("INVALID_CHANGE", error.message)] };
    }
    return failure(error);
  }
}

export async function createDossierFromGeneratedNameAction(
  projectId: string,
  title: string,
): Promise<{ ok: true; recordId: string } | { ok: false; issues: Issue[] }> {
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, issues: [errorIssue("INVALID_CHANGE", "Choose a name to use.")] };
  try {
    const batch = await createRecord(getDb(), projectId, {
      type: "character_dossier",
      title: trimmed,
      body: "",
      fields: { name: trimmed },
      authorityStatus: "draft",
    });
    const recordId = batch.outcomes[0]?.recordId;
    if (!recordId) return { ok: false, issues: [errorIssue("INVALID_CHANGE", "The dossier was not created.")] };
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/world/names`);
    return { ok: true, recordId };
  } catch (error) {
    return failure(error);
  }
}