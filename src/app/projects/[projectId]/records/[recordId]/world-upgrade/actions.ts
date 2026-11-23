"use server";

import { revalidatePath } from "next/cache";
import type { WorldUpgradeDecisionInput } from "@/domain/worldProfileUpgrade";
import type { Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import {
  applyWorldProfileUpgrade,
  buildWorldProfileUpgradePackage,
  previewWorldProfileUpgrade,
  saveWorldProfileOverlay,
  type ApplyWorldProfileUpgradeResult,
  type WorldProfileUpgradePreview,
} from "@/server/services/worldProfileUpgradeService";
import { MutationRejectedError, NotFoundError, StaleRevisionError } from "@/server/services/errors";
import type { WorldProfile } from "@/domain/worldProfile";

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

export async function previewWorldUpgradeAction(
  projectId: string,
  recordId: string,
  markdownOverride?: string,
): Promise<{ ok: true; preview: WorldProfileUpgradePreview } | { ok: false; message: string }> {
  try {
    const preview = await previewWorldProfileUpgrade(getDb(), projectId, recordId, { markdownOverride });
    return { ok: true, preview };
  } catch (error) {
    return failure(error);
  }
}

export async function applyWorldUpgradeAction(
  projectId: string,
  recordId: string,
  input: {
    previewToken: string;
    decisions: WorldUpgradeDecisionInput[];
    unlockProtected: boolean;
    markdownOverride?: string;
  },
): Promise<ApplyWorldProfileUpgradeResult | { status: "failed"; message: string }> {
  try {
    const result = await applyWorldProfileUpgrade(getDb(), projectId, recordId, input);
    if (result.status === "applied") {
      revalidatePath(`/projects/${projectId}/records/${recordId}`);
      revalidatePath(`/projects/${projectId}/world`);
    }
    return result;
  } catch (error) {
    const failed = failure(error);
    return { status: "failed", message: failed.message };
  }
}

export async function buildWorldUpgradePackageAction(
  projectId: string,
  recordId: string,
  input: {
    previewToken: string;
    decisions: WorldUpgradeDecisionInput[];
    markdownOverride?: string;
  },
): Promise<{ ok: true; packageJson: string } | { ok: false; message: string }> {
  try {
    return await buildWorldProfileUpgradePackage(getDb(), projectId, recordId, input);
  } catch (error) {
    return failure(error);
  }
}

export async function saveWorldProfileAction(
  projectId: string,
  recordId: string,
  input: {
    expectedRevision: number;
    profile: WorldProfile;
    unlockProtected: boolean;
  },
): Promise<{ ok: true; revision: number } | { ok: false; message: string }> {
  try {
    const result = await saveWorldProfileOverlay(getDb(), {
      projectId,
      recordId,
      expectedRevision: input.expectedRevision,
      profile: input.profile,
      unlockProtected: input.unlockProtected,
    });
    revalidatePath(`/projects/${projectId}/records/${recordId}`);
    return { ok: true, revision: result.revision };
  } catch (error) {
    return failure(error);
  }
}
