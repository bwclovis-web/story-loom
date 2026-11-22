import "server-only";
import { errorIssue } from "@/domain/issues";
import { stableStringify, type JsonObject } from "@/domain/json";
import { snapshotHash, snapshotOf, type RecordSnapshot } from "@/domain/records";
import type { Db } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, StaleRevisionError } from "./errors";
import { markAnnotationNeedsRecheckForSourceInTx } from "./manuscriptAnnotationService";
import { markEvidenceNeedsRecheckForSourceInTx } from "./establishedFactService";
import { applyMutations, type AppliedBatch, type MutationContext } from "./mutationService";
import { markStoryEvidenceNeedsRecheckForSourceInTx } from "./storyEventService";
import { LIVE_RECORD } from "./trashFilters";
import { getRecord } from "./recordService";

/*
 * Unlocked-record autosave. Protected manuscript records are refused.
 * Rapid autosaves within AUTOSAVE_COALESCE_MS update the tip autosave
 * revision in place so history stays scannable; a manual Save always
 * creates a new ui revision via updateRecord.
 */

export const AUTOSAVE_COALESCE_MS = 5 * 60 * 1000;

const UI_ACTOR = "author";

export interface AutosaveInput {
  recordId: string;
  expectedRevision: number;
  title: string;
  body: string;
  fields: JsonObject;
}

export interface AutosaveResult {
  batch: AppliedBatch;
  coalesced: boolean;
  revision: number;
}

function autosaveContext(projectId: string): MutationContext {
  return {
    projectId,
    actor: UI_ACTOR,
    source: { kind: "autosave", conversationLabel: "autosave" },
    scope: "manuscript",
    protectedOverrides: new Set(),
  };
}

function sameSnapshot(a: RecordSnapshot, b: RecordSnapshot): boolean {
  return snapshotHash(a) === snapshotHash(b);
}

/**
 * Saves unlocked record content. Coalesces into the tip revision when the tip
 * is a recent autosave; otherwise creates a new autosave revision.
 */
export async function autosaveRecord(db: Db, projectId: string, input: AutosaveInput): Promise<AutosaveResult> {
  const current = await getRecord(db, projectId, input.recordId);
  if (current.protected) {
    throw new MutationRejectedError([
      errorIssue(
        "PROTECTED_RECORD",
        `Record ${input.recordId} is protected. Autosave only runs on unlocked records; save manually with the protection tick.`,
        { recordId: input.recordId },
      ),
    ]);
  }
  if (current.currentRevision !== input.expectedRevision) {
    throw new StaleRevisionError(
      errorIssue("STALE_REVISION", `Record ${input.recordId} is at revision ${current.currentRevision}, not ${input.expectedRevision}.`, {
        recordId: input.recordId,
      }),
    );
  }

  const after: RecordSnapshot = {
    title: input.title,
    body: input.body,
    fields: input.fields,
    authorityStatus: current.authorityStatus,
    supersededByRecordId: current.supersededByRecordId,
  };
  const before = snapshotOf(current);
  if (sameSnapshot(before, after)) {
    return {
      batch: {
        sourceId: "",
        auditEntryId: "",
        outcomes: [
          {
            index: 0,
            kind: "update_record",
            recordId: input.recordId,
            type: current.type,
            title: current.title,
            previousRevision: current.currentRevision,
            newRevision: current.currentRevision,
          },
        ],
        planned: [],
      },
      coalesced: true,
      revision: current.currentRevision,
    };
  }

  const tip = await db.revision.findFirst({
    where: { recordId: input.recordId, revisionNumber: current.currentRevision },
    include: { source: true },
  });
  const tipIsRecentAutosave =
    tip?.source.kind === "autosave" &&
    Date.now() - tip.createdAt.getTime() <= AUTOSAVE_COALESCE_MS;

  if (tipIsRecentAutosave && tip) {
    const coalesced = await db.$transaction(async (tx) => {
      const data = {
        title: after.title,
        body: after.body,
        fields: stableStringify(after.fields),
        authorityStatus: after.authorityStatus,
        supersededByRecordId: after.supersededByRecordId,
      };
      const updated = await tx.record.updateMany({
        where: {
          id: input.recordId,
          projectId,
          currentRevision: input.expectedRevision,
          trashedAt: null,
          protected: false,
        },
        data,
      });
      if (updated.count !== 1) {
        throw new StaleRevisionError(
          errorIssue("STALE_REVISION", `Record ${input.recordId} changed while autosave was applying.`, {
            recordId: input.recordId,
          }),
        );
      }
      await tx.revision.update({
        where: { id: tip.id },
        data: {
          title: after.title,
          body: after.body,
          fields: stableStringify(after.fields),
          authorityStatus: after.authorityStatus,
          supersededByRecordId: after.supersededByRecordId,
          contentHash: snapshotHash(after),
          createdAt: new Date(),
        },
      });
      await markEvidenceNeedsRecheckForSourceInTx(tx, projectId, input.recordId, input.expectedRevision);
      await markStoryEvidenceNeedsRecheckForSourceInTx(tx, projectId, input.recordId, input.expectedRevision);
      await markAnnotationNeedsRecheckForSourceInTx(tx, projectId, input.recordId, input.expectedRevision);
      const auditEntryId = await writeAudit(tx, {
        projectId,
        action: "record.autosave",
        actor: UI_ACTOR,
        summary: `Autosaved "${after.title}" (coalesced revision ${input.expectedRevision})`,
        sourceId: tip.sourceId,
        packageId: null,
        details: {
          recordId: input.recordId,
          revision: input.expectedRevision,
          coalesced: true,
        },
      });
      return {
        batch: {
          sourceId: tip.sourceId,
          auditEntryId,
          outcomes: [
            {
              index: 0,
              kind: "update_record" as const,
              recordId: input.recordId,
              type: current.type,
              title: after.title,
              previousRevision: input.expectedRevision,
              newRevision: input.expectedRevision,
            },
          ],
          planned: [],
        },
        coalesced: true,
        revision: input.expectedRevision,
      };
    });
    return coalesced;
  }

  const batch = await applyMutations(
    db,
    autosaveContext(projectId),
    [
      {
        kind: "update_record",
        recordId: input.recordId,
        expectedRevision: input.expectedRevision,
        changes: {
          title: input.title,
          body: input.body,
          fields: { set: input.fields, unset: Object.keys(current.fields).filter((k) => !(k in input.fields)) },
        },
      },
    ],
    { action: "record.autosave", summary: `Autosaved "${input.title}"` },
  );
  return {
    batch,
    coalesced: false,
    revision: batch.outcomes[0]!.newRevision,
  };
}

/** Read-only helper for tests: tip revision source kind when present. */
export async function tipRevisionSourceKind(db: Db, recordId: string): Promise<string | null> {
  const row = await db.record.findFirst({
    where: { id: recordId, ...LIVE_RECORD },
    select: { currentRevision: true },
  });
  if (!row) return null;
  const tip = await db.revision.findFirst({
    where: { recordId, revisionNumber: row.currentRevision },
    include: { source: true },
  });
  return tip?.source.kind ?? null;
}
