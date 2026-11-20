"use server";

import { revalidatePath } from "next/cache";
import type { AnalysisAssessments, AnalysisDecisions, AnalysisKind } from "@/analyze/chapterAnalysisOutput";
import { getAssistantConfig } from "@/server/assistantConfig";
import { getDb } from "@/server/db";
import {
  applyChapterAnalysis,
  previewChapterAnalysis,
  saveChapterAnalysisAssessments,
  saveChapterAnalysisDecisions,
  type ApplyChapterAnalysisResult,
  type ChapterAnalysisPreview,
} from "@/server/services/chapterAnalysisService";

function runtime() {
  const config = getAssistantConfig();
  return { configured: config.status.configured, model: config.status.model, limits: config.status.limits };
}

export async function previewChapterAnalysisAction(
  projectId: string,
  input: { chapterRecordId: string; pinnedRevision: number; categories: AnalysisKind[] },
): Promise<{ ok: true; preview: ChapterAnalysisPreview } | { ok: false; message: string }> {
  try {
    const preview = await previewChapterAnalysis(getDb(), runtime(), { projectId, ...input });
    return { ok: true, preview };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The request could not be prepared." };
  }
}

export async function saveChapterAnalysisAssessmentsAction(
  projectId: string,
  runId: string,
  assessments: AnalysisAssessments,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await saveChapterAnalysisAssessments(getDb(), projectId, runId, assessments);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The assessment could not be saved." };
  }
}

export async function saveChapterAnalysisDecisionsAction(
  projectId: string,
  runId: string,
  decisions: AnalysisDecisions,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await saveChapterAnalysisDecisions(getDb(), projectId, runId, decisions);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The choices could not be saved." };
  }
}

export async function applyChapterAnalysisAction(
  projectId: string,
  runId: string,
  expectedContentHash: string,
  decisions: AnalysisDecisions,
): Promise<{ ok: true; result: ApplyChapterAnalysisResult } | { ok: false; message: string }> {
  try {
    const result = await applyChapterAnalysis(getDb(), projectId, runId, expectedContentHash, decisions);
    revalidatePath(`/projects/${projectId}/analyze/${runId}`);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "The selection could not be applied." };
  }
}
