import { z } from "zod";
import { PROJECT_ID_PATTERN, RECORD_ID_PATTERN, WORKSPACE_ID_PATTERN } from "@/domain/ids";
import { RECORD_TYPES } from "@/domain/recordTypes";
import { AUTHORITY_STATUSES } from "@/domain/statuses";

export const SYNC_BUNDLE_FORMAT = "wordly.sync-bundle";
export const SYNC_BUNDLE_FORMAT_VERSION = 1;

const recordId = z.string().regex(RECORD_ID_PATTERN);
const projectId = z.string().regex(PROJECT_ID_PATTERN);
const hash = z.string().regex(/^[0-9a-f]{64}$/);

export const syncBundleRecordSchema = z
  .object({
    id: recordId,
    projectId,
    type: z.enum(RECORD_TYPES),
    title: z.string(),
    currentRevision: z.number().int().min(1),
    contentHash: hash,
    authorityStatus: z.enum(AUTHORITY_STATUSES),
    body: z.string(),
    fields: z.record(z.string(), z.json()),
    protected: z.boolean(),
    trashedAt: z.string().nullable().optional(),
  })
  .strict();

export const syncBundleV1Schema = z
  .object({
    format: z.literal(SYNC_BUNDLE_FORMAT),
    formatVersion: z.literal(SYNC_BUNDLE_FORMAT_VERSION),
    workspaceId: z.string().regex(WORKSPACE_ID_PATTERN),
    workspaceName: z.string().min(1).max(500),
    exportedAt: z.string().datetime(),
    projects: z.array(
      z
        .object({
          id: projectId,
          title: z.string(),
        })
        .strict(),
    ),
    records: z.array(syncBundleRecordSchema),
    checksum: hash,
  })
  .strict();

export type SyncBundleV1 = z.infer<typeof syncBundleV1Schema>;
export type SyncBundleRecord = z.infer<typeof syncBundleRecordSchema>;