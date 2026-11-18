import { z } from "zod";
import { RECORD_TYPES } from "@/domain/recordTypes";
import { AUTHORITY_STATUSES, REVIEW_ORIGINS, SOURCE_KINDS } from "@/domain/statuses";
import { IMAGE_MIME_TYPES, IMAGE_NAME_PATTERN, MAX_ALT_CHARS, MAX_CAPTION_CHARS, MAX_IMAGE_BYTES } from "@/images/imageFormat";
import { MAX_NOTE_CHARS, MAX_WORD_CHARS } from "@/spelling/dictionary";

export const BACKUP_FORMAT = "wordly.workspace-backup";
export const BACKUP_FORMAT_VERSION = 1;

const id = z.string().min(1).max(200);
const timestamp = z.iso.datetime();
const fields = z.record(z.string(), z.json());

/*
 * A complete, self-describing copy of one workspace: every project, record,
 * revision, provenance source, applied change package, audit entry, review
 * item, imported file, dictionary entry, reference link and image. JSON payload columns are kept as
 * the exact strings stored in the database.
 */
export const workspaceBackupV1Schema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    formatVersion: z.literal(BACKUP_FORMAT_VERSION),
    createdAt: timestamp,
    app: z.object({ name: z.literal("wordly-editor"), migrations: z.array(z.string()) }).strict(),
    /** `trashedAt` (added with the Trash) is present only for items in the Trash. */
    workspace: z.object({ id, name: z.string().min(1), createdAt: timestamp, trashedAt: timestamp.optional() }).strict(),
    projects: z.array(
      z
        .object({
          id,
          workspaceId: id,
          title: z.string().min(1),
          createdAt: timestamp,
          trashedAt: timestamp.optional(),
          /** Optional Series/Book/Draft assignments; omitted when unassigned. */
          seriesName: z.string().min(1).optional(),
          bookName: z.string().min(1).optional(),
          draftKind: z.enum(["zero_draft", "author_manuscript"]).optional(),
          /** Omitted when 0 (never assigned or cleared). */
          assignmentRevision: z.number().int().min(0).optional(),
          /** Explicit default drafts for Read / PDF; omitted when unset. */
          defaultReadingDraftId: id.optional(),
          defaultExportDraftId: id.optional(),
        })
        .strict(),
    ),
    /** Manuscript groups; omitted in backups written before Series/Book/Draft assignments. */
    manuscriptGroups: z
      .array(
        z
          .object({
            id,
            projectId: id,
            label: z.string().min(1),
            position: z.number().int().min(0),
            draftKind: z.enum(["zero_draft", "author_manuscript"]).nullable(),
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /** Zero draft / Author manuscript trees; omitted in older backups. */
    manuscriptDrafts: z
      .array(
        z
          .object({
            id,
            projectId: id,
            kind: z.enum(["zero_draft", "author_manuscript"]),
            label: z.string().min(1),
            completedAt: timestamp.nullable(),
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    records: z.array(
      z
        .object({
          id,
          projectId: id,
          type: z.enum(RECORD_TYPES),
          title: z.string(),
          body: z.string(),
          fields,
          authorityStatus: z.enum(AUTHORITY_STATUSES),
          supersededByRecordId: id.nullable(),
          protected: z.boolean(),
          /** Added with scenes; older backups have no parents. */
          parentRecordId: id.nullable().optional(),
          /** Book order; written only for chapters and scenes the author has moved. */
          position: z.number().int().min(0).optional(),
          /** Manuscript group; omitted when unassigned. */
          groupId: id.optional(),
          /** Manuscript draft; omitted when unassigned (legacy single manuscript). */
          draftId: id.optional(),
          /** World scope: book | series; omitted when unassigned. */
          worldScope: z.enum(["book", "series"]).optional(),
          currentRevision: z.number().int().min(1),
          trashedAt: timestamp.optional(),
          trashBatchId: id.optional(),
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .strict(),
    ),
    revisions: z.array(
      z
        .object({
          id,
          recordId: id,
          revisionNumber: z.number().int().min(1),
          title: z.string(),
          body: z.string(),
          fields,
          authorityStatus: z.enum(AUTHORITY_STATUSES),
          supersededByRecordId: id.nullable(),
          contentHash: z.string().regex(/^[0-9a-f]{64}$/),
          sourceId: id,
          createdAt: timestamp,
        })
        .strict(),
    ),
    sources: z.array(
      z
        .object({
          id,
          projectId: id,
          kind: z.enum(SOURCE_KINDS),
          actor: z.string(),
          conversationLabel: z.string().nullable(),
          url: z.string().nullable(),
          packageId: z.string().nullable(),
          originalFilename: z.string().nullable(),
          createdAt: timestamp,
        })
        .strict(),
    ),
    changePackages: z.array(
      z
        .object({
          projectId: id,
          packageId: z.string().min(1),
          formatVersion: z.number().int(),
          contentHash: z.string().regex(/^[0-9a-f]{64}$/),
          summary: z.string(),
          status: z.string(),
          rawJson: z.string(),
          resultJson: z.string(),
          appliedAt: timestamp,
        })
        .strict(),
    ),
    auditEntries: z.array(
      z
        .object({
          id,
          projectId: id,
          action: z.string(),
          actor: z.string(),
          sourceId: id.nullable(),
          packageId: z.string().nullable(),
          summary: z.string(),
          detailsJson: z.string(),
          createdAt: timestamp,
        })
        .strict(),
    ),
    reviewItems: z.array(
      z
        .object({
          id,
          projectId: id,
          recordId: id,
          packageId: z.string().nullable(),
          triggeredByRecordId: id.nullable(),
          origin: z.enum(REVIEW_ORIGINS),
          note: z.string(),
          status: z.enum(["open", "resolved"]),
          createdAt: timestamp,
          resolvedAt: timestamp.nullable(),
        })
        .strict(),
    ),
    importedFiles: z.array(
      z
        .object({
          id,
          projectId: id,
          batchId: id,
          originalFilename: z.string(),
          contentHash: z.string().regex(/^[0-9a-f]{64}$/),
          content: z.string(),
          byteSize: z.number().int().min(0),
          recordId: id,
          action: z.enum(["created", "replaced"]),
          revisionNumber: z.number().int().min(1),
          sourceId: id,
          createdAt: timestamp,
        })
        .strict(),
    ),
    /** Added after the first v1 backups; a backup without it restores with an empty dictionary. */
    dictionaryEntries: z
      .array(
        z
          .object({
            id,
            workspaceId: id,
            /** null: applies to every project in the workspace. */
            projectId: id.nullable(),
            word: z.string().min(1).max(MAX_WORD_CHARS),
            caseSensitive: z.boolean(),
            note: z.string().max(MAX_NOTE_CHARS),
            origin: z.string(),
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /** Added with scenes; a backup without it restores with no reference links. */
    recordLinks: z
      .array(
        z
          .object({
            id,
            projectId: id,
            fromRecordId: id,
            toRecordId: id,
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /** Author-rewrite pins to exact Zero-draft revisions; omitted in older backups. */
    rewriteSourceLinks: z
      .array(
        z
          .object({
            id,
            projectId: id,
            fromRecordId: id,
            toRecordId: id,
            toRevisionNumber: z.number().int().min(1),
            position: z.number().int().min(0),
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /** Ordered reading pins for references beside prose; omitted in older backups → empty. */
    readingPins: z
      .array(
        z
          .object({
            id,
            projectId: id,
            /** Manuscript draft id, or "" for legacy project-level pins. */
            scopeDraftId: z.string().max(200),
            recordId: id,
            position: z.number().int().min(0),
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /** World boards; omitted in older backups → no boards. */
    boards: z
      .array(
        z
          .object({
            id,
            projectId: id,
            title: z.string().min(1),
            templateKey: z.enum(["blank", "geography"]),
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /** Cards on World boards (positions + source links); omitted → empty. */
    boardCards: z
      .array(
        z
          .object({
            id,
            boardId: id,
            projectId: id,
            kind: z.enum(["record", "image", "note"]),
            recordId: id.nullable().optional(),
            imageId: id.nullable().optional(),
            noteTitle: z.string(),
            noteBody: z.string(),
            x: z.number().int(),
            y: z.number().int(),
            width: z.number().int().min(1),
            height: z.number().int().min(1),
            zIndex: z.number().int(),
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /** Added with images; a backup without it restores with no images. */
    recordImages: z
      .array(
        z
          .object({
            id,
            projectId: id,
            recordId: id,
            name: z.string().regex(IMAGE_NAME_PATTERN),
            originalFilename: z.string().max(255),
            mimeType: z.enum(IMAGE_MIME_TYPES),
            byteSize: z.number().int().min(1).max(MAX_IMAGE_BYTES),
            width: z.number().int().min(1),
            height: z.number().int().min(1),
            contentHash: z.string().regex(/^[0-9a-f]{64}$/),
            /** The image file, base64-encoded. */
            dataBase64: z.base64(),
            caption: z.string().max(MAX_CAPTION_CHARS),
            altText: z.string().max(MAX_ALT_CHARS),
            position: z.number().int(),
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    counts: z
      .object({
        projects: z.number().int(),
        records: z.number().int(),
        revisions: z.number().int(),
        sources: z.number().int(),
        changePackages: z.number().int(),
        auditEntries: z.number().int(),
        reviewItems: z.number().int(),
        importedFiles: z.number().int(),
        dictionaryEntries: z.number().int().optional(),
        recordLinks: z.number().int().optional(),
        recordImages: z.number().int().optional(),
        manuscriptGroups: z.number().int().optional(),
        manuscriptDrafts: z.number().int().optional(),
        rewriteSourceLinks: z.number().int().optional(),
        readingPins: z.number().int().optional(),
        boards: z.number().int().optional(),
        boardCards: z.number().int().optional(),
      })
      .strict(),
    /** sha256 of the stable JSON serialization of every other top-level field. */
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type WorkspaceBackupV1 = z.output<typeof workspaceBackupV1Schema>;
export type BackupCounts = WorkspaceBackupV1["counts"];
