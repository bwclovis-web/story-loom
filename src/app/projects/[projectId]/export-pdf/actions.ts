"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { getCompileProfile, upsertCompileProfile } from "@/server/services/compileProfileService";
import { MutationRejectedError } from "@/server/services/errors";
import { isExportPresetId, layoutForPreset, type ExportPresetId } from "@/writing/exportPresets";
import { COMPILE_PROFILE } from "@/ui/labels";

export interface CompileProfileFormResult {
  ok: boolean;
  message?: string;
  issues?: Issue[];
}

function failure(error: unknown): CompileProfileFormResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "1" || formData.get(name) === "on";
}

export async function saveCompileProfileAction(
  projectId: string,
  _prev: CompileProfileFormResult,
  formData: FormData,
): Promise<CompileProfileFormResult> {
  try {
    await upsertCompileProfile(getDb(), projectId, {
      titlePageBody: String(formData.get("titlePageBody") ?? ""),
      copyrightPageBody: String(formData.get("copyrightPageBody") ?? ""),
      dedicationBody: String(formData.get("dedicationBody") ?? ""),
      acknowledgementsBody: String(formData.get("acknowledgementsBody") ?? ""),
      sceneBreakGlyph: String(formData.get("sceneBreakGlyph") ?? ""),
      chapterHeadingStyle: String(formData.get("chapterHeadingStyle") ?? "centered"),
      includeSynopses: checkbox(formData, "includeSynopses"),
      includeMarginComments: checkbox(formData, "includeMarginComments"),
      trimSize: String(formData.get("trimSize") ?? "6x9"),
      marginInches: Number(formData.get("marginInches") ?? 0.75),
      runningHeader: String(formData.get("runningHeader") ?? ""),
      runningFooter: String(formData.get("runningFooter") ?? ""),
      fontPreset: String(formData.get("fontPreset") ?? "serif"),
      spacingPreset: String(formData.get("spacingPreset") ?? "novel"),
      firstParagraphNoIndent: checkbox(formData, "firstParagraphNoIndent"),
      dropCap: checkbox(formData, "dropCap"),
      includeToc: checkbox(formData, "includeToc"),
      backMatterBody: String(formData.get("backMatterBody") ?? ""),
      excludedRecordIds: formData.getAll("manuscriptId").map(String).filter((id) => !formData.getAll("includeRecord").map(String).includes(id)),
    });
    revalidatePath(`/projects/${projectId}/export-pdf`);
    return { ok: true, message: "Compile profile saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function applyExportPresetAction(
  projectId: string,
  _prev: CompileProfileFormResult,
  formData: FormData,
): Promise<CompileProfileFormResult> {
  const raw = String(formData.get("preset") ?? "");
  if (!isExportPresetId(raw)) {
    return { ok: false, issues: [errorIssue("INVALID_CHANGE", "Unknown export preset.")] };
  }
  const presetId: ExportPresetId = raw;
  try {
    const db = getDb();
    const current = await getCompileProfile(db, projectId);
    const layout = layoutForPreset(presetId);
    await upsertCompileProfile(db, projectId, {
      titlePageBody: current.titlePageBody,
      copyrightPageBody: current.copyrightPageBody,
      dedicationBody: current.dedicationBody,
      acknowledgementsBody: current.acknowledgementsBody,
      backMatterBody: current.backMatterBody,
      excludedRecordIds: current.excludedRecordIds,
      ...layout,
    });
    revalidatePath(`/projects/${projectId}/export-pdf`);
    return {
      ok: true,
      message:
        presetId === "standard_manuscript"
          ? COMPILE_PROFILE.presetStandardApplied
          : COMPILE_PROFILE.presetFormatterApplied,
    };
  } catch (error) {
    return failure(error);
  }
}