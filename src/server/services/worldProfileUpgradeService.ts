import {
  analyzeWorldProfileUpgrade,
  applyWorldUpgradeDecisions,
  buildWorldUpgradeChangePackage,
  decisionsRequireExplicitConflictChoice,
  readWorldMarkdownArchiveWithStatus,
  upgradePreviewToken,
  WORLD_MARKDOWN_ARCHIVE_VERSION,
  type ApplyWorldUpgradeResult,
  type WorldUpgradeAnalysis,
  type WorldUpgradeDecisionInput,
} from "@/domain/worldProfileUpgrade";
import {
  emptyWorldProfile,
  isWorldProfileRecordType,
  readWorldProfile,
  unsupportedWorldProfileVersion,
  type WorldProfile,
} from "@/domain/worldProfile";
import { errorIssue, type Issue } from "@/domain/issues";
import { newId } from "@/domain/ids";
import type { JsonObject } from "@/domain/json";
import type { RecordView } from "@/domain/records";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { getProject } from "./projectService";
import { getRecord, updateRecord } from "./recordService";
import { getSeriesSharedRecord } from "./seriesBibleService";
import {
  listAvailableWorldKindTemplates,
  listWorldKindTemplates,
  resolveProfileDefinitionForRecord,
} from "./worldKindTemplateService";
import { resolveRecordTaxonomy } from "@/world/taxonomy";

export interface WorldProfileUpgradePreview {
  projectId: string;
  recordId: string;
  title: string;
  revision: number;
  protected: boolean;
  bodyHash: string;
  previewToken: string;
  analysis: WorldUpgradeAnalysis;
  profile: WorldProfile;
  archiveEntryCount: number;
  alreadyMigrated: boolean;
  issues: Issue[];
  homeProjectId: string;
  homeLabel: string;
  editableHere: boolean;
  archiveUnsupported: boolean;
  definitionId: string | null;
  definitionLabel: string | null;
  summary: {
    total: number;
    needsReview: number;
    unclassified: number;
    conflicts: number;
    alreadyApplied: number;
  };
}

export type ApplyWorldProfileUpgradeResult =
  | {
      status: "applied";
      revision: number;
      appliedItemIds: string[];
      deferredItemIds: string[];
      rejectedItemIds: string[];
    }
  | { status: "already_applied"; revision: number }
  | { status: "rejected"; issues: Issue[] };

async function loadWorldRecord(
  db: DbOrTx,
  projectId: string,
  recordId: string,
): Promise<{ record: RecordView; homeProjectId: string; homeLabel: string; editableHere: boolean }> {
  try {
    const record = await getRecord(db, projectId, recordId);
    if (!isWorldProfileRecordType(record.type)) {
      throw new MutationRejectedError([
        errorIssue("INVALID_CHANGE", "Upgrade applies only to non-character World references."),
      ]);
    }
    return {
      record,
      homeProjectId: projectId,
      homeLabel: "This book",
      editableHere: true,
    };
  } catch (error) {
    if (error instanceof MutationRejectedError) throw error;
    if (!(error instanceof NotFoundError)) throw error;
    const shared = await getSeriesSharedRecord(db, projectId, recordId);
    if (!shared || !isWorldProfileRecordType(shared.record.type)) {
      throw new NotFoundError("World reference not found in this project.");
    }
    return {
      record: shared.record,
      homeProjectId: shared.home.projectId,
      homeLabel: shared.home.bookName?.trim() || shared.home.title,
      editableHere: false,
    };
  }
}

function summarize(items: WorldUpgradeAnalysis["items"]) {
  return {
    total: items.length,
    needsReview: items.filter((item) => item.requiresHumanReview).length,
    unclassified: items.filter((item) => item.storage === "hold").length,
    conflicts: items.filter(
      (item) =>
        item.conflictWithIds.length > 0 ||
        (item.existingCanonical.trim() && item.existingCanonical !== item.proposedValue),
    ).length,
    alreadyApplied: items.filter((item) => item.alreadyApplied).length,
  };
}

export async function previewWorldProfileUpgrade(
  db: DbOrTx,
  projectId: string,
  recordId: string,
  options: { markdownOverride?: string } = {},
): Promise<WorldProfileUpgradePreview> {
  const loaded = await loadWorldRecord(db, projectId, recordId);
  const { record } = loaded;
  const issues: Issue[] = [];
  if (unsupportedWorldProfileVersion(record.fields)) {
    issues.push(
      errorIssue("INVALID_CHANGE", "This world profile version is not supported. The stored profile was left unchanged.", {
        path: "version",
      }),
    );
  }
  const archiveRead = readWorldMarkdownArchiveWithStatus(record.fields);
  for (const problem of archiveRead.problems) {
    issues.push(errorIssue("INVALID_CHANGE", problem.message, { path: problem.path }));
  }
  const read = readWorldProfile(record.fields);
  for (const problem of read.problems) {
    issues.push(errorIssue("INVALID_CHANGE", problem.message, { path: problem.path }));
  }
  const [homeTemplates, availableTemplates] = await Promise.all([
    listWorldKindTemplates(db, loaded.homeProjectId),
    listAvailableWorldKindTemplates(db, projectId),
  ]);
  const taxonomy = resolveRecordTaxonomy({ type: record.type, fields: record.fields });
  const categorySlugs = [
    ...(taxonomy.primary?.category ? [taxonomy.primary.category] : []),
    ...taxonomy.secondary.map((item) => item.category),
  ];
  const definition = resolveProfileDefinitionForRecord({
    fields: record.fields,
    recordProjectId: loaded.homeProjectId,
    homeTemplates,
    availableTemplates,
    definitionId: read.profile.definitionId,
    categorySlug: taxonomy.primary?.category ?? null,
    categorySlugs,
  });
  const body = options.markdownOverride ?? record.body;
  const analysis = analyzeWorldProfileUpgrade(body, read.profile, record.fields, definition);
  const previewToken = upgradePreviewToken({
    recordId: record.id,
    revision: record.currentRevision,
    bodyHash: analysis.bodyHash,
    fingerprint: analysis.fingerprint,
    archiveVersion: archiveRead.unsupportedVersion ? -1 : WORLD_MARKDOWN_ARCHIVE_VERSION,
  });
  return {
    projectId,
    recordId: record.id,
    title: record.title,
    revision: record.currentRevision,
    protected: record.protected,
    bodyHash: analysis.bodyHash,
    previewToken,
    analysis,
    profile: read.profile,
    archiveEntryCount: archiveRead.archive.entries.length,
    alreadyMigrated:
      archiveRead.archive.appliedFingerprints.includes(analysis.fingerprint) ||
      (archiveRead.archive.appliedFingerprints.length > 0 && analysis.items.every((item) => item.alreadyApplied)),
    issues,
    homeProjectId: loaded.homeProjectId,
    homeLabel: loaded.homeLabel,
    editableHere: loaded.editableHere,
    archiveUnsupported: archiveRead.unsupportedVersion,
    definitionId: definition?.id ?? null,
    definitionLabel: definition?.label ?? null,
    summary: summarize(analysis.items),
  };
}

export async function applyWorldProfileUpgrade(
  db: Db,
  projectId: string,
  recordId: string,
  input: {
    previewToken: string;
    decisions: WorldUpgradeDecisionInput[];
    unlockProtected?: boolean;
    markdownOverride?: string;
  },
): Promise<ApplyWorldProfileUpgradeResult> {
  const preview = await previewWorldProfileUpgrade(db, projectId, recordId, {
    markdownOverride: input.markdownOverride,
  });
  if (!preview.editableHere) {
    return {
      status: "rejected",
      issues: [
        errorIssue(
          "INVALID_CHANGE",
          `This reference is shared from ${preview.homeLabel}. Open that book to apply the upgrade.`,
        ),
      ],
    };
  }
  if (preview.archiveUnsupported || preview.issues.some((issue) => issue.severity === "error")) {
    return { status: "rejected", issues: preview.issues };
  }
  if (preview.previewToken !== input.previewToken) {
    return {
      status: "rejected",
      issues: [errorIssue("STALE_PREVIEW", "The upgrade preview is out of date. Preview again, then apply.")],
    };
  }
  if (preview.alreadyMigrated) {
    return { status: "already_applied", revision: preview.revision };
  }
  const blocked = decisionsRequireExplicitConflictChoice(preview.analysis, input.decisions);
  if (blocked.length) {
    return {
      status: "rejected",
      issues: [
        errorIssue(
          "INVALID_CHANGE",
          "Approved canon fields need an explicit keep, replace, merge, modify, reject, or defer choice.",
        ),
      ],
    };
  }
  const archiveRead = readWorldMarkdownArchiveWithStatus(
    (await getRecord(db, projectId, recordId)).fields,
  );
  const [homeTemplates, availableTemplates] = await Promise.all([
    listWorldKindTemplates(db, projectId),
    listAvailableWorldKindTemplates(db, projectId),
  ]);
  const record = await getRecord(db, projectId, recordId);
  const read = readWorldProfile(record.fields);
  const taxonomy = resolveRecordTaxonomy({ type: record.type, fields: record.fields });
  const categorySlugs = [
    ...(taxonomy.primary?.category ? [taxonomy.primary.category] : []),
    ...taxonomy.secondary.map((item) => item.category),
  ];
  const definition = resolveProfileDefinitionForRecord({
    fields: record.fields,
    recordProjectId: projectId,
    homeTemplates,
    availableTemplates,
    definitionId: read.profile.definitionId,
    categorySlug: taxonomy.primary?.category ?? null,
    categorySlugs,
  });
  const applied = applyWorldUpgradeDecisions({
    body: input.markdownOverride ?? record.body,
    profile: read.profile.definitionId ? read.profile : { ...read.profile, definitionId: definition?.id ?? null },
    flatFields: { ...record.fields } as JsonObject,
    definition,
    analysis: preview.analysis,
    decisions: input.decisions,
    archive: archiveRead.archive,
    sourceRevision: record.currentRevision,
  });
  if (applied.noEffectiveChange && applied.appliedItemIds.length === 0) {
    return { status: "already_applied", revision: record.currentRevision };
  }
  const batch = await updateRecord(db, projectId, {
    recordId,
    expectedRevision: record.currentRevision,
    fields: applied.fields,
    unlockProtected: input.unlockProtected === true,
  });
  const outcome = batch.outcomes.find((item) => item.recordId === recordId);
  await writeAudit(db, {
    projectId,
    action: "world_profile.upgrade",
    actor: "author",
    summary: `Applied Living World Profile upgrade on "${record.title}"`,
    details: {
      recordId,
      applied: applied.appliedItemIds.length,
      deferred: applied.deferredItemIds.length,
      rejected: applied.rejectedItemIds.length,
      definitionId: definition?.id ?? null,
    },
  });
  return {
    status: "applied",
    revision: outcome?.newRevision ?? record.currentRevision + 1,
    appliedItemIds: applied.appliedItemIds,
    deferredItemIds: applied.deferredItemIds,
    rejectedItemIds: applied.rejectedItemIds,
  };
}

export async function buildWorldProfileUpgradePackage(
  db: DbOrTx,
  projectId: string,
  recordId: string,
  input: {
    previewToken: string;
    decisions: WorldUpgradeDecisionInput[];
    markdownOverride?: string;
  },
): Promise<{ ok: true; packageJson: string } | { ok: false; message: string }> {
  const preview = await previewWorldProfileUpgrade(db, projectId, recordId, {
    markdownOverride: input.markdownOverride,
  });
  if (!preview.editableHere) {
    return { ok: false, message: `Edit this shared reference in ${preview.homeLabel}.` };
  }
  if (preview.previewToken !== input.previewToken) {
    return { ok: false, message: "The upgrade preview is out of date. Preview again." };
  }
  const project = await getProject(db, projectId);
  const record = await getRecord(db, projectId, recordId);
  const archiveRead = readWorldMarkdownArchiveWithStatus(record.fields);
  const [homeTemplates, availableTemplates] = await Promise.all([
    listWorldKindTemplates(db, projectId),
    listAvailableWorldKindTemplates(db, projectId),
  ]);
  const read = readWorldProfile(record.fields);
  const taxonomy = resolveRecordTaxonomy({ type: record.type, fields: record.fields });
  const categorySlugs = [
    ...(taxonomy.primary?.category ? [taxonomy.primary.category] : []),
    ...taxonomy.secondary.map((item) => item.category),
  ];
  const definition = resolveProfileDefinitionForRecord({
    fields: record.fields,
    recordProjectId: projectId,
    homeTemplates,
    availableTemplates,
    definitionId: read.profile.definitionId,
    categorySlug: taxonomy.primary?.category ?? null,
    categorySlugs,
  });
  const applied = applyWorldUpgradeDecisions({
    body: input.markdownOverride ?? record.body,
    profile: read.profile,
    flatFields: { ...record.fields } as JsonObject,
    definition,
    analysis: preview.analysis,
    decisions: input.decisions,
    archive: archiveRead.archive,
    sourceRevision: record.currentRevision,
  });
  const pkg = buildWorldUpgradeChangePackage({
    workspaceId: project.workspaceId,
    projectId,
    recordId,
    expectedRevision: record.currentRevision,
    packageId: newId("pkg"),
    fields: applied.fields,
  });
  return { ok: true, packageJson: JSON.stringify(pkg, null, 2) };
}

export async function saveWorldProfileOverlay(
  db: Db,
  input: {
    projectId: string;
    recordId: string;
    expectedRevision: number;
    profile: WorldProfile;
    unlockProtected?: boolean;
  },
): Promise<{ revision: number }> {
  const record = await getRecord(db, input.projectId, input.recordId);
  if (!isWorldProfileRecordType(record.type)) {
    throw new MutationRejectedError([
      errorIssue("INVALID_CHANGE", "Living World Profiles are only for non-character World references."),
    ]);
  }
  const { withWorldProfile } = await import("@/domain/worldProfile");
  const fields = withWorldProfile(record.fields as JsonObject, input.profile);
  const batch = await updateRecord(db, input.projectId, {
    recordId: input.recordId,
    expectedRevision: input.expectedRevision,
    fields,
    unlockProtected: input.unlockProtected === true,
  });
  const outcome = batch.outcomes.find((item) => item.recordId === input.recordId);
  return { revision: outcome?.newRevision ?? input.expectedRevision + 1 };
}

export { emptyWorldProfile };
export type { ApplyWorldUpgradeResult };
