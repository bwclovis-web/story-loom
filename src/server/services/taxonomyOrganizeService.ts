import { errorIssue, type Issue } from "@/domain/issues";
import { stableStringify, type JsonObject } from "@/domain/json";
import { toRecordView, type RecordView } from "@/domain/records";
import { isWorldType, taxonomyPlacementLabel } from "@/ui/world";
import { CATEGORY_TO_LEGACY_KIND } from "@/world/hubDiscovery";
import {
  normalizeCustomTaxonomySlug,
  readRecordTaxonomy,
  resolveRecordTaxonomy,
  TAXONOMY_FIELD_KEY,
  TAXONOMY_KNOWN_KEYS,
  taxonomyWriteProblems,
  withoutRecordTaxonomy,
  withRecordTaxonomy,
  type RecordTaxonomyV1,
  type TaxonomyPlacement,
} from "@/world/taxonomy";
import { worldbuildingKindFromFields } from "@/world/worldKinds";
import type { Db, DbOrTx } from "../db";
import { MutationRejectedError } from "./errors";
import { applyMutations, type MutationContext, type UpdateRecordMutation } from "./mutationService";
import { LIVE_RECORD } from "./trashFilters";

/*
 * Bulk World Hub classification. Local World records only: records saved in
 * this project, never sibling series-shared references. Each change is an
 * ordinary `update_record` through `mutationService`, so revisions, stale
 * checks, protection and audit stay uniform. Only `fields.taxonomy` changes;
 * titles, text, status, kind and every other field are carried over as saved.
 */

export const TAXONOMY_ORGANIZE_AUDIT_ACTION = "record.taxonomy_organize";
const UI_ACTOR = "author";

/** One bulk change. Absent keys leave that part of the classification alone. */
export interface TaxonomyOperation {
  /** A placement sets the primary category. `null` removes the saved primary. */
  setPrimary?: TaxonomyPlacement | null;
  addSecondary?: TaxonomyPlacement[];
  /** A category without a subcategory removes every secondary membership in that category. */
  removeSecondary?: TaxonomyPlacement[];
  addTags?: string[];
  removeTags?: string[];
  /** Removes `fields.taxonomy` entirely. Use on its own. */
  clearTaxonomy?: boolean;
}

export interface TaxonomyView {
  /** True when `fields.taxonomy` is saved on the record. */
  saved: boolean;
  /** Effective primary: the saved one, or the read-time default from type / kind. */
  primary: TaxonomyPlacement | null;
  /** True when `primary` is a read-time default rather than saved. */
  inferred: boolean;
  secondary: TaxonomyPlacement[];
  tags: string[];
}

export type TaxonomyConflictKind = "overwrite_primary" | "legacy_kind" | "invalid" | "unreadable";

export interface TaxonomyConflict {
  recordId: string;
  kind: TaxonomyConflictKind;
  /** Errors block the apply. Notes are shown and do not. */
  severity: "error" | "note";
  message: string;
}

export interface TaxonomyPreviewItem {
  recordId: string;
  title: string;
  type: string;
  protected: boolean;
  revision: number;
  before: TaxonomyView;
  after: TaxonomyView;
  changed: boolean;
}

export interface TaxonomyIneligible {
  recordId: string;
  reason: string;
}

export interface TaxonomyPreview {
  items: TaxonomyPreviewItem[];
  conflicts: TaxonomyConflict[];
  /** Selected IDs that are not live local World records. They block the apply. */
  ineligible: TaxonomyIneligible[];
  /** Changed records that are protected, and would need the author's unlock. */
  protectedRecordIds: string[];
  /** Revision per record the preview was computed against. Pass back to apply for stale detection. */
  revisions: Record<string, number>;
  changedCount: number;
  operationProblem: string | null;
  /** No errors, something to change, and (when protected records change) an unlock confirmation. */
  canApply: boolean;
}

export interface BulkTaxonomyInput {
  recordIds: readonly string[];
  operation: TaxonomyOperation;
  unlockProtected?: boolean;
}

export interface BulkTaxonomyApplyInput extends BulkTaxonomyInput {
  /** Revisions shown in the preview. A live difference refuses the apply. */
  expectedRevisions?: Readonly<Record<string, number>>;
}

export interface BulkTaxonomyResult {
  updatedCount: number;
  recordIds: string[];
  auditEntryId: string | null;
}

function placementKey(placement: TaxonomyPlacement): string {
  return `${placement.category}\0${placement.subcategory ?? ""}`;
}

function cleanPlacement(placement: TaxonomyPlacement): TaxonomyPlacement | null {
  const category = normalizeCustomTaxonomySlug(placement.category);
  if (!category) return null;
  const subcategory = placement.subcategory ? normalizeCustomTaxonomySlug(placement.subcategory) : null;
  return subcategory ? { category, subcategory } : { category };
}

function cleanPlacements(list: readonly TaxonomyPlacement[] | undefined): TaxonomyPlacement[] {
  const out: TaxonomyPlacement[] = [];
  for (const item of list ?? []) {
    const cleaned = cleanPlacement(item);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

function cleanTags(list: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const item of list ?? []) {
    const tag = normalizeCustomTaxonomySlug(item, 80);
    if (tag && !out.some((other) => other.toLocaleLowerCase() === tag.toLocaleLowerCase())) out.push(tag);
  }
  return out;
}

/** True when the operation would change nothing for any record. */
export function isEmptyTaxonomyOperation(operation: TaxonomyOperation): boolean {
  return (
    !operation.clearTaxonomy &&
    operation.setPrimary === undefined &&
    cleanPlacements(operation.addSecondary).length === 0 &&
    cleanPlacements(operation.removeSecondary).length === 0 &&
    cleanTags(operation.addTags).length === 0 &&
    cleanTags(operation.removeTags).length === 0
  );
}

function operationProblem(operation: TaxonomyOperation): string | null {
  if (isEmptyTaxonomyOperation(operation)) return "Choose at least one change.";
  if (operation.clearTaxonomy) {
    const others =
      operation.setPrimary !== undefined ||
      cleanPlacements(operation.addSecondary).length > 0 ||
      cleanPlacements(operation.removeSecondary).length > 0 ||
      cleanTags(operation.addTags).length > 0 ||
      cleanTags(operation.removeTags).length > 0;
    if (others) return "Removing the whole classification cannot be combined with other changes.";
  }
  if (operation.setPrimary) {
    const primary = cleanPlacement(operation.setPrimary);
    if (!primary) return "The primary category needs a name.";
    const clash = cleanPlacements(operation.addSecondary).some((item) => placementKey(item) === placementKey(primary));
    if (clash) return "A secondary category cannot repeat the new primary category.";
  }
  return null;
}

function viewOf(record: { type: string; fields: Readonly<Record<string, unknown>> }): TaxonomyView {
  const resolved = resolveRecordTaxonomy({ type: record.type, fields: record.fields });
  return {
    saved: resolved.stored !== null,
    primary: resolved.primary,
    inferred: resolved.usedLegacyFallback,
    secondary: resolved.secondary,
    tags: resolved.tags,
  };
}

export interface AppliedTaxonomy {
  fields: JsonObject;
  problems: string[];
  /** The saved classification could not be read, so nothing was changed. */
  unreadable: boolean;
  /** Existing saved primary that the operation replaces with a different one. */
  overwrote: TaxonomyPlacement | null;
}

/**
 * Pure: the fields a record would have after the operation. Never touches
 * anything outside `fields.taxonomy`. Unknown taxonomy keys are kept.
 */
export function applyTaxonomyOperation(fields: JsonObject, operation: TaxonomyOperation): AppliedTaxonomy {
  if (operation.clearTaxonomy) {
    return { fields: withoutRecordTaxonomy(fields), problems: [], unreadable: false, overwrote: null };
  }
  const read = readRecordTaxonomy(fields);
  if (!read.ok) {
    return {
      fields,
      problems: [`The saved classification cannot be read (${read.problems.map((p) => p.message).join(" ")}).`],
      unreadable: true,
      overwrote: null,
    };
  }
  const stored = read.taxonomy;
  let primary: TaxonomyPlacement | null | undefined = stored?.primary;
  let secondary: TaxonomyPlacement[] = [...(stored?.secondary ?? [])];
  let tags: string[] = [...(stored?.tags ?? [])];
  let overwrote: TaxonomyPlacement | null = null;

  if (operation.setPrimary !== undefined) {
    if (operation.setPrimary === null) {
      primary = undefined;
    } else {
      const next = cleanPlacement(operation.setPrimary);
      if (next) {
        if (stored?.primary && placementKey(stored.primary) !== placementKey(next)) overwrote = stored.primary;
        primary = next;
        secondary = secondary.filter((item) => placementKey(item) !== placementKey(next));
      }
    }
  }

  for (const add of cleanPlacements(operation.addSecondary)) {
    const key = placementKey(add);
    if (primary && placementKey(primary) === key) continue;
    if (secondary.some((item) => placementKey(item) === key)) continue;
    secondary.push(add);
  }
  for (const remove of cleanPlacements(operation.removeSecondary)) {
    secondary = secondary.filter(
      (item) => !(item.category === remove.category && (!remove.subcategory || item.subcategory === remove.subcategory)),
    );
  }

  for (const add of cleanTags(operation.addTags)) {
    if (!tags.some((item) => item.toLocaleLowerCase() === add.toLocaleLowerCase())) tags.push(add);
  }
  const removeTags = new Set(cleanTags(operation.removeTags).map((tag) => tag.toLocaleLowerCase()));
  if (removeTags.size) tags = tags.filter((tag) => !removeTags.has(tag.toLocaleLowerCase()));

  let next: JsonObject;
  if (primary === undefined && secondary.length === 0 && tags.length === 0) {
    // Nothing left to classify. Keep the object only when it carries keys this app does not know.
    const known = new Set<string>(TAXONOMY_KNOWN_KEYS);
    const saved = fields[TAXONOMY_FIELD_KEY];
    const hasUnknown =
      !!saved && typeof saved === "object" && !Array.isArray(saved) && Object.keys(saved).some((key) => !known.has(key));
    next = hasUnknown ? withRecordTaxonomy(fields, { version: 1 }) : withoutRecordTaxonomy(fields);
  } else {
    const value: RecordTaxonomyV1 = { version: 1 };
    if (primary !== undefined) value.primary = primary;
    if (secondary.length) value.secondary = secondary;
    if (tags.length) value.tags = tags;
    next = withRecordTaxonomy(fields, value);
  }

  const problems = taxonomyWriteProblems(next[TAXONOMY_FIELD_KEY]).map((problem) => problem.message);
  return { fields: next, problems, unreadable: false, overwrote };
}

function legacyKindNote(record: RecordView, after: TaxonomyView): string | null {
  if (record.type !== "worldbuilding") return null;
  const kind = worldbuildingKindFromFields(record.fields);
  if (!kind || !after.primary) return null;
  if (CATEGORY_TO_LEGACY_KIND[after.primary.category] === kind) return null;
  return `Structured kind is ${kind}, which does not match ${taxonomyPlacementLabel(after.primary)}. The kind is not changed.`;
}

async function loadLocalWorldRecords(
  db: DbOrTx,
  projectId: string,
  recordIds: readonly string[],
): Promise<{ records: Map<string, RecordView>; ineligible: TaxonomyIneligible[] }> {
  const unique = [...new Set(recordIds)];
  const rows = unique.length
    ? await db.record.findMany({ where: { id: { in: unique }, projectId, ...LIVE_RECORD } })
    : [];
  const records = new Map<string, RecordView>();
  const ineligible: TaxonomyIneligible[] = [];
  const found = new Map(rows.map((row) => [row.id, toRecordView(row)]));
  for (const id of unique) {
    const record = found.get(id);
    if (!record) {
      ineligible.push({ recordId: id, reason: "Not found in this book. Shared series references stay with their home book." });
    } else if (!isWorldType(record.type)) {
      ineligible.push({ recordId: id, reason: "Not a World reference." });
    } else {
      records.set(id, record);
    }
  }
  return { records, ineligible };
}

/** Compute what each selected record would look like. Writes nothing. */
export async function previewBulkTaxonomy(
  db: DbOrTx,
  projectId: string,
  input: BulkTaxonomyInput,
): Promise<TaxonomyPreview> {
  const problem = operationProblem(input.operation);
  const { records, ineligible } = await loadLocalWorldRecords(db, projectId, input.recordIds);
  const items: TaxonomyPreviewItem[] = [];
  const conflicts: TaxonomyConflict[] = [];
  const revisions: Record<string, number> = {};

  for (const id of [...new Set(input.recordIds)]) {
    const record = records.get(id);
    if (!record) continue;
    revisions[record.id] = record.currentRevision;
    const before = viewOf(record);
    if (problem) {
      items.push({
        recordId: record.id,
        title: record.title,
        type: record.type,
        protected: record.protected,
        revision: record.currentRevision,
        before,
        after: before,
        changed: false,
      });
      continue;
    }
    const applied = applyTaxonomyOperation(record.fields, input.operation);
    const afterFields = applied.fields;
    const after = viewOf({ type: record.type, fields: afterFields });
    const changed = stableStringify(afterFields) !== stableStringify(record.fields);
    items.push({
      recordId: record.id,
      title: record.title,
      type: record.type,
      protected: record.protected,
      revision: record.currentRevision,
      before,
      after,
      changed,
    });
    if (applied.problems.length) {
      for (const message of applied.problems) {
        conflicts.push({
          recordId: record.id,
          kind: applied.unreadable ? "unreadable" : "invalid",
          severity: "error",
          message,
        });
      }
      continue;
    }
    if (applied.overwrote) {
      conflicts.push({
        recordId: record.id,
        kind: "overwrite_primary",
        severity: "note",
        message: `Replaces the saved primary ${taxonomyPlacementLabel(applied.overwrote)}.`,
      });
    }
    if (changed) {
      const note = legacyKindNote(record, after);
      if (note) conflicts.push({ recordId: record.id, kind: "legacy_kind", severity: "note", message: note });
    }
  }

  const changedItems = items.filter((item) => item.changed);
  const protectedRecordIds = changedItems.filter((item) => item.protected).map((item) => item.recordId);
  const hasErrors = conflicts.some((item) => item.severity === "error") || ineligible.length > 0;
  const needsUnlock = protectedRecordIds.length > 0 && !input.unlockProtected;
  return {
    items,
    conflicts,
    ineligible,
    protectedRecordIds,
    revisions,
    changedCount: changedItems.length,
    operationProblem: problem,
    canApply: !problem && !hasErrors && changedItems.length > 0 && !needsUnlock,
  };
}

/**
 * Save the classification on every selected record that changes, in one
 * all-or-nothing batch. Revisions come from the live rows. Protected records
 * change only when the author confirmed the unlock.
 */
export async function applyBulkTaxonomy(
  db: Db,
  projectId: string,
  input: BulkTaxonomyApplyInput,
): Promise<BulkTaxonomyResult> {
  const preview = await previewBulkTaxonomy(db, projectId, input);
  const issues: Issue[] = [];
  if (preview.operationProblem) issues.push(errorIssue("INVALID_CHANGE", preview.operationProblem));
  for (const item of preview.ineligible) {
    issues.push(errorIssue("RECORD_NOT_FOUND", item.reason, { recordId: item.recordId }));
  }
  for (const conflict of preview.conflicts) {
    if (conflict.severity === "error") issues.push(errorIssue("INVALID_CHANGE", conflict.message, { recordId: conflict.recordId }));
  }
  if (input.expectedRevisions) {
    for (const item of preview.items) {
      const expected = input.expectedRevisions[item.recordId];
      if (expected !== undefined && expected !== item.revision) {
        issues.push(
          errorIssue(
            "STALE_PREVIEW",
            `"${item.title}" is at revision ${item.revision}, but the preview was made at revision ${expected}. Preview again.`,
            { recordId: item.recordId },
          ),
        );
      }
    }
  }
  const changed = preview.items.filter((item) => item.changed);
  if (preview.protectedRecordIds.length && !input.unlockProtected) {
    for (const recordId of preview.protectedRecordIds) {
      issues.push(
        errorIssue("PROTECTED_CONFIRMATION_REQUIRED", `Record ${recordId} is protected. Confirm the unlock to classify it.`, {
          recordId,
        }),
      );
    }
  }
  if (issues.length) throw new MutationRejectedError(issues);
  if (changed.length === 0) return { updatedCount: 0, recordIds: [], auditEntryId: null };

  const { records } = await loadLocalWorldRecords(
    db,
    projectId,
    changed.map((item) => item.recordId),
  );
  const mutations: UpdateRecordMutation[] = [];
  for (const item of changed) {
    const record = records.get(item.recordId);
    if (!record) throw new MutationRejectedError([errorIssue("RECORD_NOT_FOUND", `Record ${item.recordId} was not found.`, { recordId: item.recordId })]);
    const applied = applyTaxonomyOperation(record.fields, input.operation);
    const taxonomy = applied.fields[TAXONOMY_FIELD_KEY];
    mutations.push({
      kind: "update_record",
      recordId: record.id,
      // The live revision, so a save made after the preview is detected by the mutation layer.
      expectedRevision: record.currentRevision,
      changes: {
        fields: taxonomy === undefined ? { unset: [TAXONOMY_FIELD_KEY] } : { set: { [TAXONOMY_FIELD_KEY]: taxonomy } },
      },
    });
  }

  const overrides = input.unlockProtected ? changed.filter((item) => item.protected).map((item) => item.recordId) : [];
  const ctx: MutationContext = {
    projectId,
    actor: UI_ACTOR,
    source: { kind: "ui" },
    scope: "reference",
    protectedOverrides: new Set(overrides),
  };
  // Stale or protected rows are rejected here, and the whole batch rolls back.
  const batch = await applyMutations(db, ctx, mutations, {
    action: TAXONOMY_ORGANIZE_AUDIT_ACTION,
    summary: `Organized World classification on ${mutations.length} ${mutations.length === 1 ? "reference" : "references"}`,
  });
  return {
    updatedCount: batch.outcomes.length,
    recordIds: batch.outcomes.map((outcome) => outcome.recordId),
    auditEntryId: batch.auditEntryId,
  };
}
