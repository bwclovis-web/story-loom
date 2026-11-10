import type { DiffPart } from "@/changePackage/diff";
import type { Issue } from "@/domain/issues";
import { contentClassOf, type ContentClass, type RecordType } from "@/domain/recordTypes";
import type { ApplyOutcome, OperationPreview, PackageApplyResult, PackagePreview } from "@/server/services/changePackageService";

/*
 * Pure logic behind the change review screen. It only describes the package
 * as validated by changePackageService; nothing here decides what is applied.
 * A package is applied whole or not at all, so selection only chooses which
 * record's changes are shown.
 */

export interface ReviewRecord {
  recordId: string;
  title: string;
  /** Current title when the package renames the record. */
  previousTitle: string | null;
  type: RecordType;
  contentClass: ContentClass;
  isNew: boolean;
  idAssignedOnApply: boolean;
  operations: OperationPreview[];
  /** Short labels of what changes, e.g. "Text", "2 fields", "Status: proposed → approved". */
  changes: string[];
  errors: Issue[];
  stale: boolean;
  protected: boolean;
  usesProtectedOverride: boolean;
  expectedRevision: number | null;
  currentRevision: number | null;
}

function changeLabels(ops: readonly OperationPreview[]): string[] {
  const labels: string[] = [];
  for (const op of ops) {
    const isNew = op.titleBefore === null;
    if (isNew) labels.push("New record");
    if (!isNew && op.titleBefore !== op.titleAfter) labels.push("Title");
    if (!isNew && op.bodyChanged) labels.push("Text");
    if (op.fieldDiffs.length) labels.push(op.fieldDiffs.length === 1 ? "1 field" : `${op.fieldDiffs.length} fields`);
    if (op.statusBefore !== op.statusAfter) {
      labels.push(op.statusBefore ? `Status: ${op.statusBefore} → ${op.statusAfter}` : `Status: ${op.statusAfter}`);
    }
    if (op.supersededByBefore !== op.supersededByAfter) labels.push("Superseded by");
  }
  const unique = [...new Set(labels)];
  return unique.length ? unique : ["No effective change"];
}

/** The package's operations grouped by record, in package order. */
export function reviewRecords(preview: Pick<PackagePreview, "operations">): ReviewRecord[] {
  const groups = new Map<string, OperationPreview[]>();
  for (const op of preview.operations) {
    const list = groups.get(op.recordId);
    if (list) list.push(op);
    else groups.set(op.recordId, [op]);
  }
  return [...groups.entries()].map(([recordId, ops]) => {
    const first = ops[0];
    const last = ops[ops.length - 1];
    const errors = ops.flatMap((o) => o.issues.filter((i) => i.severity === "error"));
    const expected = ops.map((o) => o.expectedRevision).filter((n): n is number => n !== null);
    return {
      recordId,
      title: last.titleAfter,
      previousTitle: first.titleBefore !== null && first.titleBefore !== last.titleAfter ? first.titleBefore : null,
      type: first.type,
      contentClass: first.contentClass,
      isNew: first.titleBefore === null,
      idAssignedOnApply: first.idAssignedOnApply,
      operations: ops,
      changes: changeLabels(ops),
      errors,
      stale: errors.some((i) => i.code === "STALE_REVISION"),
      protected: ops.some((o) => o.protected),
      usesProtectedOverride: ops.some((o) => o.usesProtectedOverride),
      expectedRevision: expected.length ? Math.min(...expected) : null,
      currentRevision: first.currentRevision,
    };
  });
}

export type ValidationState = "ready" | "stale" | "not_approved" | "invalid" | "already_applied";

export function validationState(preview: Pick<PackagePreview, "status" | "canApply" | "issues">): ValidationState {
  if (preview.status === "already_applied") return "already_applied";
  const errors = preview.issues.filter((i) => i.severity === "error");
  if (preview.canApply && errors.length === 0) return "ready";
  if (errors.some((i) => i.code === "STALE_REVISION")) return "stale";
  if (errors.length > 0 && errors.every((i) => i.code === "NOT_APPROVED")) return "not_approved";
  return "invalid";
}

export interface RevisionCheck {
  recordId: string;
  title: string;
  expected: number;
  current: number | null;
  ok: boolean;
}

export interface ReviewSummary {
  recordCount: number;
  updatedCount: number;
  createdCount: number;
  /** Records of manuscript content (chapters, scenes) that an operation changes or creates. */
  manuscriptRecords: ReviewRecord[];
  /** Manuscript records that only mention a changed record. They are not changed. */
  manuscriptMentions: number;
  protectedRecords: { recordId: string; title: string; override: boolean }[];
  requiresProtectedConfirmation: boolean;
  revisionChecks: RevisionCheck[];
  staleCount: number;
  affectedCount: number;
}

export function reviewSummary(preview: PackagePreview, records: ReviewRecord[] = reviewRecords(preview)): ReviewSummary {
  const revisionChecks = records
    .filter((r) => r.expectedRevision !== null)
    .map((r) => ({
      recordId: r.recordId,
      title: r.title,
      expected: r.expectedRevision as number,
      current: r.currentRevision,
      ok: !r.stale && r.currentRevision === r.expectedRevision,
    }));
  return {
    recordCount: records.length,
    updatedCount: records.filter((r) => !r.isNew).length,
    createdCount: records.filter((r) => r.isNew).length,
    manuscriptRecords: records.filter((r) => r.contentClass === "manuscript"),
    manuscriptMentions: preview.potentialEffects.filter((e) => contentClassOf(e.type) === "manuscript").length,
    protectedRecords: records.filter((r) => r.protected).map((r) => ({ recordId: r.recordId, title: r.title, override: r.usesProtectedOverride })),
    requiresProtectedConfirmation: preview.requiresProtectedConfirmation,
    revisionChecks,
    staleCount: revisionChecks.filter((c) => !c.ok).length,
    affectedCount: preview.relatedNotes.length + preview.potentialEffects.length,
  };
}

/* ---------- text comparison ---------- */

export type Segment =
  | { kind: "same" | "added" | "removed"; text: string }
  | { kind: "folded"; text: string; lines: number };

export function unifiedSegments(parts: readonly DiffPart[]): Segment[] {
  return parts.map((p) => ({ kind: p.added ? "added" : p.removed ? "removed" : "same", text: p.value }));
}

/** Before and after columns: the before side drops additions, the after side drops removals. */
export function sideBySideSegments(parts: readonly DiffPart[]): { before: Segment[]; after: Segment[] } {
  const before: Segment[] = [];
  const after: Segment[] = [];
  for (const p of parts) {
    if (p.added) after.push({ kind: "added", text: p.value });
    else if (p.removed) before.push({ kind: "removed", text: p.value });
    else {
      before.push({ kind: "same", text: p.value });
      after.push({ kind: "same", text: p.value });
    }
  }
  return { before, after };
}

/**
 * Folds long unchanged stretches so changes in long documents stay findable.
 * Folded text is kept whole; the view lets the reader expand it.
 */
export function foldUnchanged(segments: readonly Segment[], context = 3, minFolded = 6): Segment[] {
  const out: Segment[] = [];
  segments.forEach((s, i) => {
    if (s.kind !== "same") {
      out.push(s);
      return;
    }
    const lines = s.text.split("\n");
    const keepHead = i === 0 ? 0 : context;
    const keepTail = i === segments.length - 1 ? 0 : context;
    const foldedCount = lines.length - keepHead - keepTail;
    if (foldedCount < minFolded) {
      out.push(s);
      return;
    }
    const head = lines.slice(0, keepHead).map((l) => `${l}\n`).join("");
    const middleLines = lines.slice(keepHead, lines.length - keepTail);
    const middle = middleLines.join("\n") + (keepTail > 0 ? "\n" : "");
    const tail = lines.slice(lines.length - keepTail).join("\n");
    if (head) out.push({ kind: "same", text: head });
    out.push({ kind: "folded", text: middle, lines: middleLines.length });
    if (tail) out.push({ kind: "same", text: tail });
  });
  return out;
}

/* ---------- screen state ---------- */

export type ApplyPhase =
  | { kind: "idle" }
  | { kind: "applying" }
  | { kind: "applied"; result: PackageApplyResult; warnings: Issue[] }
  | { kind: "already_applied"; result: PackageApplyResult }
  | { kind: "rejected"; issues: Issue[] }
  | { kind: "failed"; message: string };

export interface ReviewState {
  preview: PackagePreview;
  selectedId: string | null;
  phase: ApplyPhase;
  confirmProtected: boolean;
  confirmCanon: boolean;
  checking: boolean;
  checkedAt: number;
  /** The package was ready when the screen opened and is now out of date. */
  becameStale: boolean;
}

export type ApplyResponse = ApplyOutcome | { status: "failed"; message: string };

export type ReviewAction =
  | { type: "select"; recordId: string }
  | { type: "move"; by: number }
  | { type: "first" }
  | { type: "last" }
  | { type: "confirmProtected"; value: boolean }
  | { type: "confirmCanon"; value: boolean }
  | { type: "submit" }
  | { type: "response"; response: ApplyResponse }
  | { type: "checking" }
  | { type: "checked"; preview: PackagePreview; at: number }
  | { type: "checkFailed"; at: number };

function phaseFor(preview: PackagePreview): ApplyPhase {
  return preview.status === "already_applied" && preview.previousResult
    ? { kind: "already_applied", result: preview.previousResult }
    : { kind: "idle" };
}

export function initialReviewState(preview: PackagePreview, at = 0): ReviewState {
  return {
    preview,
    selectedId: reviewRecords(preview)[0]?.recordId ?? null,
    phase: phaseFor(preview),
    confirmProtected: false,
    confirmCanon: false,
    checking: false,
    checkedAt: at,
    becameStale: false,
  };
}

export interface SubmitRequirements {
  /** The author must confirm canon changes (assistant proposals). */
  canonRequired: boolean;
}

export function isFinished(phase: ApplyPhase): boolean {
  return phase.kind === "applied" || phase.kind === "already_applied";
}

/** Whether Apply may be pressed now. The server checks everything again. */
export function canSubmit(state: ReviewState, req: SubmitRequirements): boolean {
  if (state.phase.kind === "applying" || isFinished(state.phase) || state.checking) return false;
  if (validationState(state.preview) !== "ready") return false;
  if (state.preview.requiresProtectedConfirmation && !state.confirmProtected) return false;
  if (req.canonRequired && !state.confirmCanon) return false;
  return true;
}

function protectedKey(preview: PackagePreview): string {
  return preview.operations
    .filter((o) => o.usesProtectedOverride)
    .map((o) => o.recordId)
    .sort()
    .join(",");
}

function canonKey(preview: PackagePreview): string {
  return preview.operations
    .filter((o) => o.statusAfter === "approved")
    .map((o) => `${o.recordId}:${o.statusBefore ?? "new"}:${o.currentRevision ?? 0}`)
    .sort()
    .join(",");
}

export function reviewReducer(state: ReviewState, action: ReviewAction, req: SubmitRequirements = { canonRequired: false }): ReviewState {
  const ids = reviewRecords(state.preview).map((r) => r.recordId);
  switch (action.type) {
    case "select":
      return ids.includes(action.recordId) ? { ...state, selectedId: action.recordId } : state;
    case "move": {
      if (!ids.length) return state;
      const at = Math.max(0, ids.indexOf(state.selectedId ?? ""));
      const next = Math.min(ids.length - 1, Math.max(0, at + action.by));
      return { ...state, selectedId: ids[next] };
    }
    case "first":
      return ids.length ? { ...state, selectedId: ids[0] } : state;
    case "last":
      return ids.length ? { ...state, selectedId: ids[ids.length - 1] } : state;
    case "confirmProtected":
      return { ...state, confirmProtected: action.value };
    case "confirmCanon":
      return { ...state, confirmCanon: action.value };
    case "submit":
      return canSubmit(state, req) ? { ...state, phase: { kind: "applying" } } : state;
    case "response": {
      if (state.phase.kind !== "applying") return state;
      const r = action.response;
      if (r.status === "applied") return { ...state, phase: { kind: "applied", result: r.result, warnings: r.warnings } };
      if (r.status === "already_applied") return { ...state, phase: { kind: "already_applied", result: r.result } };
      if (r.status === "rejected") return { ...state, phase: { kind: "rejected", issues: r.issues } };
      return { ...state, phase: { kind: "failed", message: r.message } };
    }
    case "checking":
      return { ...state, checking: true };
    case "checkFailed":
      return { ...state, checking: false };
    case "checked": {
      const preview = action.preview;
      const nextIds = reviewRecords(preview).map((r) => r.recordId);
      const wasReady = validationState(state.preview) === "ready";
      const nowStale = validationState(preview) === "stale";
      let phase = state.phase;
      if (phase.kind !== "applying" && !isFinished(phase) && preview.status === "already_applied" && preview.previousResult) {
        phase = { kind: "already_applied", result: preview.previousResult };
      }
      return {
        ...state,
        preview,
        phase,
        checking: false,
        checkedAt: action.at,
        selectedId: state.selectedId && nextIds.includes(state.selectedId) ? state.selectedId : (nextIds[0] ?? null),
        confirmProtected: protectedKey(preview) === protectedKey(state.preview) ? state.confirmProtected : false,
        confirmCanon: canonKey(preview) === canonKey(state.preview) ? state.confirmCanon : false,
        becameStale: state.becameStale || (wasReady && nowStale),
      };
    }
  }
}

/**
 * Runs an apply request at most once at a time. A second call while one is
 * in flight returns null without calling the server.
 */
export function singleFlight<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R | null> {
  let running = false;
  return async (...args: A) => {
    if (running) return null;
    running = true;
    try {
      return await fn(...args);
    } finally {
      running = false;
    }
  };
}
