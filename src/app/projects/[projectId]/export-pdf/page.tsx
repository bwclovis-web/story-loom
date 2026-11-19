import { DraftDefaultsPanel, VisitDraftSwitcher, type DraftOption } from "@/components/drafts/DraftControls";
import { HelpHint } from "@/components/HelpHint";
import { Banner } from "@/components/ui/Banner";
import { isManuscriptType, isRecordType, RECORD_TYPE_LABELS, RECORD_TYPES, type RecordType } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { resolveExportDraftId } from "@/server/draftSelection";
import { getDraftDefaults, listManuscriptDrafts } from "@/server/services/draftService";
import { imagesByRecord } from "@/server/services/imageService";
import { listRecordNav, listRecords } from "@/server/services/recordService";
import { DRAFT, PDF } from "@/ui/labels";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import { RECORD_GROUPS } from "@/ui/navigation";
import { PdfReferencePicker, type PdfPickerGroup } from "./PdfReferencePicker";

export const dynamic = "force-dynamic";

const list = (value: string | string[] | undefined) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

export default async function ExportPdfPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ record?: string | string[]; type?: string | string[]; group?: string; draft?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const db = getDb();
  const [drafts, defaults] = await Promise.all([listManuscriptDrafts(db, projectId), getDraftDefaults(db, projectId)]);
  const hasDrafts = drafts.length > 0;
  const selectedDraftId = resolveExportDraftId(drafts, defaults, query.draft ?? null);
  const draftOptions: DraftOption[] = drafts.map((d) => ({
    id: d.id,
    kind: d.kind,
    label: d.label,
    completedAt: d.completedAt?.toISOString() ?? null,
  }));
  const [records, nav] = await Promise.all([
    listRecords(db, projectId),
    listRecordNav(db, projectId, { hasDrafts, draftId: selectedDraftId }),
  ]);
  const references = records.filter((r) => !isManuscriptType(r.type));
  const images = await imagesByRecord(
    db,
    projectId,
    references.map((r) => r.id),
  );
  const tree = buildManuscriptTree(nav);
  const sceneCount = tree.chapters.reduce((n, c) => n + c.scenes.length, 0) + tree.unplaced.length;
  const pdfHref = `/projects/${encodeURIComponent(projectId)}/pdf`;
  const base = `/projects/${encodeURIComponent(projectId)}`;

  // Preselection from a "Export PDF" link; the author can still change every tick.
  const requested = new Set(list(query.record));
  const types = new Set<RecordType>(list(query.type).filter(isRecordType));
  if (query.group === "world") RECORD_GROUPS.world.forEach((t) => types.add(t));
  const initialSelection = references.filter((r) => requested.has(r.id) || types.has(r.type)).map((r) => r.id);

  const groups: PdfPickerGroup[] = RECORD_TYPES.flatMap((type) => {
    const ofType = references.filter((r) => r.type === type);
    return ofType.length
      ? [
          {
            type,
            label: RECORD_TYPE_LABELS[type],
            records: ofType.map((r) => ({
              id: r.id,
              title: r.title,
              authorityStatus: r.authorityStatus,
              imageCount: images.get(r.id)?.length ?? 0,
            })),
          },
        ]
      : [];
  });

  const showManuscript = !hasDrafts || !!selectedDraftId;

  return (
    <>
      <h1>{PDF.heading}</h1>
      <p className="muted small">{PDF.intro}</p>
      <HelpHint anchor="pdf-export" topic="PDF export">
        {PDF.imagesNote}
      </HelpHint>

      <section className="panel stack" aria-labelledby="pdf-manuscript-heading">
        <h2 id="pdf-manuscript-heading">{PDF.manuscriptHeading}</h2>
        {hasDrafts ? (
          <>
            <VisitDraftSwitcher
              drafts={draftOptions}
              selectedDraftId={selectedDraftId}
              basePath={`${base}/export-pdf`}
              label={DRAFT.exportDraft}
            />
            <p className="small muted">
              {defaults.defaultExportDraftId
                ? DRAFT.defaultExportIs(drafts.find((d) => d.id === defaults.defaultExportDraftId)?.label ?? defaults.defaultExportDraftId)
                : DRAFT.noDefaultExport}
            </p>
            <DraftDefaultsPanel
              projectId={projectId}
              drafts={draftOptions}
              selectedDraftId={selectedDraftId}
              defaultReadingDraftId={defaults.defaultReadingDraftId}
              defaultExportDraftId={defaults.defaultExportDraftId}
              mode="export"
            />
          </>
        ) : null}
        {showManuscript && (tree.chapters.length || tree.unplaced.length) ? (
          <form method="get" action={pdfHref} className="stack">
            <input type="hidden" name="kind" value="manuscript" />
            {selectedDraftId ? <input type="hidden" name="draft" value={selectedDraftId} /> : null}
            <p className="small muted">
              {PDF.manuscriptNote} {PDF.chapterCount(tree.chapters.length, sceneCount)}.
            </p>
            <label className="inline">
              <input type="checkbox" name="sceneTitles" value="1" />
              {PDF.sceneTitles}
            </label>
            <div className="row">
              <button type="submit">{PDF.downloadManuscript}</button>
            </div>
          </form>
        ) : hasDrafts && !selectedDraftId ? (
          <p className="muted">{DRAFT.chooseDraftFirst}</p>
        ) : (
          <p className="muted">{PDF.noManuscript}</p>
        )}
      </section>

      <section className="stack" aria-labelledby="pdf-references-heading">
        <h2 id="pdf-references-heading">{PDF.referencesHeading}</h2>
        <p className="small muted">{PDF.referencesNote}</p>
        {initialSelection.length ? (
          <Banner tone="info">{PDF.preselected(initialSelection.length)}</Banner>
        ) : null}
        {groups.length ? (
          <PdfReferencePicker action={pdfHref} groups={groups} initialSelection={initialSelection} />
        ) : (
          <p className="muted">{PDF.noReferences}</p>
        )}
      </section>
    </>
  );
}
