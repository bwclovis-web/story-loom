"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import {
  applySyncMerge,
  buildSyncMergePackage,
  compareSyncBundle,
  parseSyncBundle,
  type SyncCompareResult,
  type SyncMergeChoice,
} from "@/server/syncBundleService";
import { listWorkspacesWithProjects } from "@/server/services/projectService";

export type SyncActionResult<T> = { ok: true; data: T } | { ok: false; issues: Issue[] };

export async function inspectSyncBundleAction(
  workspaceId: string,
  rawJson: string,
): Promise<SyncActionResult<{ compare: SyncCompareResult; bundleJson: string }>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, issues: [errorIssue("INVALID_CHANGE", "The file is not valid JSON.")] };
  }
  const bundle = parseSyncBundle(parsed);
  if (!bundle.ok) return { ok: false, issues: [errorIssue("INVALID_CHANGE", bundle.message)] };
  const db = getDb();
  const workspaces = await listWorkspacesWithProjects(db);
  if (!workspaces.some((w) => w.id === workspaceId)) {
    return { ok: false, issues: [errorIssue("INVALID_CHANGE", "Choose a workspace that exists on this computer.")] };
  }
  const compare = await compareSyncBundle(db, workspaceId, bundle.bundle);
  return { ok: true, data: { compare, bundleJson: JSON.stringify(bundle.bundle) } };
}

export async function applySyncBundleMergeAction(
  workspaceId: string,
  projectId: string,
  bundleJson: string,
  choices: Array<{ recordId: string; choice: SyncMergeChoice }>,
  confirmProtected: boolean,
): Promise<SyncActionResult<{ summary: string }>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bundleJson);
  } catch {
    return { ok: false, issues: [errorIssue("INVALID_CHANGE", "The bundle payload was lost; inspect the file again.")] };
  }
  const bundle = parseSyncBundle(parsed);
  if (!bundle.ok) return { ok: false, issues: [errorIssue("INVALID_CHANGE", bundle.message)] };
  const db = getDb();
  const compare = await compareSyncBundle(db, workspaceId, bundle.bundle);
  const pkg = buildSyncMergePackage(workspaceId, projectId, bundle.bundle, choices, compare);
  if (!pkg) return { ok: false, issues: [errorIssue("INVALID_CHANGE", "No remote changes were selected to merge.")] };
  const outcome = await applySyncMerge(db, projectId, pkg, { confirmProtected });
  if (outcome.status === "rejected") return { ok: false, issues: outcome.issues };
  revalidatePath("/backup");
  revalidatePath(`/projects/${projectId}`);
  const summary =
    outcome.status === "already_applied"
      ? "Those changes were already applied."
      : outcome.result.summary;
  return { ok: true, data: { summary } };
}