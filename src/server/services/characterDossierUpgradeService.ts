import {
  analyzeDossierUpgrade,
  analyzeImportedMarkdown,
  applyUpgradeDecisions,
  buildUpgradeChangePackage,
  decisionsRequireExplicitConflictChoice,
  DOSSIER_MARKDOWN_ARCHIVE_VERSION,
  fieldsAfterUpgrade,
  readDossierMarkdownArchiveWithStatus,
  upgradeDecisionFingerprint,
  upgradePreviewToken,
  type DossierUpgradeAnalysis,
  type DossierUpgradeDecisionInput,
  type DossierUpgradeItem,
} from "@/domain/characterDossierUpgrade";
import {
  readCharacterDevelopment,
  unsupportedCharacterDevelopmentVersion,
  validateCharacterDevelopment,
  type CharacterDevelopment,
} from "@/domain/characterDevelopment";
import { errorIssue, type Issue } from "@/domain/issues";
import { stableStringify, type JsonObject } from "@/domain/json";
import { toRecordView, type RecordView } from "@/domain/records";
import type { ChangePackageV1 } from "@/changePackage/schema.v1";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { getProject } from "./projectService";
import { getRecord, updateRecord } from "./recordService";
import { getSeriesSharedRecord, listSeriesSharedRecords } from "./seriesBibleService";
import { LIVE_RECORD } from "./trashFilters";

export interface CharacterDossierUpgradePreview {
  projectId: string;
  recordId: string;
  title: string;
  revision: number;
  protected: boolean;
  bodyHash: string;
  previewToken: string;
  analysis: DossierUpgradeAnalysis;
  profile: CharacterDevelopment;
  archiveEntryCount: number;
  alreadyMigrated: boolean;
  issues: Issue[];
  /** When previewing a series-shared dossier from a sibling book. */
  homeProjectId: string;
  homeLabel: string;
  editableHere: boolean;
  archiveUnsupported: boolean;
  summary: {
    total: number;
    needsReview: number;
    unclassified: number;
    conflicts: number;
    alreadyApplied: number;
  };
}

export interface ProjectDossierUpgradeSummary {
  projectId: string;
  dossiers: Array<{
    recordId: string;
    title: string;
    revision: number;
    itemCount: number;
    needsReview: number;
    unclassified: number;
    alreadyMigrated: boolean;
    hasProfile: boolean;
    homeProjectId: string;
    homeLabel: string;
    editableHere: boolean;
  }>;
}

export type ApplyDossierUpgradeResult =
  | {
      status: "applied";
      revision: number;
      appliedItemIds: string[];
      deferredItemIds: string[];
      rejectedItemIds: string[];
    }
  | { status: "already_applied"; revision: number }
  | { status: "rejected"; issues: Issue[] };

async function loadDossier(
  db: DbOrTx,
  projectId: string,
  recordId: string,
): Promise<{ record: RecordView; homeProjectId: string; homeLabel: string; editableHere: boolean }> {
  try {
    const record = await getRecord(db, projectId, recordId);
    if (record.type !== "character_dossier") {
      throw new MutationRejectedError([errorIssue("INVALID_CHANGE", "Upgrade applies only to character dossiers.")]);
    }
    return {
      record,
      homeProjectId: projectId,
      homeLabel: "This book",
      editableHere: true,
    };
  } catch (error) {
    if (!(error instanceof NotFoundError) && !(error instanceof MutationRejectedError)) throw error;
    if (error instanceof MutationRejectedError) throw error;
    const shared = await getSeriesSharedRecord(db, projectId, recordId);
    if (!shared || shared.record.type !== "character_dossier") {
      throw new NotFoundError("Character dossier not found in this project.");
    }
    return {
      record: shared.record,
      homeProjectId: shared.home.projectId,
      homeLabel: shared.home.bookName?.trim() || shared.home.title,
      editableHere: false,
    };
  }
}

function summarize(items: readonly DossierUpgradeItem[]) {
  return {
    total: items.length,
    needsReview: items.filter((item) => item.requiresHumanReview).length,
    unclassified: items.filter((item) => item.destination === "unclassified").length,
    conflicts: items.filter((item) => item.conflictWithIds.length > 0 || (item.existingCanonical.trim() && item.existingCanonical !== item.proposedValue))
      .length,
    alreadyApplied: items.filter((item) => item.alreadyApplied).length,
  };
}

export async function previewCharacterDossierUpgrade(
  db: DbOrTx,
  projectId: string,
  recordId: string,
  options: { markdownOverride?: string } = {},
): Promise<CharacterDossierUpgradePreview> {
  const loaded = await loadDossier(db, projectId, recordId);
  const { record } = loaded;
  const issues: Issue[] = [];
  if (unsupportedCharacterDevelopmentVersion(record.fields)) {
    issues.push(
      errorIssue("INVALID_CHANGE", "This character development version is not supported. The stored profile was left unchanged.", {
        path: "version",
      }),
    );
  }
  const archiveRead = readDossierMarkdownArchiveWithStatus(record.fields);
  for (const problem of archiveRead.problems) {
    issues.push(errorIssue("INVALID_CHANGE", problem.message, { path: problem.path }));
  }
  const read = readCharacterDevelopment(record.fields);
  for (const problem of read.problems) {
    issues.push(errorIssue("INVALID_CHANGE", problem.message, { path: problem.path }));
  }
  const body = options.markdownOverride ?? record.body;
  const analysis = analyzeDossierUpgrade(body, read.profile);
  const previewToken = upgradePreviewToken({
    recordId: record.id,
    revision: record.currentRevision,
    bodyHash: analysis.bodyHash,
    fingerprint: analysis.fingerprint,
    archiveVersion: archiveRead.unsupportedVersion ? -1 : DOSSIER_MARKDOWN_ARCHIVE_VERSION,
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
      archiveRead.archive.appliedFingerprints.length > 0 && analysis.items.every((item) => item.alreadyApplied),
    issues,
    homeProjectId: loaded.homeProjectId,
    homeLabel: loaded.homeLabel,
    editableHere: loaded.editableHere,
    archiveUnsupported: archiveRead.unsupportedVersion,
    summary: summarize(analysis.items),
  };
}

export async function previewImportedDossierMarkdown(
  db: DbOrTx,
  projectId: string,
  recordId: string,
  markdown: string,
): Promise<CharacterDossierUpgradePreview> {
  return previewCharacterDossierUpgrade(db, projectId, recordId, { markdownOverride: markdown });
}

export function previewStandaloneMarkdown(markdown: string, profile?: CharacterDevelopment): DossierUpgradeAnalysis {
  return analyzeImportedMarkdown(markdown, profile);
}

export async function previewProjectDossierUpgrades(db: DbOrTx, projectId: string): Promise<ProjectDossierUpgradeSummary> {
  const rows = await db.record.findMany({
    where: { projectId, ...LIVE_RECORD, type: "character_dossier" },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
  const local = rows.map((row) => {
    const record = toRecordView(row);
    const read = readCharacterDevelopment(record.fields);
    const analysis = analyzeDossierUpgrade(record.body, read.profile);
    const archiveRead = readDossierMarkdownArchiveWithStatus(record.fields);
    const summary = summarize(analysis.items);
    return {
      recordId: record.id,
      title: record.title,
      revision: record.currentRevision,
      itemCount: summary.total,
      needsReview: summary.needsReview,
      unclassified: summary.unclassified,
      alreadyMigrated:
        archiveRead.archive.appliedFingerprints.length > 0 && analysis.items.every((item) => item.alreadyApplied),
      hasProfile: Boolean(record.fields.characterDevelopment),
      homeProjectId: projectId,
      homeLabel: "This book",
      editableHere: true,
    };
  });

  const shared = await listSeriesSharedRecords(db, projectId);
  const sharedDossiers = shared
    .filter((item) => item.record.type === "character_dossier")
    .map((item) => {
      const read = readCharacterDevelopment(item.record.fields);
      const analysis = analyzeDossierUpgrade(item.record.body, read.profile);
      const archiveRead = readDossierMarkdownArchiveWithStatus(item.record.fields);
      const summary = summarize(analysis.items);
      return {
        recordId: item.record.id,
        title: item.record.title,
        revision: item.record.currentRevision,
        itemCount: summary.total,
        needsReview: summary.needsReview,
        unclassified: summary.unclassified,
        alreadyMigrated:
          archiveRead.archive.appliedFingerprints.length > 0 && analysis.items.every((row) => row.alreadyApplied),
        hasProfile: Boolean(item.record.fields.characterDevelopment),
        homeProjectId: item.home.projectId,
        homeLabel: item.home.bookName?.trim() || item.home.title,
        editableHere: false,
      };
    });

  const seen = new Set(local.map((item) => item.recordId));
  const dossiers = [...local, ...sharedDossiers.filter((item) => !seen.has(item.recordId))];
  return { projectId, dossiers };
}

function validateConflictDecisions(
  analysis: DossierUpgradeAnalysis,
  decisions: readonly DossierUpgradeDecisionInput[],
): Issue[] {
  const issues: Issue[] = [];
  const byId = new Map(decisions.map((d) => [d.itemId, d]));
  for (const item of analysis.items) {
    const pick = byId.get(item.id);
    if (!pick) continue;
    if (decisionsRequireExplicitConflictChoice(item, pick.decision)) {
      issues.push(
        errorIssue(
          "INVALID_CHANGE",
          `Approved canon on ${item.fieldPath} needs Keep existing, Replace (modify), Merge, or Defer — not a silent Accept.`,
          { path: item.id },
        ),
      );
    }
    if (item.authorityHint === "ambiguous" && pick.decision === "accept" && item.requiresHumanReview) {
      // Accept on ambiguous is allowed (author is the review) but replace/merge/modify preferred when conflicting.
    }
  }
  return issues;
}

export async function applyCharacterDossierUpgrade(
  db: Db,
  projectId: string,
  input: {
    recordId: string;
    previewToken: string;
    decisions: DossierUpgradeDecisionInput[];
    markdownOverride?: string;
    unlockProtected?: boolean;
  },
): Promise<ApplyDossierUpgradeResult> {
  const loaded = await loadDossier(db, projectId, input.recordId);
  if (!loaded.editableHere || loaded.homeProjectId !== projectId) {
    return {
      status: "rejected",
      issues: [
        errorIssue(
          "INVALID_CHANGE",
          `This series character is edited in its home book (${loaded.homeLabel}). Open the home dossier to apply the upgrade.`,
        ),
      ],
    };
  }
  const record = loaded.record;
  if (unsupportedCharacterDevelopmentVersion(record.fields)) {
    return {
      status: "rejected",
      issues: [
        errorIssue("INVALID_CHANGE", "This character development version is not supported. The stored profile was left unchanged.", {
          path: "version",
        }),
      ],
    };
  }

  const archiveRead = readDossierMarkdownArchiveWithStatus(record.fields);
  if (archiveRead.unsupportedVersion) {
    return {
      status: "rejected",
      issues: archiveRead.problems.map((problem) => errorIssue("INVALID_CHANGE", problem.message, { path: problem.path })),
    };
  }

  const read = readCharacterDevelopment(record.fields);
  const body = input.markdownOverride ?? record.body;
  const analysis = analyzeDossierUpgrade(body, read.profile);
  const expectedToken = upgradePreviewToken({
    recordId: record.id,
    revision: record.currentRevision,
    bodyHash: analysis.bodyHash,
    fingerprint: analysis.fingerprint,
    archiveVersion: DOSSIER_MARKDOWN_ARCHIVE_VERSION,
  });
  if (input.previewToken !== expectedToken) {
    return {
      status: "rejected",
      issues: [errorIssue("STALE_PREVIEW", "The dossier changed since this upgrade preview. Preview again.")],
    };
  }

  for (const decision of input.decisions) {
    if (!analysis.items.some((item) => item.id === decision.itemId)) {
      return {
        status: "rejected",
        issues: [errorIssue("INVALID_CHANGE", `Unknown upgrade item ${decision.itemId}.`, { path: decision.itemId })],
      };
    }
  }

  const conflictIssues = validateConflictDecisions(analysis, input.decisions);
  if (conflictIssues.length) return { status: "rejected", issues: conflictIssues };

  const archive = archiveRead.archive;
  const decisionFingerprint = upgradeDecisionFingerprint(analysis.bodyHash, input.decisions);
  if (archive.appliedFingerprints.includes(decisionFingerprint)) {
    return { status: "already_applied", revision: record.currentRevision };
  }

  const applied = applyUpgradeDecisions(read.profile, analysis, input.decisions, archive, {
    body,
    sourceRevision: record.currentRevision,
  });

  if (applied.noEffectiveChange) {
    return { status: "already_applied", revision: record.currentRevision };
  }

  const problems = validateCharacterDevelopment(applied.profile);
  if (problems.length) {
    return {
      status: "rejected",
      issues: problems.map((problem) => errorIssue("INVALID_CHANGE", problem.message, { path: problem.path })),
    };
  }

  const fields = fieldsAfterUpgrade(record.fields as JsonObject, applied.profile, applied.archive);
  if (stableStringify(fields) === stableStringify(record.fields)) {
    return { status: "already_applied", revision: record.currentRevision };
  }
  if (
    stableStringify(applied.profile) === stableStringify(read.profile) &&
    archive.entries.some((entry) => entry.bodyHash === analysis.bodyHash)
  ) {
    return { status: "already_applied", revision: record.currentRevision };
  }

  try {
    const batch = await updateRecord(db, projectId, {
      recordId: record.id,
      expectedRevision: record.currentRevision,
      fields,
      unlockProtected: input.unlockProtected,
    });
    const outcome = batch.outcomes.find((item) => item.recordId === record.id);
    await writeAudit(db, {
      projectId,
      action: "character.dossier_upgrade",
      summary: `Upgraded Living Profile for "${record.title}"`,
      actor: "author",
      details: {
        recordId: record.id,
        appliedItemIds: applied.appliedItemIds,
        deferredItemIds: applied.deferredItemIds,
        rejectedItemIds: applied.rejectedItemIds,
        bodyHash: analysis.bodyHash,
        decisionFingerprint,
        markdownOverride: Boolean(input.markdownOverride),
      },
    });
    return {
      status: "applied",
      revision: outcome?.newRevision ?? record.currentRevision + 1,
      appliedItemIds: applied.appliedItemIds,
      deferredItemIds: applied.deferredItemIds,
      rejectedItemIds: applied.rejectedItemIds,
    };
  } catch (error) {
    if (error instanceof MutationRejectedError) return { status: "rejected", issues: error.issues };
    throw error;
  }
}

export async function buildCharacterDossierUpgradePackage(
  db: DbOrTx,
  projectId: string,
  input: {
    recordId: string;
    previewToken: string;
    decisions: DossierUpgradeDecisionInput[];
    markdownOverride?: string;
  },
): Promise<{ ok: true; pkg: ChangePackageV1 } | { ok: false; issues: Issue[] }> {
  const project = await getProject(db, projectId);
  const loaded = await loadDossier(db, projectId, input.recordId);
  if (!loaded.editableHere || loaded.homeProjectId !== projectId) {
    return {
      ok: false,
      issues: [
        errorIssue(
          "INVALID_CHANGE",
          `This series character is edited in its home book (${loaded.homeLabel}). Open the home dossier to export a package.`,
        ),
      ],
    };
  }
  const record = loaded.record;
  const archiveRead = readDossierMarkdownArchiveWithStatus(record.fields);
  if (archiveRead.unsupportedVersion) {
    return {
      ok: false,
      issues: archiveRead.problems.map((problem) => errorIssue("INVALID_CHANGE", problem.message, { path: problem.path })),
    };
  }
  const read = readCharacterDevelopment(record.fields);
  const body = input.markdownOverride ?? record.body;
  const analysis = analyzeDossierUpgrade(body, read.profile);
  const expectedToken = upgradePreviewToken({
    recordId: record.id,
    revision: record.currentRevision,
    bodyHash: analysis.bodyHash,
    fingerprint: analysis.fingerprint,
    archiveVersion: DOSSIER_MARKDOWN_ARCHIVE_VERSION,
  });
  if (input.previewToken !== expectedToken) {
    return { ok: false, issues: [errorIssue("STALE_PREVIEW", "The dossier changed since this upgrade preview. Preview again.")] };
  }
  const conflictIssues = validateConflictDecisions(analysis, input.decisions);
  if (conflictIssues.length) return { ok: false, issues: conflictIssues };
  const applied = applyUpgradeDecisions(read.profile, analysis, input.decisions, archiveRead.archive, {
    body,
    sourceRevision: record.currentRevision,
  });
  const fields = fieldsAfterUpgrade(record.fields as JsonObject, applied.profile, applied.archive);
  return {
    ok: true,
    pkg: buildUpgradeChangePackage({
      workspaceId: project.workspaceId,
      projectId,
      recordId: record.id,
      expectedRevision: record.currentRevision,
      title: record.title,
      fields,
    }),
  };
}
