"use server";

import { revalidatePath } from "next/cache";
import type { AnalysisDecisions } from "@/analyze/chapterAnalysisOutput";
import { getDb } from "@/server/db";
import {
  applyChapterAnalysis,
  saveChapterAnalysisDecisions,
  type ApplyChapterAnalysisResult,
} from "@/server/services/chapterAnalysisService";

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
