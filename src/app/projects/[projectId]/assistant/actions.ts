"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { applyProposal, getProposalReview } from "@/server/services/assistantProposalService";
import { AssistantError, createConversation, deleteConversation, getManuscriptText } from "@/server/services/assistantService";
import type { ApplyOutcome, PackagePreview } from "@/server/services/changePackageService";
import { MutationRejectedError } from "@/server/services/errors";

export async function newConversationAction(projectId: string): Promise<void> {
  const { id } = await createConversation(getDb(), projectId);
  redirect(`/projects/${projectId}/assistant?c=${id}`);
}

export async function deleteConversationAction(projectId: string, conversationId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await deleteConversation(getDb(), projectId, conversationId);
  } catch (error) {
    if (error instanceof AssistantError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath(`/projects/${projectId}/assistant`);
  return { ok: true };
}

/** The explicit Apply on one prepared proposal, identified by ID and reviewed content hash. */
export async function applyProposalAction(
  projectId: string,
  proposalId: string,
  contentHash: string,
  confirmCanon: boolean,
): Promise<{ ok: true; outcome: ApplyOutcome } | { ok: false; message: string }> {
  if (typeof proposalId !== "string" || typeof contentHash !== "string") return { ok: false, message: "Invalid proposal." };
  try {
    const outcome = await applyProposal(getDb(), { projectId, proposalId, contentHash, confirmCanon: confirmCanon === true });
    if (outcome.status === "applied") revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, outcome };
  } catch (error) {
    if (error instanceof AssistantError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Checks a proposal again against the current records. Never writes. */
export async function refreshProposalAction(
  projectId: string,
  proposalId: string,
): Promise<{ ok: true; preview: PackagePreview } | { ok: false; message: string }> {
  if (typeof proposalId !== "string") return { ok: false, message: "Invalid proposal." };
  try {
    return { ok: true, preview: (await getProposalReview(getDb(), projectId, proposalId)).preview };
  } catch (error) {
    if (error instanceof AssistantError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function loadManuscriptAction(projectId: string, recordId: string) {
  try {
    return { ok: true as const, ...(await getManuscriptText(getDb(), projectId, recordId)) };
  } catch (error) {
    if (error instanceof AssistantError) return { ok: false as const, message: error.message };
    throw error;
  }
}

export async function findRelevantContextAction(
  projectId: string,
  input: {
    question: string;
    manuscript: {
      recordId: string;
      start?: number;
      end?: number;
      unsavedBody?: string | null;
    } | null;
    draftScopeId?: string | null;
    includePinnedZeroDraft: boolean;
  },
) {
  try {
    const { findRelevantContext } = await import("@/server/services/findRelevantContextService");
    const result = await findRelevantContext(getDb(), {
      projectId,
      question: input.question,
      manuscript: input.manuscript,
      draftScopeId: input.draftScopeId,
      includePinnedZeroDraft: input.includePinnedZeroDraft,
    });
    return { ok: true as const, ...result };
  } catch (error) {
    if (error instanceof AssistantError) return { ok: false as const, message: error.message };
    if (error instanceof MutationRejectedError) {
      return { ok: false as const, message: error.issues.map((i) => i.message).join(" ") };
    }
    return { ok: false as const, message: (error as Error).message };
  }
}
