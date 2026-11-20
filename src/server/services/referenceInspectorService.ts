import { isLinkableReferenceType, isManuscriptType, isRecordType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { isAuthorityStatus } from "@/domain/statuses";
import type { EstablishedFactView } from "./establishedFactService";
import { buildReferenceInspectorModel, type ReferenceInspectorModel } from "@/world/inspectorModel";
import type { DbOrTx } from "../db";
import { listManuscriptDrafts } from "./draftService";
import { NotFoundError } from "./errors";
import { listEstablishedFactsForSubject } from "./establishedFactService";
import { listRecordImages } from "./imageService";
import { listLinkingRecords } from "./linkService";
import { listPlaceRelationsForRecord } from "./placeRelationService";
import { listRecordPlacements } from "./referencePlacementService";
import { getRecord } from "./recordService";

export interface EstablishedSupport {
  facts: EstablishedFactView[];
  evidenceSources: Array<{ id: string; title: string; typeLabel: string; bodyLength: number }>;
  drafts: Array<{ id: string; label: string; kind: string }>;
  scenes: Array<{ id: string; title: string; draftId: string | null; typeLabel: string }>;
}

export type LoadedInspector =
  | { ok: true; model: ReferenceInspectorModel; established: EstablishedSupport | null }
  | { ok: false; message: string };

async function establishedSupport(
  db: DbOrTx,
  projectId: string,
  recordId: string,
  facts: EstablishedFactView[],
): Promise<EstablishedSupport> {
  const linking = await listLinkingRecords(db, projectId, recordId);
  const evidenceSourceIds = [...new Set(linking.map((link) => link.recordId))];
  const [planSources, linkedSources, drafts, scenes] = await Promise.all([
    db.record.findMany({
      where: { projectId, trashedAt: null, type: { in: ["chapter_outline", "story_architecture"] } },
      select: { id: true, title: true, type: true, body: true },
      orderBy: [{ title: "asc" }, { id: "asc" }],
    }),
    evidenceSourceIds.length
      ? db.record.findMany({
          where: { projectId, id: { in: evidenceSourceIds }, trashedAt: null },
          select: { id: true, title: true, type: true, body: true },
        })
      : Promise.resolve([]),
    listManuscriptDrafts(db, projectId),
    db.record.findMany({
      where: { projectId, trashedAt: null, type: { in: ["manuscript_chapter", "manuscript_scene"] } },
      select: { id: true, title: true, type: true, draftId: true },
      orderBy: [{ title: "asc" }, { id: "asc" }],
    }),
  ]);
  const evidenceById = new Map([...linkedSources, ...planSources].map((row) => [row.id, row]));
  return {
    facts,
    evidenceSources: [...evidenceById.values()].flatMap((row) => {
      if (!isRecordType(row.type)) return [];
      if (!isManuscriptType(row.type) && row.type !== "chapter_outline" && row.type !== "story_architecture") return [];
      return [{ id: row.id, title: row.title, typeLabel: RECORD_TYPE_LABELS[row.type], bodyLength: row.body.length }];
    }),
    drafts: drafts.map((draft) => ({ id: draft.id, label: draft.label, kind: draft.kind })),
    scenes: scenes.flatMap((scene) => {
      if (!isRecordType(scene.type) || !isManuscriptType(scene.type)) return [];
      return [{ id: scene.id, title: scene.title, draftId: scene.draftId, typeLabel: RECORD_TYPE_LABELS[scene.type] }];
    }),
  };
}

/** The same saved reference a board card or map pin points at. */
export async function loadReferenceInspector(db: DbOrTx, projectId: string, recordId: string): Promise<LoadedInspector> {
  let record;
  try {
    record = await getRecord(db, projectId, recordId);
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, message: "That record is not in this project." };
    throw error;
  }
  if (!isLinkableReferenceType(record.type) || !isAuthorityStatus(record.authorityStatus)) {
    return { ok: false, message: "Only reference records open here." };
  }
  const [images, relations, linking, placements, facts] = await Promise.all([
    listRecordImages(db, projectId, record.id),
    listPlaceRelationsForRecord(db, projectId, record.id).catch(() => ({ outgoing: [], incoming: [] })),
    listLinkingRecords(db, projectId, record.id),
    listRecordPlacements(db, projectId, record.id).catch(() => []),
    listEstablishedFactsForSubject(db, projectId, record.id).catch(() => [] as EstablishedFactView[]),
  ]);
  const chapterIds = [...new Set(linking.flatMap((link) => (link.parentRecordId ? [link.parentRecordId] : [])))];
  const chapters = chapterIds.length
    ? await db.record.findMany({
        where: { projectId, id: { in: chapterIds }, trashedAt: null },
        select: { id: true, title: true },
      })
    : [];
  const chapterTitle = new Map(chapters.map((chapter) => [chapter.id, chapter.title]));
  const model = buildReferenceInspectorModel({
    id: record.id,
    title: record.title,
    type: record.type,
    authorityStatus: record.authorityStatus,
    revision: record.currentRevision,
    protected: record.protected,
    body: record.body,
    fields: record.fields,
    fieldKeys: Object.keys(record.fields),
    images: (images ?? []).map((image) => ({
      id: image.id,
      name: image.name,
      altText: image.altText,
      caption: image.caption,
    })),
    relations: [
      ...relations.outgoing.map((relation) => ({
        id: relation.id,
        direction: "from" as const,
        kindLabel: relation.kindLabel,
        otherRecordId: relation.toRecordId,
        otherTitle: relation.toTitle,
        otherTypeLabel: relation.toTypeLabel,
      })),
      ...relations.incoming.map((relation) => ({
        id: relation.id,
        direction: "to" as const,
        kindLabel: relation.kindLabel,
        otherRecordId: relation.fromRecordId,
        otherTitle: relation.fromTitle,
        otherTypeLabel: relation.fromTypeLabel,
      })),
    ],
    manuscriptLinks: linking.map((link) => ({
      recordId: link.recordId,
      title: link.title,
      typeLabel: RECORD_TYPE_LABELS[link.type],
      chapterTitle: link.parentRecordId ? (chapterTitle.get(link.parentRecordId) ?? null) : null,
    })),
    placements,
  });
  if (!model) return { ok: false, message: "That record is not in this project." };
  const established = model.supportsEstablished ? await establishedSupport(db, projectId, record.id, facts) : null;
  return { ok: true, model, established };
}
