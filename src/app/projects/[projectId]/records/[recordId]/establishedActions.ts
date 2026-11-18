"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import {
  acceptEstablishedFact,
  addFactEvidence,
  clearRecheckFlag,
  dismissEstablishedFact,
  extractCandidateFactsFromSubject,
  isEvidenceKind,
  removeFactEvidence,
  runCharacterKnowledgeCheck,
  type CharacterKnowledgeCheckResult,
  type EstablishedFactView,
  type EvidenceKind,
  type FactEvidenceView,
} from "@/server/services/establishedFactService";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";

function failure(error: unknown): { ok: false; issues: Issue[] } {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof NotFoundError) return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", error.message)] };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

function revalidateSubject(projectId: string, recordId: string) {
  revalidatePath(`/projects/${projectId}/records/${recordId}`);
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function extractFactsAction(
  projectId: string,
  subjectRecordId: string,
  evidenceKind: string,
): Promise<{ ok: true; facts: EstablishedFactView[] } | { ok: false; issues: Issue[] }> {
  try {
    if (!isEvidenceKind(evidenceKind)) {
      return { ok: false, issues: [errorIssue("INVALID_REFERENCE", "Unknown evidence kind.")] };
    }
    const facts = await extractCandidateFactsFromSubject(getDb(), projectId, subjectRecordId, evidenceKind);
    revalidateSubject(projectId, subjectRecordId);
    return { ok: true, facts };
  } catch (error) {
    return failure(error);
  }
}

export async function acceptFactAction(
  projectId: string,
  factId: string,
  subjectRecordId: string,
): Promise<{ ok: true; fact: EstablishedFactView } | { ok: false; issues: Issue[] }> {
  try {
    const fact = await acceptEstablishedFact(getDb(), projectId, factId);
    revalidateSubject(projectId, subjectRecordId);
    return { ok: true, fact };
  } catch (error) {
    return failure(error);
  }
}

export async function dismissFactAction(
  projectId: string,
  factId: string,
  subjectRecordId: string,
): Promise<{ ok: true; fact: EstablishedFactView } | { ok: false; issues: Issue[] }> {
  try {
    const fact = await dismissEstablishedFact(getDb(), projectId, factId);
    revalidateSubject(projectId, subjectRecordId);
    return { ok: true, fact };
  } catch (error) {
    return failure(error);
  }
}

export async function addFactEvidenceAction(
  projectId: string,
  factId: string,
  subjectRecordId: string,
  input: { sourceRecordId: string; passageStart: number; passageEnd: number },
): Promise<{ ok: true; fact: EstablishedFactView } | { ok: false; issues: Issue[] }> {
  try {
    const fact = await addFactEvidence(getDb(), projectId, factId, input);
    revalidateSubject(projectId, subjectRecordId);
    return { ok: true, fact };
  } catch (error) {
    return failure(error);
  }
}

export async function removeFactEvidenceAction(
  projectId: string,
  evidenceId: string,
  subjectRecordId: string,
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  try {
    await removeFactEvidence(getDb(), projectId, evidenceId);
    revalidateSubject(projectId, subjectRecordId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function clearFactRecheckAction(
  projectId: string,
  evidenceId: string,
  subjectRecordId: string,
): Promise<{ ok: true; evidence: FactEvidenceView } | { ok: false; issues: Issue[] }> {
  try {
    const evidence = await clearRecheckFlag(getDb(), projectId, evidenceId);
    revalidateSubject(projectId, subjectRecordId);
    return { ok: true, evidence };
  } catch (error) {
    return failure(error);
  }
}

export async function runCharacterKnowledgeCheckAction(
  projectId: string,
  input: { subjectRecordId: string; sceneId: string; draftId: string | null },
): Promise<{ ok: true; result: CharacterKnowledgeCheckResult } | { ok: false; issues: Issue[] }> {
  try {
    const result = await runCharacterKnowledgeCheck(getDb(), projectId, input);
    return { ok: true, result };
  } catch (error) {
    return failure(error);
  }
}

export type { EvidenceKind };
