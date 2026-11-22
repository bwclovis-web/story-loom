import {
  analyzeDossierUpgrade,
  analyzeImportedMarkdown,
  applyUpgradeDecisions,
  buildUpgradeChangePackage,
  fieldsAfterUpgrade,
  readDossierMarkdownArchive,
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
import { MutationRejectedError } from "./errors";
import { getProject } from "./projectService";
import { getRecord, updateRecord } from "./recordService";
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

async function loadDossier(db: DbOrTx, projectId: string, recordId: string): Promise<RecordView> {
  const record = await getRecord(db, projectId, recordId);
  if (record.type !== "character_dossier") {
    throw new MutationRejectedError([errorIssue("INVALID_CHANGE", "Upgrade applies only to character dossiers.")]);
  }
  return record;
}

function summarize(items: readonly DossierUpgradeItem[]) {
  return {
    total: items.length,
    needsReview: items.filter((item) => item.requiresHumanReview).length,
    unclassified: items.filter((item) => item.destination === "unclassified").length,
    conflicts: items.filter((item) => item.conflictWithIds.length > 0).length,
    alreadyApplied: items.filter((item) => item.alreadyApplied).length,
  };
}

export async function previewCharacterDossierUpgrade(
  db: DbOrTx,
  projectId: string,
  recordId: string,
  options: { markdownOverride?: string } = {},
): Promise<CharacterDossierUpgradePreview> {
  const record = await loadDossier(db, projectId, recordId);
  const issues: Issue[] = [];
  if (unsupportedCharacterDevelopmentVersion(record.fields)) {
    issues.push(
      errorIssue("INVALID_CHANGE", "This character development version is not supported. The stored profile was left unchanged.", {
        path: "version",
      }),
    );
  }
  const read = readCharacterDevelopment(record.fields);
  for (const problem of read.problems) {
    issues.push(errorIssue("INVALID_CHANGE", problem.message, { path: problem.path }));
  }
  const body = options.markdownOverride ?? record.body;
  const analysis = analyzeDossierUpgrade(body, read.profile);
  const archive = readDossierMarkdownArchive(record.fields);
  const previewToken = upgradePreviewToken({
    recordId: record.id,
    revision: record.currentRevision,
    bodyHash: analysis.bodyHash,
    fingerprint: analysis.fingerprint,
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
    archiveEntryCount: archive.entries.length,
    alreadyMigrated: archive.appliedFingerprints.length > 0 && analysis.items.every((item) => item.alreadyApplied),
    issues,
    summary: summarize(analysis.items),
  };
}

/** Analyze pasted Markdown against the current profile without writing. */
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
  const dossiers = rows.map((row) => {
    const record = toRecordView(row);
    const read = readCharacterDevelopment(record.fields);
    const analysis = analyzeDossierUpgrade(record.body, read.profile);
    const archive = readDossierMarkdownArchive(record.fields);
    const summary = summarize(analysis.items);
    return {
      recordId: record.id,
      title: record.title,
      revision: record.currentRevision,
      itemCount: summary.total,
      needsReview: summary.needsReview,
      unclassified: summary.unclassified,
      alreadyMigrated: archive.appliedFingerprints.length > 0 && analysis.items.every((item) => item.alreadyApplied),
      hasProfile: Boolean(record.fields.characterDevelopment),
    };
  });
  return { projectId, dossiers };
}

export async function applyCharacterDossierUpgrade(
  db: Db,
  projectId: string,
  input: {
    recordId: string;
    previewToken: string;
    decisions: DossierUpgradeDecisionInput[];
    /** When set, analyze this Markdown instead of the stored body (import path). Body is not replaced. */
    markdownOverride?: string;
    unlockProtected?: boolean;
  },
): Promise<ApplyDossierUpgradeResult> {
  const record = await loadDossier(db, projectId, input.recordId);
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

  const read = readCharacterDevelopment(record.fields);
  const body = input.markdownOverride ?? record.body;
  const analysis = analyzeDossierUpgrade(body, read.profile);
  const expectedToken = upgradePreviewToken({
    recordId: record.id,
    revision: record.currentRevision,
    bodyHash: analysis.bodyHash,
    fingerprint: analysis.fingerprint,
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

  const pendingReview = analysis.items.filter((item) => {
    const pick = input.decisions.find((decision) => decision.itemId === item.id);
    if (!pick || pick.decision === "defer" || pick.decision === "reject") return false;
    return item.requiresHumanReview && pick.decision === "accept" && item.authorityHint === "ambiguous";
  });
  // Accepting ambiguous items is allowed — the author is the review. No auto-approve of canon happens in applyUpgradeDecisions.

  const archive = readDossierMarkdownArchive(record.fields);
  const decisionFingerprint = upgradeDecisionFingerprint(analysis.fingerprint, input.decisions);
  if (archive.appliedFingerprints.includes(decisionFingerprint)) {
    return { status: "already_applied", revision: record.currentRevision };
  }

  const applied = applyUpgradeDecisions(read.profile, analysis, input.decisions, archive, {
    body,
    sourceRevision: record.currentRevision,
  });

  if (applied.noEffectiveChange && applied.appliedItemIds.length === 0) {
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
  // Same profile content with an archive body already stored is a no-op even if
  // a new decision fingerprint would only annotate the archive.
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
        pendingReviewCount: pendingReview.length,
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
  const record = await loadDossier(db, projectId, input.recordId);
  const read = readCharacterDevelopment(record.fields);
  const body = input.markdownOverride ?? record.body;
  const analysis = analyzeDossierUpgrade(body, read.profile);
  const expectedToken = upgradePreviewToken({
    recordId: record.id,
    revision: record.currentRevision,
    bodyHash: analysis.bodyHash,
    fingerprint: analysis.fingerprint,
  });
  if (input.previewToken !== expectedToken) {
    return { ok: false, issues: [errorIssue("STALE_PREVIEW", "The dossier changed since this upgrade preview. Preview again.")] };
  }
  const archive = readDossierMarkdownArchive(record.fields);
  const applied = applyUpgradeDecisions(read.profile, analysis, input.decisions, archive, {
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
