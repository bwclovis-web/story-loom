import { notFound } from "next/navigation";
import { ContentClassBadge, ProtectionBadge, RevisionBadge, StatusBadge } from "@/components/Badges";
import type { RecordView } from "@/domain/records";
import { isManuscriptType, isRecordType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { PROOFREAD_INSTRUCTIONS } from "@/proofread/prompt";
import { getAssistantConfig } from "@/server/assistantConfig";
import { getDb } from "@/server/db";
import { listPendingProposalsForRecord } from "@/server/services/assistantProposalService";
import { NotFoundError } from "@/server/services/errors";
import { listLinkedReferences, listLinkingRecords } from "@/server/services/linkService";
import { listSceneLocationsForManuscript } from "@/server/services/sceneLocationService";
import { listRecordImages } from "@/server/services/imageService";
import { listEstablishedFactsForSubject } from "@/server/services/establishedFactService";
import { listPlaceRelationsForRecord } from "@/server/services/placeRelationService";
import { listRecordPlacements } from "@/server/services/referencePlacementService";
import { listReadingPins, resolvePinScope } from "@/server/services/readingPinService";
import { listImportedFilesForRecord } from "@/server/services/markdownImportService";
import { PROOFREAD_SCHEMA_CHARS } from "@/server/services/proofreadService";
import {
  getRecord,
  listNotes,
  listRecordsInside,
  listReferenceChoices,
  listRevisions,
  type RevisionWithSource,
} from "@/server/services/recordService";
import { findProject } from "@/server/services/projectService";
import { listOpenReviewItemsForRecord } from "@/server/services/reviewService";
import {
  listAttachableRewriteSources,
  listManuscriptDrafts,
  listRewriteSources,
  resolveDraftScope,
} from "@/server/services/draftService";
import { manuscriptWordCounts, sumWordCounts } from "@/server/services/wordCountService";
import { dictionaryWordsForProject } from "@/server/services/dictionaryService";
import { getSpellChecker, getSpellingLanguage } from "@/server/spelling";
import { loadCrossRefIndex } from "@/server/services/crossRefService";
import { listWeaveBeatsForManuscript } from "@/server/services/weaveService";
import { RECORD, XREF } from "@/ui/labels";
import { manuscriptIdsInBookOrder } from "@/ui/manuscriptTree";
import { crossRefsFor, type RecordCrossRefs } from "@/writing/crossRefs";
import { CrossRefsPanel } from "@/components/CrossRefsPanel";
import { CompareSection, HistorySection, ProtectionSection, StatusSection, TrashSection, type InsideRecord } from "./RecordSections";
import { ReferenceView } from "./ReferenceView";
import { WriteEditor } from "./WriteEditor";

export const dynamic = "force-dynamic";

export default async function RecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; recordId: string }>;
  searchParams: Promise<{ from?: string; to?: string; edit?: string; find?: string; case?: string }>;
}) {
  const { projectId, recordId } = await params;
  const query = await searchParams;
  const db = getDb();

  const record = await getRecord(db, projectId, recordId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const manuscript = isManuscriptType(record.type);
  const drafts = await listManuscriptDrafts(db, projectId);
  const recordDraftId = (await db.record.findFirst({
    where: { id: record.id, projectId },
    select: { draftId: true },
  }))?.draftId ?? null;
  const wordScope = resolveDraftScope(drafts.length > 0, recordDraftId);
  const [revisions, bookWords, spellingLanguage, spellChecker, dictionaryWords, parent, inside, crossRefs, project] = await Promise.all([
    listRevisions(db, record.id),
    manuscript ? manuscriptWordCounts(db, projectId, wordScope) : null,
    getSpellingLanguage(),
    getSpellChecker(),
    dictionaryWordsForProject(db, projectId),
    record.parentRecordId
      ? db.record.findFirst({ where: { id: record.parentRecordId, projectId, trashedAt: null }, select: { id: true, title: true, type: true } })
      : null,
    listRecordsInside(db, projectId, record.id),
    loadCrossRefIndex(db, projectId),
    findProject(db, projectId),
  ]);
  const { status: assistant } = getAssistantConfig();
  /** Instructions, output format, source markers and labels; the client adds the text length. */
  const proofreadFixedChars = PROOFREAD_INSTRUCTIONS.length + PROOFREAD_SCHEMA_CHARS + 300;
  const proofread = {
    configured: assistant.configured,
    maxInputChars: assistant.limits.maxInputChars,
    fixedChars: proofreadFixedChars,
    problems: assistant.problems,
  };

  if (manuscript) {
    const pinScopeId = await resolvePinScope(db, projectId, recordDraftId);
    const [notes, linked, sceneLocations, choices, sources, attachableSources, pins, plotBeats] = await Promise.all([
      listNotes(db, projectId, record.id),
      listLinkedReferences(db, projectId, record.id),
      listSceneLocationsForManuscript(db, projectId, record.id),
      listReferenceChoices(db, projectId),
      listRewriteSources(db, projectId, record.id),
      listAttachableRewriteSources(db, projectId, record.id),
      listReadingPins(db, projectId, pinScopeId),
      listWeaveBeatsForManuscript(db, projectId, record.id),
    ]);
    return (
      <WriteEditor
        key={record.id}
        projectId={projectId}
        projectTitle={project?.title ?? ""}
        recordId={record.id}
        kind={record.type === "manuscript_scene" ? "scene" : "chapter"}
        revision={record.currentRevision}
        title={record.title}
        body={record.body}
        fieldsJson={JSON.stringify(record.fields, null, 2)}
        authorityStatus={record.authorityStatus}
        isProtected={record.protected}
        parent={parent ? { id: parent.id, title: parent.title } : null}
        initialFind={query.find?.trim() ? { query: query.find.trim(), matchCase: query.case === "1" } : null}
        otherChaptersWords={bookWords ? sumWordCounts(bookWords, record.id) : null}
        spellingLanguage={spellingLanguage}
        spellChecker={spellChecker}
        dictionaryWords={dictionaryWords}
        proofread={proofread}
        notes={notes.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          revision: n.currentRevision,
          fieldsJson: JSON.stringify(n.fields, null, 2),
          authorityStatus: n.authorityStatus,
          isProtected: n.protected,
        }))}
        linked={linked.map((l) => ({ recordId: l.recordId, title: l.title, type: l.type, authorityStatus: l.authorityStatus }))}
        sceneLocations={sceneLocations}
        choices={choices}
        sources={sources.map((s) => ({
          toRecordId: s.toRecordId,
          toRevisionNumber: s.toRevisionNumber,
          title: s.title,
          type: s.type,
          newerThanPin: s.newerThanPin,
          currentRevision: s.currentRevision,
        }))}
        attachableSources={attachableSources}
        draftScopeId={pinScopeId === "" ? null : pinScopeId}
        drafts={drafts.map((d) => ({
          id: d.id,
          kind: d.kind,
          label: d.label,
          completedAt: d.completedAt?.toISOString() ?? null,
        }))}
        initialPins={pins}
        plotBeats={plotBeats.map((b) => ({
          id: b.id,
          title: b.title,
          body: b.body,
          decisionLabel: b.decisionLabel,
          threadTitle: b.threadTitle,
          gridId: b.gridId,
          gridTitle: b.gridTitle,
        }))}
        details={
          <RecordDetails
            projectId={projectId}
            record={record}
            revisions={revisions}
            query={query}
            inside={inside}
            refs={crossRefsFor(crossRefs, record.id)}
          />
        }
      />
    );
  }

  const worldPinScope = await resolvePinScope(
    db,
    projectId,
    drafts.find((d) => d.kind === "author_manuscript")?.id ?? drafts[0]?.id ?? null,
  );
  const [linking, reviewItems, proposals, importedFiles, images, supersededBy, worldPins, placeRelations, referenceChoices, establishedFacts, placements] =
    await Promise.all([
      listLinkingRecords(db, projectId, record.id),
      listOpenReviewItemsForRecord(db, projectId, record.id),
      listPendingProposalsForRecord(db, projectId, record.id),
      listImportedFilesForRecord(db, projectId, record.id),
      listRecordImages(db, projectId, record.id),
      record.supersededByRecordId
        ? db.record.findFirst({ where: { id: record.supersededByRecordId, projectId, trashedAt: null }, select: { id: true, title: true } })
        : null,
      listReadingPins(db, projectId, worldPinScope),
      listPlaceRelationsForRecord(db, projectId, record.id).catch(() => ({ outgoing: [], incoming: [] })),
      listReferenceChoices(db, projectId),
      listEstablishedFactsForSubject(db, projectId, record.id).catch(() => [] as Awaited<ReturnType<typeof listEstablishedFactsForSubject>>),
      listRecordPlacements(db, projectId, record.id).catch(() => []),
    ]);
  const chapterIds = [...new Set(linking.flatMap((l) => (l.parentRecordId ? [l.parentRecordId] : [])))];
  const chapters = chapterIds.length
    ? await db.record.findMany({ where: { projectId, id: { in: chapterIds }, trashedAt: null }, select: { id: true, title: true } })
    : [];
  const chapterTitle = new Map(chapters.map((c) => [c.id, c.title]));

  const evidenceSourceIds = [...new Set(linking.map((l) => l.recordId))];
  const planSources = await db.record.findMany({
    where: {
      projectId,
      trashedAt: null,
      type: { in: ["chapter_outline", "story_architecture"] },
    },
    select: { id: true, title: true, type: true, body: true },
    orderBy: [{ title: "asc" }, { id: "asc" }],
  });
  const linkedSources = evidenceSourceIds.length
    ? await db.record.findMany({
        where: { projectId, id: { in: evidenceSourceIds }, trashedAt: null },
        select: { id: true, title: true, type: true, body: true },
      })
    : [];
  const evidenceById = new Map([...linkedSources, ...planSources].map((r) => [r.id, r]));
  const evidenceSources = [...evidenceById.values()].flatMap((r) => {
    if (!isRecordType(r.type)) return [];
    if (!isManuscriptType(r.type) && r.type !== "chapter_outline" && r.type !== "story_architecture") return [];
    return [
      {
        id: r.id,
        title: r.title,
        typeLabel: RECORD_TYPE_LABELS[r.type],
        bodyLength: r.body.length,
      },
    ];
  });

  const manuscriptRows = await db.record.findMany({
    where: {
      projectId,
      trashedAt: null,
      type: { in: ["manuscript_chapter", "manuscript_scene"] },
    },
    select: { id: true, title: true, type: true, draftId: true, parentRecordId: true, position: true, createdAt: true },
  });
  const manuscriptByDraft = new Map<string, typeof manuscriptRows>();
  for (const row of manuscriptRows) {
    const key = row.draftId ?? "";
    const list = manuscriptByDraft.get(key) ?? [];
    list.push(row);
    manuscriptByDraft.set(key, list);
  }
  const manuscriptScenes = [...manuscriptByDraft.keys()]
    .sort()
    .flatMap((key) => {
      const group = manuscriptByDraft.get(key) ?? [];
      const order = manuscriptIdsInBookOrder(
        group.flatMap((row) => {
          if (!isRecordType(row.type) || !isManuscriptType(row.type) || row.type === "scene_note") return [];
          return [
            {
              id: row.id,
              title: row.title,
              type: row.type,
              parentRecordId: row.parentRecordId,
              position: row.position,
              createdAt: row.createdAt.toISOString(),
              draftId: row.draftId,
            },
          ];
        }),
      );
      const byId = new Map(group.map((row) => [row.id, row]));
      return order.flatMap((id) => {
        const row = byId.get(id);
        return row ? [row] : [];
      });
    });

  return (
    <ReferenceView
      key={record.id}
      projectId={projectId}
      record={record}
      editing={query.edit === "1"}
      query={query}
      revisions={revisions}
      parent={parent}
      supersededBy={supersededBy}
      linking={linking.map((l) => ({ ...l, chapterTitle: l.parentRecordId ? (chapterTitle.get(l.parentRecordId) ?? null) : null }))}
      reviewItems={reviewItems}
      proposals={proposals}
      importedFiles={importedFiles}
      images={images}
      inside={inside}
      crossRefs={crossRefs}
      draftScopeId={worldPinScope === "" ? null : worldPinScope}
      initialPins={worldPins}
      placeRelations={placeRelations}
      placeChoices={referenceChoices.map((c) => ({
        id: c.id,
        title: c.title,
        typeLabel: RECORD_TYPE_LABELS[c.type],
      }))}
      establishedFacts={establishedFacts}
      evidenceSources={evidenceSources}
      manuscriptDrafts={drafts.map((d) => ({ id: d.id, label: d.label, kind: d.kind }))}
      placements={placements}
      manuscriptScenes={manuscriptScenes.flatMap((s) => {
        if (!isRecordType(s.type) || !isManuscriptType(s.type)) return [];
        return [
          {
            id: s.id,
            title: s.title,
            draftId: s.draftId,
            typeLabel: RECORD_TYPE_LABELS[s.type],
          },
        ];
      })}
      editor={{ spellingLanguage, spellChecker, dictionaryWords, proofread }}
    />
  );
}

/** Status, protection, history and compare beneath the Write editor. */
function RecordDetails({
  projectId,
  record,
  revisions,
  query,
  inside,
  refs,
}: {
  projectId: string;
  record: RecordView;
  revisions: RevisionWithSource[];
  query: { from?: string; to?: string };
  inside: InsideRecord[];
  refs: RecordCrossRefs;
}) {
  return (
    <section aria-label={RECORD.detailsLabel} className="record-details">
      <div className="row small muted record-meta">
        <span>{RECORD_TYPE_LABELS[record.type]}</span>
        <code>{record.id}</code>
        <StatusBadge status={record.authorityStatus} />
        <RevisionBadge revision={record.currentRevision} />
        <ContentClassBadge contentClass={record.contentClass} />
        <ProtectionBadge isProtected={record.protected} />
      </div>
      <div className="grid2">
        <StatusSection projectId={projectId} record={record} />
        <ProtectionSection projectId={projectId} record={record} />
      </div>
      <section className="panel xref-details" aria-labelledby="xref-heading">
        <h2 id="xref-heading">{XREF.heading}</h2>
        <CrossRefsPanel projectId={projectId} recordId={record.id} refs={refs} />
      </section>
      <HistorySection projectId={projectId} record={record} revisions={revisions} />
      <CompareSection projectId={projectId} record={record} revisions={revisions} query={query} />
      <TrashSection projectId={projectId} record={record} inside={inside} />
    </section>
  );
}
