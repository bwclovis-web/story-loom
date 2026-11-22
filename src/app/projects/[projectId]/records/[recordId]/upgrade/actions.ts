"use server";

import { revalidatePath } from "next/cache";
import type { DossierUpgradeDecisionInput } from "@/domain/characterDossierUpgrade";
import type { Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import {
  applyCharacterDossierUpgrade,
  buildCharacterDossierUpgradePackage,
  previewCharacterDossierUpgrade,
  type ApplyDossierUpgradeResult,
  type CharacterDossierUpgradePreview,
} from "@/server/services/characterDossierUpgradeService";
import { MutationRejectedError, NotFoundError, StaleRevisionError } from "@/server/services/errors";

function failure(error: unknown): { ok: false; message: string; issues?: Issue[] } {
  if (error instanceof MutationRejectedError) {
    return { ok: false, message: error.issues.map((issue) => issue.message).join(" "), issues: error.issues };
  }
  if (error instanceof StaleRevisionError) {
    return { ok: false, message: error.issues.map((issue) => issue.message).join(" "), issues: error.issues };
  }
  if (error instanceof NotFoundError) return { ok: false, message: error.message };
  return { ok: false, message: error instanceof Error ? error.message : "The upgrade could not run." };
}

export async function previewDossierUpgradeAction(
  projectId: string,
  recordId: string,
  markdownOverride?: string,
): Promise<{ ok: true; preview: CharacterDossierUpgradePreview } | { ok: false; message: string }> {
  try {
    const preview = await previewCharacterDossierUpgrade(getDb(), projectId, recordId, { markdownOverride });
    return { ok: true, preview };
  } catch (error) {
    return failure(error);
  }
}

export async function applyDossierUpgradeAction(
  projectId: string,
  recordId: string,
  input: {
    previewToken: string;
    decisions: DossierUpgradeDecisionInput[];
    unlockProtected: boolean;
    markdownOverride?: string;
  },
): Promise<ApplyDossierUpgradeResult | { status: "failed"; message: string }> {
  try {
    const result = await applyCharacterDossierUpgrade(getDb(), projectId, {
      recordId,
      previewToken: input.previewToken,
      decisions: input.decisions,
      unlockProtected: input.unlockProtected,
      markdownOverride: input.markdownOverride,
    });
    if (result.status === "applied") {
      revalidatePath(`/projects/${projectId}/records/${recordId}`);
      revalidatePath(`/projects/${projectId}/world/development`);
      revalidatePath(`/projects/${projectId}/world/development/upgrade`);
    }
    return result;
  } catch (error) {
    const failed = failure(error);
    return { status: "failed", message: failed.message };
  }
}

export async function buildDossierUpgradePackageAction(
  projectId: string,
  recordId: string,
  input: {
    previewToken: string;
    decisions: DossierUpgradeDecisionInput[];
    markdownOverride?: string;
  },
): Promise<{ ok: true; packageJson: string } | { ok: false; message: string }> {
  try {
    const built = await buildCharacterDossierUpgradePackage(getDb(), projectId, {
      recordId,
      previewToken: input.previewToken,
      decisions: input.decisions,
      markdownOverride: input.markdownOverride,
    });
    if (!built.ok) {
      return { ok: false, message: built.issues.map((issue) => issue.message).join(" ") || "Could not build package." };
    }
    return { ok: true, packageJson: JSON.stringify(built.pkg, null, 2) };
  } catch (error) {
    return failure(error);
  }
}
