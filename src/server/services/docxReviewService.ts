import "server-only";
import { textDiff, type DiffPart } from "@/changePackage/diff";
import { errorIssue, hasErrors, type Issue } from "@/domain/issues";
import type { Db } from "../db";
import { writeAudit } from "./auditService";
import {
  docxBookmarkNameForRecord,
  parseDocx,
  splitDocxIntoChapters,
  type DocxParsedComment,
  type DocxTrackedSpan,
} from "./docxParse";
import { MutationRejectedError } from "./errors";
import { addMarginComment } from "./manuscriptAnnotationService";
import { applyMutationsInTx, planMutations, type Mutation, type MutationContext } from "./mutationService";
import { LIVE_PROJECT } from "./trashFilters";

export interface DocxReviewChapterPreview {
  index: number;
  title: string;
  recordId: string | null;
  recordTitle: string | null;
  protected: boolean;
  currentRevision: number | null;
  beforeBody: string;
  afterBody: string;
  bodyDiff: DiffPart[];
  hasBodyChange: boolean;
  matchReason: "anchor" | "title" | "order" | "none";
  comments: DocxParsedComment[];
  tracked: DocxTrackedSpan[];
  selected: boolean;
}

export interface DocxReviewPreview {
  filename: string;
  chapters: DocxReviewChapterPreview[];
  unmatchedComments: DocxParsedComment[];
  hasTrackedChanges: boolean;
  requiresProtectedConfirmation: boolean;
  issues: Issue[];
}

export interface DocxReviewApplyRequest {
  projectId: string;
  filename: string;
  bytes: ArrayBuffer | Uint8Array | Buffer;
  /** Chapter indexes to apply (body replace). */
  acceptIndexes: readonly number[];
  /** When true, also pin Word comments as margin comments after body apply. */
  importComments?: boolean;
  /** Import Word comments only; no body replacements. */
  commentsOnly?: boolean;
  confirmProtected?: boolean;
  actor?: string;
}

export type DocxReviewOutcome =
  | { status: "applied"; updated: Array<{ recordId: string; title: string; revision: number; commentsAdded: number }> }
  | { status: "rejected"; issues: Issue[] };

function normTitle(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

async function loadChapters(db: Db, projectId: string) {
  return db.record.findMany({
    where: { projectId, type: "manuscript_chapter", trashedAt: null },
    select: { id: true, title: true, body: true, protected: true, currentRevision: true, position: true, createdAt: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Preview an editor-marked .docx against live manuscript chapters. Read-only.
 * Matches by Story Loom bookmark (`sl-record:…`), then title, then book order.
 */
export async function previewDocxReview(
  db: Db,
  projectId: string,
  input: { filename: string; bytes: ArrayBuffer | Uint8Array | Buffer },
): Promise<DocxReviewPreview> {
  const project = await db.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT } });
  if (!project) {
    return {
      filename: input.filename,
      chapters: [],
      unmatchedComments: [],
      hasTrackedChanges: false,
      requiresProtectedConfirmation: false,
      issues: [errorIssue("RECORD_NOT_FOUND", `Project ${projectId} not found`)],
    };
  }

  const parsed = await parseDocx(input.bytes);
  const slices = splitDocxIntoChapters(parsed, input.filename.replace(/\.docx$/i, "") || "Manuscript");
  const live = await loadChapters(db, projectId);
  const used = new Set<string>();
  const chapters: DocxReviewChapterPreview[] = [];

  for (let index = 0; index < slices.length; index++) {
    const slice = slices[index]!;
    let match = slice.recordAnchor
      ? live.find((r) => !used.has(r.id) && docxBookmarkNameForRecord(r.id) === slice.recordAnchor)
      : undefined;
    let matchReason: DocxReviewChapterPreview["matchReason"] = match ? "anchor" : "none";
    if (!match) {
      match = live.find((r) => !used.has(r.id) && normTitle(r.title) === normTitle(slice.title));
      if (match) matchReason = "title";
    }
    if (!match && live[index] && !used.has(live[index]!.id)) {
      match = live[index];
      matchReason = "order";
    }
    if (match) used.add(match.id);

    const beforeBody = match?.body ?? "";
    const afterBody = slice.body.startsWith("#") ? slice.body : `# ${slice.title}\n\n${slice.body}`;
    const bodyDiff = textDiff(beforeBody, afterBody);
    const hasBodyChange = beforeBody !== afterBody;
    const chapterComments = parsed.comments.filter((c) => {
      if (!c.passageExcerpt) return false;
      return afterBody.includes(c.passageExcerpt.slice(0, Math.min(40, c.passageExcerpt.length)));
    });

    chapters.push({
      index,
      title: slice.title,
      recordId: match?.id ?? null,
      recordTitle: match?.title ?? null,
      protected: match?.protected ?? false,
      currentRevision: match?.currentRevision ?? null,
      beforeBody,
      afterBody,
      bodyDiff,
      hasBodyChange,
      matchReason,
      comments: chapterComments,
      tracked: parsed.tracked.filter((t) => afterBody.includes(t.text.slice(0, Math.min(20, t.text.length))) || beforeBody.includes(t.text.slice(0, Math.min(20, t.text.length)))),
      selected: Boolean(match && hasBodyChange),
    });
  }

  const claimed = new Set(chapters.flatMap((c) => c.comments.map((x) => x.id)));
  const unmatchedComments = parsed.comments.filter((c) => !claimed.has(c.id));
  const requiresProtectedConfirmation = chapters.some((c) => c.selected && c.protected && c.hasBodyChange);

  return {
    filename: input.filename,
    chapters,
    unmatchedComments,
    hasTrackedChanges: parsed.hasTrackedChanges,
    requiresProtectedConfirmation,
    issues: [],
  };
}

/**
 * Apply accepted chapter body replacements (and optional margin comments) from an editor DOCX.
 * Goes through mutationService; protected replaces need confirmProtected.
 */
export async function applyDocxReview(db: Db, req: DocxReviewApplyRequest): Promise<DocxReviewOutcome> {
  const preview = await previewDocxReview(db, req.projectId, { filename: req.filename, bytes: req.bytes });
  if (hasErrors(preview.issues)) return { status: "rejected", issues: preview.issues };

  const accept = new Set(req.acceptIndexes);
  const targets = preview.chapters.filter((c) => accept.has(c.index));
  const issues: Issue[] = [];

  if (targets.length === 0) {
    const message = req.commentsOnly
      ? "Choose at least one chapter with Word comments to import."
      : "Choose at least one chapter change to apply.";
    return { status: "rejected", issues: [errorIssue("IMPORT_INVALID", message)] };
  }

  const importComments = req.commentsOnly || req.importComments;

  for (const c of targets) {
    if (!c.recordId || c.currentRevision === null) {
      issues.push(errorIssue("IMPORT_INVALID", `“${c.title}” does not match a chapter in this project.`, { operationIndex: c.index }));
      continue;
    }
    if (req.commentsOnly) {
      if (!c.comments.length) {
        issues.push(
          errorIssue("NO_EFFECTIVE_CHANGE", `“${c.title}” has no Word comments to import.`, { recordId: c.recordId, operationIndex: c.index }),
        );
      }
    } else if (!c.hasBodyChange && !(importComments && c.comments.length)) {
      issues.push(errorIssue("NO_EFFECTIVE_CHANGE", `“${c.title}” has no accepted text change.`, { recordId: c.recordId, operationIndex: c.index }));
    }
    if (!req.commentsOnly && c.protected && c.hasBodyChange && !req.confirmProtected) {
      issues.push(
        errorIssue("PROTECTED_CONFIRMATION_REQUIRED", `Confirm replacing the protected chapter “${c.recordTitle ?? c.title}”.`, {
          recordId: c.recordId,
          operationIndex: c.index,
        }),
      );
    }
  }
  if (hasErrors(issues)) return { status: "rejected", issues };

  const actor = req.actor ?? "author";
  const protectedOverrides = new Set(
    req.commentsOnly
      ? []
      : targets.filter((c) => c.protected && c.hasBodyChange && req.confirmProtected).map((c) => c.recordId!),
  );
  const mutations: Mutation[] = req.commentsOnly
    ? []
    : targets
        .filter((c) => c.hasBodyChange && c.recordId && c.currentRevision !== null)
        .map((c) => ({
          kind: "update_record" as const,
          recordId: c.recordId!,
          expectedRevision: c.currentRevision!,
          changes: { body: c.afterBody },
        }));

  const ctx: MutationContext = {
    projectId: req.projectId,
    actor,
    source: { kind: "docx_import", originalFilename: req.filename, conversationLabel: "editor docx review" },
    scope: "manuscript",
    protectedOverrides,
  };

  try {
    const updated: Array<{ recordId: string; title: string; revision: number; commentsAdded: number }> = [];
    await db.$transaction(async (tx) => {
      if (mutations.length) {
        const planned = await planMutations(tx, ctx, mutations);
        if (hasErrors(planned.issues)) throw new MutationRejectedError(planned.issues);
        const batch = await applyMutationsInTx(tx, ctx, mutations, {
          action: "docx.review.apply",
          summary: `Applied editor DOCX review from ${req.filename}`,
        });
        for (const outcome of batch.outcomes) {
          const chapter = targets.find((c) => c.recordId === outcome.recordId);
          updated.push({
            recordId: outcome.recordId,
            title: chapter?.recordTitle ?? chapter?.title ?? outcome.recordId,
            revision: outcome.newRevision,
            commentsAdded: 0,
          });
        }
      } else {
        for (const c of targets) {
          if (c.recordId) updated.push({ recordId: c.recordId, title: c.recordTitle ?? c.title, revision: c.currentRevision!, commentsAdded: 0 });
        }
      }

      await writeAudit(tx, {
        projectId: req.projectId,
        action: "docx.review.batch",
        actor,
        summary: req.commentsOnly
          ? `Editor DOCX comments imported (${updated.length} chapter${updated.length === 1 ? "" : "s"}) from ${req.filename}`
          : `Editor DOCX review applied (${updated.length} chapter${updated.length === 1 ? "" : "s"}) from ${req.filename}`,
        details: { filename: req.filename, recordIds: updated.map((u) => u.recordId), commentsOnly: req.commentsOnly ?? false },
      });
    });

    if (importComments) {
      for (const c of targets) {
        if (!c.recordId) continue;
        const row = updated.find((u) => u.recordId === c.recordId);
        const revision = row?.revision ?? c.currentRevision!;
        let added = 0;
        for (const comment of c.comments) {
          const hay = c.afterBody;
          const needle = comment.passageExcerpt.slice(0, Math.min(80, comment.passageExcerpt.length));
          const start = needle ? hay.indexOf(needle) : -1;
          if (start < 0) continue;
          const end = start + Math.max(needle.length, 1);
          try {
            await addMarginComment(db, req.projectId, c.recordId, {
              passageStart: start,
              passageEnd: end,
              expectedRevision: revision,
              body: `${comment.author}: ${comment.body}`.slice(0, 4000),
            });
            added += 1;
          } catch {
            // Skip comments that no longer pin cleanly after apply.
          }
        }
        if (row) row.commentsAdded = added;
      }
    }

    return { status: "applied", updated };
  } catch (err) {
    if (err instanceof MutationRejectedError) return { status: "rejected", issues: err.issues };
    throw err;
  }
}
