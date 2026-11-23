import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { DraftDefaultsPanel, VisitDraftSwitcher, type DraftOption } from "@/components/drafts/DraftControls";
import { HelpHint } from "@/components/HelpHint";
import { Banner } from "@/components/ui/Banner";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { isManuscriptType, isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { resolveExportDraftId } from "@/server/draftSelection";
import { getDraftDefaults, listManuscriptDrafts } from "@/server/services/draftService";
import { imagesByRecord } from "@/server/services/imageService";
import { listRecordNav, listRecords } from "@/server/services/recordService";
import { getCompileProfile } from "@/server/services/compileProfileService";
import { validateManuscriptCompile } from "@/server/services/compileValidationService";
import { listAvailableReferences } from "@/server/services/seriesBibleService";
import { listAvailableWorldCategories } from "@/server/services/worldCategoryService";
import { getSmartCollection } from "@/server/services/smartCollectionService";
import { listSeriesBookProjects } from "@/server/services/projectService";
import { NotFoundError } from "@/server/services/errors";
import { COMPILE_PROFILE, DRAFT, PDF } from "@/ui/labels";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import { RECORD_GROUPS } from "@/ui/navigation";
import { categoryLabelOrCustom, projectWorldHubRecord } from "@/world/hubDiscovery";
import { applyWorldCollectionFilter } from "@/world/worldHubCollections";
import { resolveRecordTaxonomy } from "@/world/taxonomy";
import { seriesBookLabel } from "@/world/seriesHome";
import { CompileProfileForm } from "./CompileProfileForm";
import { CompileValidationSummary } from "./CompileValidationSummary";
import { CompileSpreadPreview } from "./CompileSpreadPreview";
import { BetaReaderDocxForm } from "./BetaReaderDocxForm";
import { ExportPresets } from "./ExportPresets";
import { PdfReferencePicker, type PdfPickerGroup } from "./PdfReferencePicker";

export const dynamic = "force-dynamic";

const list = (value: string | string[] | undefined) =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

export default async function ExportPdfPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{
    record?: string | string[];
    type?: string | string[];
    group?: string;
    draft?: string;
    collection?: string;
    category?: string;
    subcategory?: string;
    tag?: string;
    customKind?: string;
    unclassified?: string;
  }>;
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
  const [records, nav, available, customs, seriesBooks] = await Promise.all([
    listRecords(db, projectId),
    listRecordNav(db, projectId, { hasDrafts, draftId: selectedDraftId }),
    listAvailableReferences(db, projectId, { worldOnly: false, linkableOnly: false }),
    listAvailableWorldCategories(db, projectId),
    listSeriesBookProjects(db, projectId),
  ]);
  const references = available
    .map((entry) => entry.record)
    .filter((r) => !isManuscriptType(r.type));
  const homeIds = [...new Set(references.map((r) => r.projectId))];
  const imageMaps = await Promise.all(
    homeIds.map((homeId) =>
      imagesByRecord(
        db,
        homeId,
        references.filter((r) => r.projectId === homeId).map((r) => r.id),
      ),
    ),
  );
  const images = new Map<string, { length: number }>();
  for (const map of imageMaps) {
    for (const [id, value] of map) images.set(id, { length: value.length });
  }
  const tree = buildManuscriptTree(nav);
  const sceneCount = tree.chapters.reduce((n, c) => n + c.scenes.length, 0) + tree.unplaced.length;
  const pdfHref = `/projects/${encodeURIComponent(projectId)}/pdf`;
  const docxHref = `/projects/${encodeURIComponent(projectId)}/docx`;
  const epubHref = `/projects/${encodeURIComponent(projectId)}/epub`;
  const markdownHref = `/projects/${encodeURIComponent(projectId)}/markdown`;
  const wikiHref = `/projects/${encodeURIComponent(projectId)}/wiki`;
  const base = `/projects/${encodeURIComponent(projectId)}`;

  const requested = new Set(list(query.record));
  const types = new Set<RecordType>(list(query.type).filter(isRecordType));
  if (query.group === "world") RECORD_GROUPS.world.forEach((t) => types.add(t));

  let collectionId: string | null = query.collection?.trim() || null;
  let collectionTitle: string | null = null;
  let collectionMatchCount: number | null = null;
  const hubRecords = available
    .filter((entry) => !isManuscriptType(entry.record.type))
    .map((entry) =>
      projectWorldHubRecord({
        id: entry.record.id,
        title: entry.record.title,
        type: entry.record.type,
        authorityStatus: entry.record.authorityStatus,
        protected: entry.record.protected,
        currentRevision: entry.record.currentRevision,
        worldScope: entry.record.worldScope,
        createdAt: entry.record.createdAt,
        updatedAt: entry.record.updatedAt,
        fields: entry.record.fields,
        home: entry.home,
      }),
    );

  if (collectionId) {
    try {
      const collection = await getSmartCollection(db, projectId, collectionId);
      if (collection.scope === "world") {
        collectionTitle = collection.title;
        collectionMatchCount = applyWorldCollectionFilter(hubRecords, collection.filter).length;
      } else {
        collectionId = null;
      }
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      collectionId = null;
    }
  }

  const hiddenScope = {
    category: query.category?.trim() || null,
    subcategory: query.subcategory?.trim() || null,
    tag: query.tag?.trim() || null,
    customKind: query.customKind?.trim() || null,
    unclassified: query.unclassified === "1" || query.unclassified === "true",
  };

  let scopedIds: Set<string> | null = null;
  if (collectionId && collectionTitle) {
    const collection = await getSmartCollection(db, projectId, collectionId);
    scopedIds = new Set(applyWorldCollectionFilter(hubRecords, collection.filter).map((r) => r.id));
  } else if (
    hiddenScope.category ||
    hiddenScope.subcategory ||
    hiddenScope.tag ||
    hiddenScope.customKind ||
    hiddenScope.unclassified
  ) {
    scopedIds = new Set(
      applyWorldCollectionFilter(hubRecords, {
        category: hiddenScope.category ?? undefined,
        subcategory: hiddenScope.subcategory ?? undefined,
        tag: hiddenScope.tag ?? undefined,
        customKind: hiddenScope.customKind ?? undefined,
        unclassified: hiddenScope.unclassified || undefined,
        list: true,
      }).map((r) => r.id),
    );
  }

  const initialSelection = references
    .filter((r) => {
      if (scopedIds) return scopedIds.has(r.id);
      return requested.has(r.id) || types.has(r.type);
    })
    .map((r) => r.id);

  const customOpts = customs.map((c) => ({
    slug: c.slug,
    label: c.label,
    parentCategorySlug: c.parentCategorySlug,
  }));
  const homeById = new Map(available.map((entry) => [entry.record.id, entry.home] as const));

  const byTaxonomy = new Map<string, PdfPickerGroup>();
  for (const record of references) {
    if (scopedIds && !scopedIds.has(record.id)) continue;
    const taxonomy = resolveRecordTaxonomy({ type: record.type, fields: record.fields });
    const categoryId = taxonomy.primary?.category ?? "__uncategorized__";
    const subcategoryId = taxonomy.primary?.subcategory ?? "";
    const key = `${categoryId}\0${subcategoryId}`;
    const categoryLabel =
      categoryId === "__uncategorized__"
        ? "Uncategorized"
        : categoryLabelOrCustom(categoryId, customOpts);
    const subcategoryLabel = taxonomy.primary?.subcategory
      ? customs.find((c) => c.slug === taxonomy.primary?.subcategory)?.label ?? taxonomy.primary.subcategory
      : null;
    const label = subcategoryLabel ? `${categoryLabel} · ${subcategoryLabel}` : categoryLabel;
    let group = byTaxonomy.get(key);
    if (!group) {
      group = { type: key, label, records: [] };
      byTaxonomy.set(key, group);
    }
    const home = homeById.get(record.id);
    group.records.push({
      id: record.id,
      title: record.title,
      authorityStatus: record.authorityStatus,
      imageCount: images.get(record.id)?.length ?? 0,
      homeLabel: home ? seriesBookLabel(home) : null,
    });
  }
  const groups: PdfPickerGroup[] = [...byTaxonomy.values()].sort((a, b) => a.label.localeCompare(b.label));

  const showManuscript = !hasDrafts || !!selectedDraftId;
  const spoilerBooks =
    seriesBooks.length > 0
      ? seriesBooks
      : [{ id: projectId, title: "This book", bookName: null as string | null }];
  const seriesSpoilers = await Promise.all(
    spoilerBooks.map(async (book) => {
      if (book.id === projectId) {
        return { book, tree };
      }
      const bookDrafts = await listManuscriptDrafts(db, book.id);
      const bookDefaults = await getDraftDefaults(db, book.id);
      const bookHasDrafts = bookDrafts.length > 0;
      const bookDraftId = resolveExportDraftId(bookDrafts, bookDefaults, null);
      const bookNav = await listRecordNav(db, book.id, {
        hasDrafts: bookHasDrafts,
        draftId: bookDraftId,
      });
      return { book, tree: buildManuscriptTree(bookNav) };
    }),
  );
  const spoilerChapters = seriesSpoilers.flatMap(({ book, tree: bookTree }) => {
    const bookTitle = book.bookName?.trim() || book.title || "Book";
    return [
      ...bookTree.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        bookId: book.id,
        bookTitle,
      })),
      ...bookTree.chapters.flatMap((chapter) =>
        chapter.scenes.map((scene) => ({
          id: scene.id,
          title: `${chapter.title} · ${scene.title}`,
          bookId: book.id,
          bookTitle,
        })),
      ),
    ];
  });
  const previewChapter = tree.chapters[0];
  const previewChapterRecord = previewChapter ? records.find((r) => r.id === previewChapter.id) : undefined;
  const previewSampleBody = previewChapterRecord?.body.trim() ?? "";

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

      {showManuscript && previewChapter ? (
        <section className="panel stack">
          <CompileSpreadPreview
            profile={compileProfile}
            chapterTitle={previewChapter.title}
            sampleBody={previewSampleBody}
          />
        </section>
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
                ? DRAFT.defaultExportIs(
                    drafts.find((d) => d.id === defaults.defaultExportDraftId)?.label ??
                      defaults.defaultExportDraftId,
                  )
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
            <Checkbox name="sceneTitles" value="1" label={PDF.sceneTitles} />
            <fieldset className="stack" style={{ border: "none", padding: 0, margin: 0 }}>
              <legend className="sr-only">{PDF.manuscriptFormats}</legend>
              <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                <button type="submit">{PDF.downloadManuscript}</button>
                <button type="submit" formAction={docxHref} formMethod="get">
                  {PDF.downloadManuscriptDocx}
                </button>
                <button type="submit" formAction={epubHref} formMethod="get">
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
        {showManuscript && (tree.chapters.length || tree.unplaced.length) ? (
          <section className="stack panel" aria-labelledby="beta-reader-docx-heading" style={{ marginTop: "1rem" }}>
            <h3 id="beta-reader-docx-heading" className="h3">
              {PDF.betaReaderHeading}
            </h3>
            <BetaReaderDocxForm docxHref={docxHref} draftId={selectedDraftId} />
          </section>
        ) : null}
      </section>

      <section className="stack" aria-labelledby="pdf-references-heading">
        <h2 id="pdf-references-heading">{PDF.referencesHeading}</h2>
        <p className="small muted">{PDF.referencesNote}</p>
        {initialSelection.length ? (
          <Banner tone="info">{PDF.preselected(initialSelection.length)}</Banner>
        ) : null}
        {groups.length || collectionId || hiddenScope.category || hiddenScope.unclassified ? (
          <PdfReferencePicker
            action={pdfHref}
            docxAction={docxHref}
            epubAction={epubHref}
            markdownAction={markdownHref}
            wikiAction={wikiHref}
            spoilerChapters={spoilerChapters}
            seriesBooks={seriesBooks.map((book) => ({
              id: book.id,
              title: book.bookName?.trim() || book.title,
            }))}
            groups={groups}
            initialSelection={initialSelection}
            collectionId={collectionId}
            collectionTitle={collectionTitle}
            collectionMatchCount={collectionMatchCount}
            hiddenScope={hiddenScope}
          />
        ) : (
          <p className="muted">{PDF.noReferences}</p>
        )}
      </section>
    </>
  );
}
