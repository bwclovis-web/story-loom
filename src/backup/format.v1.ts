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
 * item, imported file, dictionary entry, reference link, image and project cover. JSON payload columns are kept as
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
    /** World maps (image backdrop); omitted in older backups → no maps. */
    worldMaps: z
      .array(
        z
          .object({
            id,
            projectId: id,
            title: z.string().min(1),
            imageId: id,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /** Pins on World maps (normalized 0–1 positions); omitted → empty. */
    worldMapPins: z
      .array(
        z
          .object({
            id,
            mapId: id,
            projectId: id,
            /** Omitted or null when the marker opens a map only. Older backups always set this. */
            recordId: id.nullable().optional(),
            /** Another map this marker opens. Omitted in older backups. */
            targetMapId: id.nullable().optional(),
            /** places | waterways | transport | story. Omitted means places. */
            markerGroup: z.enum(["places", "waterways", "transport", "story"]).optional(),
            /** Optional display name. Omitted means empty; the linked title is used. */
            label: z.string().optional(),
            /** point | route | area | label. Omitted means a point pin. */
            kind: z.enum(["point", "route", "area", "label"]).optional(),
            /**
             * Ordered image fractions for a route or area. Omitted on point pins
             * and labels. Not a distance or a travel time.
             */
            points: z
              .array(
                z
                  .object({
                    x: z.number().min(0).max(1),
                    y: z.number().min(0).max(1),
                  })
                  .strict(),
              )
              .max(64)
              .optional(),
            xNorm: z.number().min(0).max(1),
            yNorm: z.number().min(0).max(1),
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /** Explicit place relationships; omitted → empty. Independent of pin/card positions. */
    placeRelations: z
      .array(
        z
          .object({
            id,
            projectId: id,
            fromRecordId: id,
            toRecordId: id,
            kind: z.enum(["part_of", "flows_into", "governed_by"]),
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /**
     * Author-assigned chapter/scene locations. Omitted in older backups → none.
     * Not mentions, record links, place relationships, or established facts.
     * No story date is stored. isPrimary omitted means not primary.
     */
    sceneLocations: z
      .array(
        z
          .object({
            id,
            projectId: id,
            manuscriptRecordId: id,
            locationRecordId: id,
            isPrimary: z.boolean().optional(),
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /**
     * Story events. Omitted in older backups → none. Not scene locations,
     * mentions, record links, place relationships, or established facts.
     * timeLabel omitted means the story time is unknown. planned omitted
     * means not planned. draftScope omitted means all drafts.
     */
    storyEvents: z
      .array(
        z
          .object({
            id,
            projectId: id,
            title: z.string().min(1).max(200),
            summary: z.string().max(4000).optional(),
            timeLabel: z.string().max(200).optional(),
            planned: z.boolean().optional(),
            draftScope: z.string().min(1).max(80).optional(),
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    storyEventLocations: z
      .array(
        z
          .object({
            id,
            eventId: id,
            projectId: id,
            locationRecordId: id,
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    storyEventScenes: z
      .array(
        z
          .object({
            id,
            eventId: id,
            projectId: id,
            manuscriptRecordId: id,
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    storyEventOrders: z
      .array(
        z
          .object({
            id,
            projectId: id,
            earlierEventId: id,
            laterEventId: id,
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    storyEventEvidence: z
      .array(
        z
          .object({
            id,
            eventId: id,
            projectId: id,
            sourceRecordId: id,
            revisionNumber: z.number().int().min(1),
            passageStart: z.number().int().min(0),
            passageEnd: z.number().int().min(0),
            passageExcerpt: z.string().min(1),
            contentHash: z.string().regex(/^[0-9a-f]{64}$/),
            evidenceKind: z.enum(["planned", "zero_draft", "author_rewrite"]),
            needsRecheck: z.boolean().optional(),
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /** Plan Weave grids; omitted in older backups → no Weave. */
    weaveGrids: z
      .array(
        z
          .object({
            id,
            projectId: id,
            title: z.string().min(1),
            viewKind: z.enum(["original", "zero_draft_map", "author_rewrite"]),
            /** Omitted or freeform in older backups → freeform canvas. */
            layoutMode: z.enum(["freeform", "plot_grid"]).optional(),
            sourceTemplateId: id.nullable().optional(),
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /** Story-thread columns for plot-grid layout; omitted in older backups. */
    weaveThreads: z
      .array(
        z
          .object({
            id,
            gridId: id,
            projectId: id,
            title: z.string().min(1),
            position: z.number().int().min(0),
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    weaveBeats: z
      .array(
        z
          .object({
            id,
            gridId: id,
            projectId: id,
            title: z.string().min(1),
            body: z.string(),
            decision: z.enum(["", "keep", "cut", "move", "combine", "rebuild"]),
            manuscriptRecordId: id.nullable().optional(),
            /** Plot-grid column; omitted/null in older backups → unplaced on threads. */
            threadId: id.nullable().optional(),
            cellOrder: z.number().int().min(0).optional(),
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
    weaveBeatWorldRefs: z
      .array(
        z
          .object({
            id,
            beatId: id,
            projectId: id,
            recordId: id,
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    weaveSetupPayoffs: z
      .array(
        z
          .object({
            id,
            workspaceId: id,
            fromBeatId: id,
            toBeatId: id,
            note: z.string(),
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    weaveTemplates: z
      .array(
        z
          .object({
            id,
            projectId: id,
            title: z.string().min(1),
            description: z.string(),
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    weaveTemplateBeats: z
      .array(
        z
          .object({
            id,
            templateId: id,
            title: z.string().min(1),
            body: z.string(),
            decision: z.enum(["", "keep", "cut", "move", "combine", "rebuild"]),
            x: z.number().int(),
            y: z.number().int(),
            width: z.number().int().min(1),
            height: z.number().int().min(1),
            zIndex: z.number().int(),
            position: z.number().int(),
          })
          .strict(),
      )
      .optional(),
    /** Established-in facts; omitted in older backups → none. */
    establishedFacts: z
      .array(
        z
          .object({
            id,
            projectId: id,
            subjectRecordId: id,
            statement: z.string().min(1),
            status: z.enum(["pending", "accepted", "dismissed"]),
            evidenceKind: z.enum(["planned", "zero_draft", "author_rewrite"]),
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    factEvidence: z
      .array(
        z
          .object({
            id,
            factId: id,
            projectId: id,
            sourceRecordId: id,
            revisionNumber: z.number().int().min(1),
            passageStart: z.number().int().min(0),
            passageEnd: z.number().int().min(0),
            passageExcerpt: z.string(),
            contentHash: z.string().regex(/^[0-9a-f]{64}$/),
            evidenceKind: z.enum(["planned", "zero_draft", "author_rewrite"]),
            needsRecheck: z.boolean(),
            createdAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /** Assistant conversations (optional); older backups omit → none. Proofread runs stay SQLite-only. */
    assistantConversations: z
      .array(
        z
          .object({
            id,
            workspaceId: id,
            projectId: id,
            title: z.string().min(1),
            summary: z.string().optional(),
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    assistantMessages: z
      .array(
        z
          .object({
            id,
            conversationId: id,
            role: z.enum(["user", "assistant"]),
            mode: z.enum(["chat", "proposal"]),
            content: z.string(),
            replyToId: id.optional(),
            status: z.string().min(1),
            errorCode: z.string().optional(),
            errorMessage: z.string().optional(),
            model: z.string().optional(),
            providerResponseId: z.string().optional(),
            inputTokens: z.number().int().optional(),
            outputTokens: z.number().int().optional(),
            totalTokens: z.number().int().optional(),
            usageEstimated: z.boolean(),
            includedMessageIds: z.array(id),
            requestChars: z.number().int().optional(),
            createdAt: timestamp,
            completedAt: timestamp.optional(),
          })
          .strict(),
      )
      .optional(),
    assistantContextItems: z
      .array(
        z
          .object({
            id,
            messageId: id,
            recordId: id,
            revisionNumber: z.number().int().min(1),
            kind: z.string().min(1),
            passageStart: z.number().int().optional(),
            passageEnd: z.number().int().optional(),
            charCount: z.number().int().min(0),
            contentHash: z.string().regex(/^[0-9a-f]{64}$/),
          })
          .strict(),
      )
      .optional(),
    assistantProposals: z
      .array(
        z
          .object({
            id,
            messageId: id,
            workspaceId: id,
            projectId: id,
            packageId: id,
            packageJson: z.string().min(1),
            contentHash: z.string().regex(/^[0-9a-f]{64}$/),
            operationCount: z.number().int().min(0),
            status: z.enum(["proposed", "applied"]),
            createdAt: timestamp,
            appliedAt: timestamp.optional(),
          })
          .strict(),
      )
      .optional(),
    projectAssistantSettings: z
      .array(
        z
          .object({
            id,
            projectId: id,
            autoIncludeRecent: z.boolean(),
            recentContextBudgetChars: z.number().int().min(2000).max(50000),
            updatedAt: timestamp,
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
    /** One cover picture per project. Omitted when no project has a stored cover. */
    projectCovers: z
      .array(
        z
          .object({
            id,
            projectId: id,
            originalFilename: z.string().max(255),
            mimeType: z.enum(IMAGE_MIME_TYPES),
            byteSize: z.number().int().min(1).max(MAX_IMAGE_BYTES),
            width: z.number().int().min(1),
            height: z.number().int().min(1),
            contentHash: z.string().regex(/^[0-9a-f]{64}$/),
            /** The image file, base64-encoded. */
            dataBase64: z.base64(),
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .strict(),
      )
      .optional(),
    /** One Zero-draft chapter analysis. Omitted when the project has none. Proposal JSON is remapped on restore. */
    chapterAnalyses: z
      .array(
        z
          .object({
            id,
            projectId: id,
            chapterRecordId: id,
            draftId: id,
            pinnedRevision: z.number().int().min(1),
            status: z.enum(["preparing", "proposed", "applying", "applied", "failed", "cancelled"]),
            errorCode: z.string().max(80).nullable().optional(),
            errorMessage: z.string().max(4000).nullable().optional(),
            sourceHash: z.string().max(64),
            contentHash: z.string().max(64),
            sentMaterialJson: z.string().max(600_000).optional(),
            proposalJson: z.string().max(500_000),
            decisionsJson: z.string().max(200_000),
            appliedKeysJson: z.string().max(50_000),
            requestChars: z.number().int().min(0),
            model: z.string().max(120).nullable().optional(),
            inputTokens: z.number().int().nullable().optional(),
            outputTokens: z.number().int().nullable().optional(),
            totalTokens: z.number().int().nullable().optional(),
            usageEstimated: z.boolean().optional(),
            createdAt: timestamp,
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
        projectCovers: z.number().int().optional(),
        manuscriptGroups: z.number().int().optional(),
        manuscriptDrafts: z.number().int().optional(),
        rewriteSourceLinks: z.number().int().optional(),
        readingPins: z.number().int().optional(),
        boards: z.number().int().optional(),
        boardCards: z.number().int().optional(),
        worldMaps: z.number().int().optional(),
        worldMapPins: z.number().int().optional(),
        placeRelations: z.number().int().optional(),
        sceneLocations: z.number().int().optional(),
        storyEvents: z.number().int().optional(),
        storyEventLocations: z.number().int().optional(),
        storyEventScenes: z.number().int().optional(),
        storyEventOrders: z.number().int().optional(),
        storyEventEvidence: z.number().int().optional(),
        chapterAnalyses: z.number().int().optional(),
        weaveGrids: z.number().int().optional(),
        weaveThreads: z.number().int().optional(),
        weaveBeats: z.number().int().optional(),
        weaveBeatWorldRefs: z.number().int().optional(),
        weaveSetupPayoffs: z.number().int().optional(),
        weaveTemplates: z.number().int().optional(),
        weaveTemplateBeats: z.number().int().optional(),
        establishedFacts: z.number().int().optional(),
        factEvidence: z.number().int().optional(),
        assistantConversations: z.number().int().optional(),
        assistantMessages: z.number().int().optional(),
        assistantContextItems: z.number().int().optional(),
        assistantProposals: z.number().int().optional(),
        projectAssistantSettings: z.number().int().optional(),
      })
      .strict(),
    /** sha256 of the stable JSON serialization of every other top-level field. */
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export type WorkspaceBackupV1 = z.output<typeof workspaceBackupV1Schema>;
export type BackupCounts = WorkspaceBackupV1["counts"];
