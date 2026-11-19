"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { applyProposal, getProposalReview } from "@/server/services/assistantProposalService";
import {
  AssistantError,
  createConversation,
  deleteConversation,
  getManuscriptText,
  updateAssistantSettings,
  updateConversationSummary,
} from "@/server/services/assistantService";
import type { ApplyOutcome, PackagePreview } from "@/server/services/changePackageService";
import { MutationRejectedError } from "@/server/services/errors";

export async function newConversationAction(projectId: string): Promise<void> {
  const { id } = await createConversation(getDb(), projectId);
  redirect(`/projects/${projectId}/assistant?c=${id}`);
}

/** Create a conversation without redirecting (Write assistant rail). */
export async function newConversationForRailAction(
  projectId: string,
): Promise<{ ok: true; id: string; title: string } | { ok: false; message: string }> {
  try {
    const { DEFAULT_CONVERSATION_TITLE } = await import("@/server/services/assistantService");
    const conv = await createConversation(getDb(), projectId);
    revalidatePath(`/projects/${projectId}/assistant`);
    return { ok: true, id: conv.id, title: DEFAULT_CONVERSATION_TITLE };
  } catch (error) {
    if (error instanceof AssistantError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Load conversation list + one conversation for the Write rail. */
export async function loadAssistantRailAction(projectId: string, conversationId: string | null) {
  try {
    const { getAssistantConfig } = await import("@/server/assistantConfig");
    const { getConversationView, listConversations } = await import("@/server/services/assistantService");
    const { listProposalViews } = await import("@/server/services/assistantProposalService");
    const db = getDb();
    const { status } = getAssistantConfig();
    const conversations = await listConversations(db, projectId);
    const activeId =
      conversationId && conversations.some((c) => c.id === conversationId) ? conversationId : (conversations[0]?.id ?? null);
    if (!activeId) {
      return {
        ok: true as const,
        conversations: [] as Array<{ id: string; title: string }>,
        conversation: null,
        proposals: {} as Awaited<ReturnType<typeof listProposalViews>>,
      };
    }
    const conversation = await getConversationView(db, projectId, activeId, status.limits);
    const proposals = await listProposalViews(db, projectId, activeId);
    return {
      ok: true as const,
      conversations: conversations.map((c) => ({ id: c.id, title: c.title })),
      conversation,
      proposals,
    };
  } catch (error) {
    if (error instanceof AssistantError) return { ok: false as const, message: error.message };
    throw error;
  }
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

export async function saveConversationSummaryAction(
  projectId: string,
  conversationId: string,
  summary: string,
): Promise<{ ok: true; summary: string } | { ok: false; message: string }> {
  try {
    const saved = await updateConversationSummary(getDb(), projectId, conversationId, summary);
    revalidatePath(`/projects/${projectId}/assistant`);
    return { ok: true, summary: saved };
  } catch (error) {
    if (error instanceof AssistantError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function saveAssistantSettingsAction(
  projectId: string,
  input: { autoIncludeRecent: boolean; recentContextBudgetChars: number },
): Promise<{ ok: true; settings: { autoIncludeRecent: boolean; recentContextBudgetChars: number } } | { ok: false; message: string }> {
  try {
    const settings = await updateAssistantSettings(getDb(), projectId, input);
    revalidatePath(`/projects/${projectId}/assistant`);
    return { ok: true, settings };
  } catch (error) {
    if (error instanceof AssistantError) return { ok: false, message: error.message };
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
