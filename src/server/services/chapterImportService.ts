import { newId } from "@/domain/ids";
import { errorIssue, hasErrors, warningIssue, type Issue } from "@/domain/issues";
import { sha256 } from "@/domain/json";
import { documentKey, documentName, filenameNumber } from "@/writing/crossRefs";
import { tidyText } from "@/writing/tidy";
import { countWords } from "@/writing/wordCount";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { addBlankRewritePageInTx, manuscriptDraftPlacement } from "./draftService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { LIVE_PROJECT } from "./trashFilters";
import { applyMutationsInTx, planMutations, type Mutation, type MutationContext } from "./mutationService";

/*
 * Imports Markdown files as manuscript chapters, only when the author picks
 * them on the Import chapters page. Every chapter is created as a protected
 * draft; nothing is inferred from filenames except a suggested title and the
 * order. A file that matches an existing chapter needs an explicit choice:
 * create a new chapter, replace that chapter's text as a new revision, or skip.
 */

const CHAPTER_FILE = /\.(md|markdown|txt)$/i;
export const MAX_CHAPTER_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_CHAPTER_FILES = 200;

export interface ChapterFile {
  filename: string;
  content: string;
}

export type ChapterMatchReason = "same_filename" | "same_document" | "same_title" | "same_content";

export interface ChapterMatch {
  recordId: string;
  title: string;
  protected: boolean;
  currentRevision: number;
  reasons: ChapterMatchReason[];
}

export interface ChapterFilePreview {
  /** Position in the files as sent. */
  index: number;
  filename: string;
  byteSize: number;
  /** The number the filename starts with, used for order. */
  number: number | null;
  suggestedTitle: string;
  words: number;
  excerpt: string;
  /** True when the chapter text is longer than the excerpt. */
  excerptTruncated: boolean;
  matches: ChapterMatch[];
  /** Other files in this batch that are versions of the same chapter. */
  sameInBatch: string[];
  issues: Issue[];
}

export type ChapterDecision =
  | { action: "create" }
  | { action: "replace"; recordId: string; expectedRevision: number }
  | { action: "skip" };

export interface ChapterImportItem extends ChapterFile {
  title: string;
  decision?: ChapterDecision;
}

export interface ChapterImportRequest {
  projectId: string;
  items: ChapterImportItem[];
  /** The author ticked the box to replace protected chapters chosen for replacement. */
  confirmProtectedReplacements?: boolean;
  /** Tidy each file's text (see src/writing/tidy.ts) before it becomes chapter text. The original file is kept as it was. */
  tidy?: boolean;
  actor?: string;
  /** Provenance kind for created/replaced revisions. Defaults to markdown_import. */
  sourceKind?: "markdown_import" | "docx_import" | "scrivener_import";
}

export interface ChapterImportResult {
  filename: string;
  action: "created" | "replaced" | "skipped";
  recordId: string | null;
  title: string;
  revision: number | null;
  /** Blank Author manuscript page added for a new chapter, when a rewrite already exists. */
  rewriteRecordId: string | null;
}

export type ChapterImportOutcome =
  | { status: "applied"; batchId: string; results: ChapterImportResult[] }
  | { status: "rejected"; issues: Issue[] };

const stripBom = (text: string) => text.replace(/^\uFEFF/, "");
/** Chapter text is stored with plain newlines, as the editor saves it. */
const chapterBody = (text: string) => stripBom(text).replace(/\r\n?/g, "\n");
const importBody = (text: string, tidy: boolean) => (tidy ? tidyText(text).text : chapterBody(text));
const comparable = (text: string) => sha256(chapterBody(text).trim());
const normTitle = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const normFilename = (s: string) => s.trim().toLowerCase();

/** First level-1 heading, else the filename without number prefix, version and status words. */
export function suggestChapterTitle(filename: string, content: string): string {
  const heading = stripBom(content).match(/^#[ \t]+(.+?)[ \t#]*$/m);
  if (heading) return heading[1].trim().slice(0, 300);
  return (documentName(filename) || filename.replace(/^.*[\\/]/, "").replace(CHAPTER_FILE, "")).slice(0, 300) || "Untitled chapter";
}

/** Numbered files first, by number; then the rest in the order given. */
export function chapterOrder<T extends { filename: string }>(files: readonly T[]): T[] {
  return files
    .map((file, index) => ({ file, index, number: filenameNumber(file.filename) }))
    .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.index - b.index)
    .map((x) => x.file);
}

async function analyze(db: DbOrTx, projectId: string, files: readonly ChapterFile[], tidy: boolean): Promise<ChapterFilePreview[]> {
  const project = await db.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT } });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);

  const [chapters, imported] = await Promise.all([
    db.record.findMany({
      where: { projectId, type: "manuscript_chapter", trashedAt: null },
      select: { id: true, title: true, body: true, protected: true, currentRevision: true },
    }),
    db.importedFile.findMany({
      where: { projectId, record: { type: "manuscript_chapter", trashedAt: null } },
      select: { originalFilename: true, content: true, recordId: true },
    }),
  ]);

  return files.map((file, index) => {
    const issues: Issue[] = [];
    const at = { operationIndex: index, path: `items.${index}` };
    const byteSize = Buffer.byteLength(file.content, "utf8");
    if (!CHAPTER_FILE.test(file.filename)) {
      issues.push(errorIssue("IMPORT_INVALID", `${file.filename}: only .md, .markdown and .txt files can be imported.`, at));
    }
    if (!stripBom(file.content).trim()) issues.push(errorIssue("IMPORT_INVALID", `${file.filename} is empty.`, at));
    if (byteSize > MAX_CHAPTER_FILE_BYTES) issues.push(errorIssue("IMPORT_INVALID", `${file.filename} is larger than 5 MB.`, at));
    if (file.content.includes("\uFFFD")) {
      issues.push(warningIssue("IMPORT_INVALID", `${file.filename} contains replacement characters; it may not be UTF-8 text.`, at));
    }

    const title = suggestChapterTitle(file.filename, file.content);
    const body = importBody(file.content, tidy);
    const hash = comparable(file.content);
    const bodyHash = comparable(body);
    const name = normFilename(file.filename);
    const key = documentKey(file.filename);
    const reasons = new Map<string, Set<ChapterMatchReason>>();
    const mark = (id: string, reason: ChapterMatchReason) => reasons.set(id, (reasons.get(id) ?? new Set()).add(reason));
    for (const f of imported) {
      if (normFilename(f.originalFilename) === name) mark(f.recordId, "same_filename");
      else if (key && documentKey(f.originalFilename) === key) mark(f.recordId, "same_document");
      if (comparable(f.content) === hash) mark(f.recordId, "same_content");
    }
    for (const c of chapters) {
      if (normTitle(c.title) === normTitle(title)) mark(c.id, "same_title");
      if (comparable(c.body) === bodyHash) mark(c.id, "same_content");
    }
    const byId = new Map(chapters.map((c) => [c.id, c]));
    const matches = [...reasons]
      .filter(([id]) => byId.has(id))
      .map(([id, set]) => {
        const c = byId.get(id)!;
        return { recordId: c.id, title: c.title, protected: c.protected, currentRevision: c.currentRevision, reasons: [...set] };
      });

    const sameInBatch = files
      .filter((o, i) => i !== index && (normFilename(o.filename) === name || (key && documentKey(o.filename) === key)))
      .map((o) => o.filename);

    return {
      index,
      filename: file.filename,
      byteSize,
      number: filenameNumber(file.filename),
      suggestedTitle: title,
      words: countWords(body),
      excerpt: body.slice(0, 300),
      excerptTruncated: body.length > 300,
      matches,
      sameInBatch,
      issues,
    };
  });
}

/** Reads the database only; writes nothing. Files come back in import order. */
export async function previewChapterImport(
  db: DbOrTx,
  projectId: string,
  files: ChapterFile[],
  options: { tidy?: boolean } = {},
): Promise<ChapterFilePreview[]> {
  if (files.length > MAX_CHAPTER_FILES) throw new Error(`At most ${MAX_CHAPTER_FILES} files per import.`);
  return chapterOrder(await analyze(db, projectId, files, options.tidy === true));
}

function context(req: ChapterImportRequest, item: ChapterImportItem): MutationContext {
  const decision = item.decision;
  return {
    projectId: req.projectId,
    actor: req.actor ?? "author",
    source: { kind: req.sourceKind ?? "markdown_import", originalFilename: item.filename },
    scope: "manuscript",
    protectedOverrides: new Set(decision?.action === "replace" && req.confirmProtectedReplacements ? [decision.recordId] : []),
  };
}

function mutation(
  item: ChapterImportItem,
  recordId: string | undefined,
  index: number,
  tidy: boolean,
  draftId: string | null,
): Mutation {
  const body = importBody(item.content, tidy);
  if (item.decision?.action === "replace") {
    return {
      kind: "update_record",
      recordId: item.decision.recordId,
      expectedRevision: item.decision.expectedRevision,
      changes: { body },
      operationIndex: index,
    };
  }
  return {
    kind: "create_record",
    recordId,
    type: "manuscript_chapter",
    title: item.title.trim(),
    body,
    fields: {},
    authorityStatus: "draft",
    protected: true,
    draftId,
    operationIndex: index,
  };
}

async function validate(db: DbOrTx, req: ChapterImportRequest): Promise<Issue[]> {
  if (req.items.length === 0) return [errorIssue("EMPTY_BATCH", "No files to import.")];
  if (req.items.length > MAX_CHAPTER_FILES) return [errorIssue("IMPORT_INVALID", `At most ${MAX_CHAPTER_FILES} files per import.`)];
  const placement = await manuscriptDraftPlacement(db, req.projectId);
  const analysis = await analyze(db, req.projectId, req.items, req.tidy === true);
  const issues: Issue[] = [];
  const targets = new Map<string, string>();

  for (const [index, item] of req.items.entries()) {
    const at = (field: string) => ({ operationIndex: index, path: `items.${index}.${field}` });
    const name = item.filename;
    issues.push(...analysis[index].issues);
    if (item.decision?.action === "skip") continue;
    if (item.decision?.action !== "replace" && !item.title?.trim()) {
      issues.push(errorIssue("IMPORT_INVALID", `${name}: a chapter title is required.`, at("title")));
    }
    if (!item.decision && analysis[index].matches.length > 0) {
      issues.push(
        errorIssue(
          "IMPORT_DECISION_REQUIRED",
          `${name} matches an existing chapter. Choose: new chapter, replace that chapter's text, or skip.`,
          at("decision"),
        ),
      );
    }
    const clash = analysis[index].sameInBatch.filter((other) => {
      const o = req.items.find((i) => i.filename === other);
      return o && o.decision?.action !== "skip";
    });
    if (clash.length && index < req.items.findIndex((i) => i.filename === clash[0])) {
      issues.push(
        errorIssue("DUPLICATE_TARGET", `${name} and ${clash.join(", ")} are versions of the same chapter. Skip all but one.`, at("decision")),
      );
    }
    if (item.decision?.action === "replace") {
      const target = await db.record.findFirst({
        where: { id: item.decision.recordId, projectId: req.projectId, type: "manuscript_chapter", trashedAt: null },
      });
      if (!target) {
        issues.push(errorIssue("RECORD_NOT_FOUND", `${name}: the chapter to replace was not found.`, at("decision")));
        continue;
      }
      const prior = targets.get(target.id);
      if (prior) issues.push(errorIssue("DUPLICATE_TARGET", `${name} and ${prior} both replace "${target.title}".`, at("decision")));
      targets.set(target.id, name);
      if (target.protected && !req.confirmProtectedReplacements) {
        issues.push(
          errorIssue(
            "PROTECTED_CONFIRMATION_REQUIRED",
            `${name} replaces protected chapter "${target.title}". Tick the box to confirm replacing protected chapters.`,
            { ...at("decision"), recordId: target.id },
          ),
        );
      }
    }
  }
  if (hasErrors(issues)) return issues;

  for (const [index, item] of req.items.entries()) {
    if (item.decision?.action === "skip") continue;
    const plan = await planMutations(db, context(req, item), [
      mutation(item, undefined, index, req.tidy === true, item.decision?.action === "replace" ? null : placement.textDraftId),
    ]);
    for (const issue of plan.issues) {
      const hint = issue.code === "NO_EFFECTIVE_CHANGE" ? " The file matches the chapter exactly; choose skip." : "";
      issues.push({ ...issue, operationIndex: index, message: `${item.filename}: ${issue.message}${hint}` });
    }
  }
  if (req.items.every((i) => i.decision?.action === "skip")) {
    issues.push(errorIssue("EMPTY_BATCH", "Every file is set to skip; nothing to import."));
  }
  return issues;
}

/**
 * Validates everything, then writes the whole import in one transaction or nothing.
 * New chapters are created in filename-number order, so they list in that order.
 */
export async function applyChapterImport(db: Db, req: ChapterImportRequest): Promise<ChapterImportOutcome> {
  const issues = await validate(db, req);
  if (hasErrors(issues)) return { status: "rejected", issues };

  const ordered = chapterOrder(req.items.map((item, index) => ({ ...item, index })));
  const creating = ordered.filter((i) => !i.decision || i.decision.action === "create");
  const ids = creating.map(() => newId("rec")).sort();
  const newIds = new Map(creating.map((item, n) => [item.index, ids[n]]));
  const batchId = newId("bat");
  const actor = req.actor ?? "author";

  try {
    const results = await db.$transaction(
      async (tx) => {
        const placement = await manuscriptDraftPlacement(tx, req.projectId);
        const out: ChapterImportResult[] = [];
        for (const item of ordered) {
          if (item.decision?.action === "skip") {
            out.push({
              filename: item.filename,
              action: "skipped",
              recordId: null,
              title: item.title.trim(),
              revision: null,
              rewriteRecordId: null,
            });
            continue;
          }
          const replacing = item.decision?.action === "replace";
          const batch = await applyMutationsInTx(
            tx,
            context(req, item),
            [mutation(item, newIds.get(item.index), item.index, req.tidy === true, replacing ? null : placement.textDraftId)],
            {
              action: "chapter.import",
              summary: `${replacing ? "Replaced the text of" : "Imported"} chapter "${item.title.trim()}" from ${item.filename}`,
            },
          );
          const outcome = batch.outcomes[0];
          let rewriteRecordId: string | null = null;
          if (!replacing && placement.authorDraftId && placement.textDraftId && placement.textDraftId !== placement.authorDraftId) {
            const page = await addBlankRewritePageInTx(
              tx,
              req.projectId,
              { id: outcome.recordId, title: outcome.title, currentRevision: outcome.newRevision },
              placement.authorDraftId,
            );
            rewriteRecordId = page.recordId;
          }
          await tx.importedFile.create({
            data: {
              id: newId("imp"),
              projectId: req.projectId,
              batchId,
              originalFilename: item.filename,
              contentHash: sha256(item.content),
              content: item.content,
              byteSize: Buffer.byteLength(item.content, "utf8"),
              recordId: outcome.recordId,
              action: replacing ? "replaced" : "created",
              revisionNumber: outcome.newRevision,
              sourceId: batch.sourceId,
            },
          });
          out.push({
            filename: item.filename,
            action: replacing ? "replaced" : "created",
            recordId: outcome.recordId,
            title: outcome.title,
            revision: outcome.newRevision,
            rewriteRecordId,
          });
        }
        const counts = { created: 0, replaced: 0, skipped: 0 };
        for (const r of out) counts[r.action] += 1;
        await writeAudit(tx, {
          projectId: req.projectId,
          action: "chapter.import.batch",
          actor,
          summary: `Chapter import: ${counts.created} created, ${counts.replaced} replaced, ${counts.skipped} skipped`,
          details: {
            batchId,
            files: out.map((r) => ({
              filename: r.filename,
              action: r.action,
              recordId: r.recordId,
              revision: r.revision,
              rewriteRecordId: r.rewriteRecordId,
            })),
          },
        });
        return out;
      },
      { timeout: 120_000 },
    );
    return { status: "applied", batchId, results };
  } catch (error) {
    if (error instanceof MutationRejectedError) return { status: "rejected", issues: error.issues };
    throw error;
  }
}
