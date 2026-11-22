import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { DraftDefaultsPanel, VisitDraftSwitcher, type DraftOption } from "@/components/drafts/DraftControls";
import { HelpHint } from "@/components/HelpHint";
import { Banner } from "@/components/ui/Banner";
import { isManuscriptType, isRecordType, RECORD_TYPE_LABELS, RECORD_TYPES, type RecordType } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { resolveExportDraftId } from "@/server/draftSelection";
import { getDraftDefaults, listManuscriptDrafts } from "@/server/services/draftService";
import { imagesByRecord } from "@/server/services/imageService";
import { listRecordNav, listRecords } from "@/server/services/recordService";
import { getCompileProfile } from "@/server/services/compileProfileService";
import { validateManuscriptCompile } from "@/server/services/compileValidationService";
import { COMPILE_PROFILE, DRAFT, PDF } from "@/ui/labels";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import { RECORD_GROUPS } from "@/ui/navigation";
import { CompileProfileForm } from "./CompileProfileForm";
import { CompileValidationSummary } from "./CompileValidationSummary";
import { ExportPresets } from "./ExportPresets";
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
  const [drafts, defaults, compileProfile] = await Promise.all([
    listManuscriptDrafts(db, projectId),
    getDraftDefaults(db, projectId),
    getCompileProfile(db, projectId),
  ]);
  const hasDrafts = drafts.length > 0;
  const selectedDraftId = resolveExportDraftId(drafts, defaults, query.draft ?? null);
  const compileValidation = await validateManuscriptCompile(db, projectId, {
    sceneTitles: false,
    hasDrafts,
    draftId: selectedDraftId,
  });
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
  const docxHref = `/projects/${encodeURIComponent(projectId)}/docx`;
  const epubHref = `/projects/${encodeURIComponent(projectId)}/epub`;
  const markdownHref = `/projects/${encodeURIComponent(projectId)}/markdown`;
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
      <ProjectPageHeader projectId={projectId} title={PDF.heading} />
      <p className="muted small">{PDF.intro}</p>
      <HelpHint anchor="pdf-export" topic="PDF export">
        {PDF.imagesNote}
      </HelpHint>

      <section className="panel stack" aria-labelledby="compile-profile-heading">
        <h2 id="compile-profile-heading">{COMPILE_PROFILE.heading}</h2>
        <ExportPresets projectId={projectId} profile={compileProfile} />
        <CompileProfileForm
          projectId={projectId}
          profile={compileProfile}
          manuscript={[
            ...tree.chapters.flatMap((chapter) => [
              { id: chapter.id, title: chapter.title },
              ...chapter.scenes.map((scene) => ({ id: scene.id, title: scene.title })),
            ]),
            ...tree.unplaced.map((scene) => ({ id: scene.id, title: scene.title })),
          ]}
        />
      </section>

      {showManuscript && (tree.chapters.length || tree.unplaced.length) ? (
        <CompileValidationSummary report={compileValidation} />
      ) : null}

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
            <fieldset className="stack" style={{ border: "none", padding: 0, margin: 0 }}>
              <legend className="sr-only">{PDF.manuscriptFormats}</legend>
              <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                <button type="submit">{PDF.downloadManuscript}</button>
                <button
                  type="submit"
                  formAction={docxHref}
                  formMethod="get"
                >
                  {PDF.downloadManuscriptDocx}
                </button>
                <button
                  type="submit"
                  formAction={epubHref}
                  formMethod="get"
                >
                  {PDF.downloadManuscriptEpub}
                </button>
              </div>
              <p className="small muted">{PDF.manuscriptFormatsNote}</p>
            </fieldset>
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
          <PdfReferencePicker
            action={pdfHref}
            docxAction={docxHref}
            epubAction={epubHref}
            markdownAction={markdownHref}
            groups={groups}
            initialSelection={initialSelection}
          />
        ) : (
          <p className="muted">{PDF.noReferences}</p>
        )}
      </section>
    </>
  );
}
