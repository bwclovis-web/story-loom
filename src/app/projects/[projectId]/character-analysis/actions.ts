"use server";

import { revalidatePath } from "next/cache";
import {
  CHARACTER_ANALYSIS_ACTIONS,
  CHARACTER_ANALYSIS_SCOPE_KINDS,
  type CharacterAnalysisAction,
  type CharacterAnalysisScopeKind,
  type CharacterAnalysisScopeSpec,
  type FindingDecisionAction,
} from "@/domain/characterAnalysis";
import { getDb } from "@/server/db";
import { getAssistantConfig } from "@/server/assistantConfig";
import { AssistantError } from "@/server/services/assistantService";
import {
  applyCharacterAnalysisDecisions,
  getCharacterAnalysis,
  previewCharacterAnalysis,
  requestFurtherAnalysis,
  saveCharacterAnalysisDecision,
} from "@/server/services/characterAnalysisService";
import { MutationRejectedError, NotFoundError, StaleRevisionError } from "@/server/services/errors";

export type AnalysisActionResult =
  | { ok: true; message?: string; preview?: Awaited<ReturnType<typeof previewCharacterAnalysis>>; run?: Awaited<ReturnType<typeof getCharacterAnalysis>>; runId?: string }
  | { ok: false; message: string };

function failure(error: unknown): AnalysisActionResult {
  if (error instanceof AssistantError) return { ok: false, message: error.message };
  if (error instanceof MutationRejectedError) return { ok: false, message: error.issues[0]?.message ?? "The change was rejected." };
  if (error instanceof StaleRevisionError) return { ok: false, message: error.issues[0]?.message ?? "The record changed. Reload and try again." };
  if (error instanceof NotFoundError) return { ok: false, message: error.message };
  return { ok: false, message: error instanceof Error ? error.message : "The action failed." };
}

function normalizeActions(actions: string[] | undefined): CharacterAnalysisAction[] | undefined {
  if (!actions?.length) return undefined;
  const allowed = new Set<string>(CHARACTER_ANALYSIS_ACTIONS);
  const next = actions.filter((item): item is CharacterAnalysisAction => allowed.has(item));
  return next.length ? next : undefined;
}

function normalizeScopeKind(scopeKind: string): CharacterAnalysisScopeKind | null {
  return (CHARACTER_ANALYSIS_SCOPE_KINDS as readonly string[]).includes(scopeKind)
    ? (scopeKind as CharacterAnalysisScopeKind)
    : null;
}

export async function previewCharacterAnalysisAction(
  projectId: string,
  input: {
    characterRecordIds: string[];
    scopeKind: string;
    scopeSpec?: CharacterAnalysisScopeSpec;
    actions?: string[];
  },
): Promise<AnalysisActionResult> {
  const scopeKind = normalizeScopeKind(input.scopeKind);
  if (!scopeKind) return { ok: false, message: "Choose a valid analysis scope." };
  try {
    const config = getAssistantConfig();
    const preview = await previewCharacterAnalysis(
      getDb(),
      { configured: config.status.configured, model: config.status.model, limits: config.status.limits },
      {
        projectId,
        characterRecordIds: input.characterRecordIds,
        scopeKind,
        scopeSpec: input.scopeSpec,
        actions: normalizeActions(input.actions),
      },
    );
    return { ok: true, preview };
  } catch (error) {
    return failure(error);
  }
}

export async function saveCharacterAnalysisDecisionAction(
  projectId: string,
  runId: string,
  findingId: string,
  patch: { action: FindingDecisionAction; editedValue?: string; editedNote?: string; reason?: string },
): Promise<AnalysisActionResult> {
  try {
    const run = await saveCharacterAnalysisDecision(getDb(), projectId, runId, findingId, patch);
    revalidatePath(`/projects/${projectId}/world/development`);
    return { ok: true, run, message: "Decision saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function applyCharacterAnalysisAction(
  projectId: string,
  runId: string,
  contentHash: string,
  confirmProtected: boolean,
): Promise<AnalysisActionResult> {
  try {
    const { outcome, run } = await applyCharacterAnalysisDecisions(getDb(), projectId, runId, contentHash, { confirmProtected });
    if (outcome.status === "rejected") {
      return { ok: false, message: outcome.issues[0]?.message ?? "The package could not be applied." };
    }
    revalidatePath(`/projects/${projectId}/world/development`);
    for (const characterId of run.characterRecordIds) {
      revalidatePath(`/projects/${projectId}/records/${characterId}`);
    }
    return {
      ok: true,
      run,
      message: outcome.status === "already_applied" ? "Those findings were already applied." : "Accepted findings saved as draft notes. They are not canon.",
    };
  } catch (error) {
    return failure(error);
  }
}

export async function requestFurtherAnalysisAction(
  projectId: string,
  runId: string,
  findingId: string,
): Promise<AnalysisActionResult> {
  try {
    const config = getAssistantConfig();
    const prep = await requestFurtherAnalysis(
      getDb(),
      { configured: config.status.configured, model: config.status.model, limits: config.status.limits },
      projectId,
      runId,
      findingId,
    );
    return { ok: true, runId: prep.runId, message: "Further analysis is ready to start." };
  } catch (error) {
    return failure(error);
  }
}

export async function loadCharacterAnalysisAction(projectId: string, runId: string): Promise<AnalysisActionResult> {
  try {
    const run = await getCharacterAnalysis(getDb(), projectId, runId);
    return { ok: true, run };
  } catch (error) {
    return failure(error);
  }
}
