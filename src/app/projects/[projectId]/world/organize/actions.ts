"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { MutationRejectedError } from "@/server/services/errors";
import {
  applyBulkTaxonomy,
  previewBulkTaxonomy,
  type TaxonomyOperation,
  type TaxonomyPreview,
} from "@/server/services/taxonomyOrganizeService";
import type { TaxonomyPlacement } from "@/world/taxonomy";

export type OrganizePreviewResult = { ok: true; preview: TaxonomyPreview } | { ok: false; issues: Issue[] };
export type OrganizeApplyResult = { ok: true; updatedCount: number } | { ok: false; issues: Issue[] };

const MAX_RECORDS = 500;

function failure(error: unknown): { ok: false; issues: Issue[] } {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

function asPlacement(value: unknown): TaxonomyPlacement | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.category !== "string" || !row.category.trim()) return null;
  const subcategory = typeof row.subcategory === "string" && row.subcategory.trim() ? row.subcategory : undefined;
  return subcategory ? { category: row.category, subcategory } : { category: row.category };
}

function asPlacements(value: unknown): TaxonomyPlacement[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(asPlacement).filter((item): item is TaxonomyPlacement => item !== null);
}

function asStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

/** The action receives client data, so rebuild the operation from known keys only. */
function parseOperation(raw: unknown): TaxonomyOperation {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const operation: TaxonomyOperation = {};
  if ("setPrimary" in row) {
    if (row.setPrimary === null) operation.setPrimary = null;
    else {
      const primary = asPlacement(row.setPrimary);
      if (primary) operation.setPrimary = primary;
    }
  }
  const addSecondary = asPlacements(row.addSecondary);
  if (addSecondary?.length) operation.addSecondary = addSecondary;
  const removeSecondary = asPlacements(row.removeSecondary);
  if (removeSecondary?.length) operation.removeSecondary = removeSecondary;
  const addTags = asStrings(row.addTags);
  if (addTags?.length) operation.addTags = addTags;
  const removeTags = asStrings(row.removeTags);
  if (removeTags?.length) operation.removeTags = removeTags;
  if (row.clearTaxonomy === true) operation.clearTaxonomy = true;
  return operation;
}

function parseRecordIds(raw: unknown): string[] {
  const ids = asStrings(raw) ?? [];
  return [...new Set(ids)].slice(0, MAX_RECORDS);
}

export async function previewBulkTaxonomyAction(
  projectId: string,
  input: { recordIds: string[]; operation: TaxonomyOperation; unlockProtected?: boolean },
): Promise<OrganizePreviewResult> {
  try {
    const preview = await previewBulkTaxonomy(getDb(), projectId, {
      recordIds: parseRecordIds(input?.recordIds),
      operation: parseOperation(input?.operation),
      unlockProtected: input?.unlockProtected === true,
    });
    return { ok: true, preview };
  } catch (error) {
    return failure(error);
  }
}

export async function applyBulkTaxonomyAction(
  projectId: string,
  input: {
    recordIds: string[];
    operation: TaxonomyOperation;
    unlockProtected?: boolean;
    expectedRevisions?: Record<string, number>;
  },
): Promise<OrganizeApplyResult> {
  try {
    const expected: Record<string, number> = {};
    for (const [id, revision] of Object.entries(input?.expectedRevisions ?? {})) {
      if (typeof revision === "number" && Number.isInteger(revision)) expected[id] = revision;
    }
    const result = await applyBulkTaxonomy(getDb(), projectId, {
      recordIds: parseRecordIds(input?.recordIds),
      operation: parseOperation(input?.operation),
      unlockProtected: input?.unlockProtected === true,
      expectedRevisions: expected,
    });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true, updatedCount: result.updatedCount };
  } catch (error) {
    return failure(error);
  }
}
