"use server";

import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/services/errors";
import {
  getManuscriptSnapshot,
  type ManuscriptSnapshot,
} from "@/server/services/manuscriptSnapshotService";

export type { ManuscriptSnapshot };

export async function fetchManuscriptSnapshotAction(
  projectId: string,
  recordId: string,
): Promise<{ ok: true; snapshot: ManuscriptSnapshot } | { ok: false; message: string }> {
  try {
    const snapshot = await getManuscriptSnapshot(getDb(), projectId, recordId);
    return { ok: true, snapshot };
  } catch (e) {
    if (e instanceof NotFoundError) return { ok: false, message: "NOT_FOUND" };
    throw e;
  }
}