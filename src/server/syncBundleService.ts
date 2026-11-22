import { textDiff, type DiffPart } from "@/changePackage/diff";
import { CHANGE_PACKAGE_FORMAT, CHANGE_PACKAGE_FORMAT_VERSION } from "@/changePackage/schema.v1";
import type { ChangePackageV1 } from "@/changePackage/schema.v1";
import {
  SYNC_BUNDLE_FORMAT,
  SYNC_BUNDLE_FORMAT_VERSION,
  syncBundleV1Schema,
  type SyncBundleRecord,
  type SyncBundleV1,
} from "@/backup/syncBundle.v1";
import { newId } from "@/domain/ids";
import { sha256, stableStringify } from "@/domain/json";
import { parseJsonObject, snapshotHash, toRecordView } from "@/domain/records";

function recordSnapshotOf(row: {
  title: string;
  body: string;
  fields: string;
  authorityStatus: string;
  supersededByRecordId: string | null;
}) {
  const view = toRecordView(row as Parameters<typeof toRecordView>[0]);
  return {
    title: row.title,
    body: row.body,
    fields: parseJsonObject(row.fields),
    authorityStatus: view.authorityStatus,
    supersededByRecordId: row.supersededByRecordId,
  };
}
import type { Db } from "./db";
import { applyChangePackage } from "./services/changePackageService";
import { NotFoundError } from "./services/errors";
import { LIVE_PROJECT } from "./services/trashFilters";

function bundleChecksum(body: Omit<SyncBundleV1, "checksum">): string {
  return sha256(stableStringify(body));
}

export async function createSyncBundle(db: Db, workspaceId: string): Promise<SyncBundleV1> {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } });
  if (!workspace) throw new NotFoundError(`Workspace ${workspaceId} not found`);
  const projects = await db.project.findMany({
    where: { workspaceId, ...LIVE_PROJECT },
    orderBy: { id: "asc" },
    select: { id: true, title: true },
  });
  const projectIds = projects.map((p) => p.id);
  const records = await db.record.findMany({
    where: { projectId: { in: projectIds } },
    orderBy: [{ projectId: "asc" }, { id: "asc" }],
  });
  const bundleRecords: SyncBundleRecord[] = records.map((row) => {
    const view = toRecordView(row);
    const snap = recordSnapshotOf(row);
    return {
      id: row.id,
      projectId: row.projectId,
      type: view.type,
      title: row.title,
      currentRevision: row.currentRevision,
      contentHash: snapshotHash(snap),
      authorityStatus: view.authorityStatus,
      body: row.body,
      fields: parseJsonObject(row.fields),
      protected: row.protected,
      ...(row.trashedAt ? { trashedAt: row.trashedAt.toISOString() } : {}),
    };
  });
  const exportedAt = new Date().toISOString();
  const body = {
    format: SYNC_BUNDLE_FORMAT as typeof SYNC_BUNDLE_FORMAT,
    formatVersion: SYNC_BUNDLE_FORMAT_VERSION as typeof SYNC_BUNDLE_FORMAT_VERSION,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    exportedAt,
    projects: projects.map((p) => ({ id: p.id, title: p.title })),
    records: bundleRecords,
  };
  return { ...body, checksum: bundleChecksum(body) };
}

export function parseSyncBundle(raw: unknown): { ok: true; bundle: SyncBundleV1 } | { ok: false; message: string } {
  const parsed = syncBundleV1Schema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid sync bundle." };
  const bundle = parsed.data;
  const { checksum, ...rest } = bundle;
  if (bundleChecksum(rest) !== checksum) return { ok: false, message: "Sync bundle checksum does not match its contents." };
  return { ok: true, bundle };
}

export type SyncCompareKind = "match" | "conflict" | "local_only" | "remote_only";

export interface SyncCompareRow {
  recordId: string;
  projectId: string;
  title: string;
  kind: SyncCompareKind;
  localRevision: number | null;
  remoteRevision: number | null;
  localHash: string | null;
  remoteHash: string | null;
  bodyDiff: DiffPart[];
  remote: SyncBundleRecord | null;
  localProtected: boolean;
}

export interface SyncCompareResult {
  workspaceId: string;
  bundleWorkspaceId: string;
  bundleWorkspaceName: string;
  exportedAt: string;
  rows: SyncCompareRow[];
}

export async function compareSyncBundle(db: Db, workspaceId: string, bundle: SyncBundleV1): Promise<SyncCompareResult> {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!workspace) throw new NotFoundError(`Workspace ${workspaceId} not found`);
  const projectIds = (
    await db.project.findMany({ where: { workspaceId, ...LIVE_PROJECT }, select: { id: true } })
  ).map((p) => p.id);
  const localRecords = await db.record.findMany({
    where: { projectId: { in: projectIds } },
    orderBy: { id: "asc" },
  });
  const localById = new Map(localRecords.map((r) => [r.id, r]));
  const remoteById = new Map(bundle.records.map((r) => [r.id, r]));
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  const rows: SyncCompareRow[] = [];
  for (const recordId of [...ids].sort()) {
    const local = localById.get(recordId);
    const remote = remoteById.get(recordId) ?? null;
    const localHash = local ? snapshotHash(recordSnapshotOf(local)) : null;
    const remoteHash = remote?.contentHash ?? null;
    let kind: SyncCompareKind;
    if (local && remote) {
      kind = localHash === remoteHash && local.currentRevision === remote.currentRevision ? "match" : "conflict";
    } else if (local) kind = "local_only";
    else kind = "remote_only";
    const bodyDiff =
      local && remote && kind === "conflict" ? textDiff(local.body, remote.body) : [];
    rows.push({
      recordId,
      projectId: local?.projectId ?? remote!.projectId,
      title: local?.title ?? remote!.title,
      kind,
      localRevision: local?.currentRevision ?? null,
      remoteRevision: remote?.currentRevision ?? null,
      localHash,
      remoteHash,
      bodyDiff,
      remote,
      localProtected: local?.protected ?? false,
    });
  }
  return {
    workspaceId,
    bundleWorkspaceId: bundle.workspaceId,
    bundleWorkspaceName: bundle.workspaceName,
    exportedAt: bundle.exportedAt,
    rows,
  };
}

export type SyncMergeChoice = "keep_local" | "take_remote" | "skip";

export function buildSyncMergePackage(
  workspaceId: string,
  projectId: string,
  bundle: SyncBundleV1,
  choices: Array<{ recordId: string; choice: SyncMergeChoice }>,
  compare: SyncCompareResult,
): ChangePackageV1 | null {
  const choiceMap = new Map(choices.map((c) => [c.recordId, c.choice]));
  const operations: ChangePackageV1["operations"] = [];
  for (const row of compare.rows) {
    const choice = choiceMap.get(row.recordId) ?? "skip";
    if (choice !== "take_remote" || !row.remote) continue;
    if (row.kind === "remote_only") {
      operations.push({
        op: "create_record",
        newRecordId: row.remote.id,
        type: row.remote.type,
        title: row.remote.title,
        body: row.remote.body,
        fields: row.remote.fields,
        authorityStatus: row.remote.authorityStatus,
        note: `Sync bundle from ${bundle.exportedAt}`,
      });
      continue;
    }
    if (row.kind !== "conflict") continue;
    const remote = row.remote;
    operations.push({
      op: "update_record",
      recordId: remote.id,
      expectedRevision: row.localRevision ?? remote.currentRevision,
      changes: {
        title: { replace: remote.title },
        body: { replace: remote.body },
        fields: { set: remote.fields },
      },
      authorityStatus: remote.authorityStatus,
      note: `Sync bundle merge (${bundle.exportedAt})`,
    });
  }
  if (operations.length === 0) return null;
  const protectedOverrides = compare.rows
    .filter((row) => {
      const choice = choiceMap.get(row.recordId);
      return choice === "take_remote" && row.localProtected;
    })
    .map((row) => row.recordId);
  return {
    format: CHANGE_PACKAGE_FORMAT,
    formatVersion: CHANGE_PACKAGE_FORMAT_VERSION,
    packageId: newId("pkg"),
    workspaceId,
    projectId,
    summary: `Merge sync bundle exported ${bundle.exportedAt} (${operations.length} operation${operations.length === 1 ? "" : "s"})`,
    approval: { status: "approved" },
    scope: "manuscript",
    protectedOverrides,
    operations,
    relatedRecords: [],
  };
}

export async function applySyncMerge(
  db: Db,
  projectId: string,
  pkg: ChangePackageV1,
  options: { confirmProtected?: boolean } = {},
) {
  return applyChangePackage(db, pkg, { projectId }, {
    confirmProtected: options.confirmProtected ?? false,
  });
}