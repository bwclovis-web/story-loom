import type { OperationPreview, PackageApplyResult, PackageHeader, PackagePreview } from "@/server/services/changePackageService";

/* Invented change-package previews for review screen tests. */

export function header(over: Partial<PackageHeader> = {}): PackageHeader {
  return {
    packageId: "pkg_invented_001",
    formatVersion: 1,
    workspaceId: "wsp_invented",
    projectId: "prj_invented",
    summary: "Lamplighter updates",
    source: null,
    approval: { status: "approved" },
    scope: "reference",
    protectedOverrides: [],
    contentHash: "x".repeat(64),
    ...over,
  };
}

export function op(over: Partial<OperationPreview> = {}): OperationPreview {
  return {
    index: 0,
    op: "update_record",
    recordId: "rec_invented_a1",
    idAssignedOnApply: false,
    type: "character_dossier",
    contentClass: "reference",
    protected: false,
    usesProtectedOverride: false,
    expectedRevision: 2,
    currentRevision: 2,
    titleBefore: "Ilse Marrow",
    titleAfter: "Ilse Marrow",
    bodyDiff: [{ value: "Keeper of " }, { value: "lamps", removed: true }, { value: "bells", added: true }],
    bodyChanged: true,
    fieldDiffs: [],
    statusBefore: "draft",
    statusAfter: "draft",
    supersededByBefore: null,
    supersededByAfter: null,
    issues: [],
    ...over,
  };
}

export function preview(over: Partial<PackagePreview> = {}): PackagePreview {
  return {
    status: "valid",
    canApply: true,
    requiresProtectedConfirmation: false,
    issues: [],
    header: null,
    operations: [op()],
    relatedNotes: [],
    potentialEffects: [],
    previousResult: null,
    ...over,
  };
}

export const appliedResult: PackageApplyResult = {
  packageId: "pkg_invented_001",
  projectId: "prj_invented",
  summary: "Invented summary",
  contentHash: "x".repeat(64),
  appliedAt: "2026-10-26T12:00:00.000Z",
  sourceId: "src_1",
  auditEntryId: "aud_1",
  changes: [],
  createdRecordIds: [],
  reviewItems: [],
};
