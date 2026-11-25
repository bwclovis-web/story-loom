import { LandingHeader } from "@/components/library/LandingHeader";
import { Breadcrumbs as BreadcrumbTrail } from "@/components/ui/Breadcrumbs";
import Link from "next/link";
import { type ReactNode } from "react";
import { findFieldTextDisagreements } from "@/assistant/fieldText";
import { SavedVersionBadge, StatusBadge } from "@/components/Badges";
import { ContextSection } from "@/components/ContextSection";
import { CrossRefsPanel, xrefHref } from "@/components/CrossRefsPanel";
import { MentionedByPanel } from "@/components/MentionedByPanel";
import { MarkdownView, type AttachedImages } from "@/components/MarkdownView";
import { TextAppearanceMenu } from "@/components/TextAppearanceMenu";
import { ProjectOnboarding } from "@/components/shell/ProjectOnboarding";
import { DocumentSectionNav } from "@/components/world/DocumentSectionNav";
import { ReferenceWorkspace } from "@/components/world/ReferenceWorkspace";
import type { ProofreadConfig } from "@/components/writing/Proofreader";
import type { RecordView } from "@/domain/records";
import { isLinkableReferenceType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import type { PendingRecordProposal } from "@/server/services/assistantProposalService";
import { imageNamesInText } from "@/images/imageFormat";
import type { RecordImageView } from "@/server/services/imageService";
import type { LinkingRecord } from "@/server/services/linkService";
import type { RevisionWithSource } from "@/server/services/recordService";
import type { DictionaryWord } from "@/spelling/dictionary";
import type { MentionedByItem } from "@/server/services/mentionedByService";
import {
  WORLDBUILDING_KIND_OTHER,
  worldbuildingCustomKind,
  worldbuildingKindFromFields,
  worldKindDisplayFromFields,
} from "@/world/worldKinds";
import { Banner } from "@/components/ui/Banner";
import { CanvasReturnBanner } from "@/components/world/CanvasReturnBanner";
import { RecordAccessTracker } from "@/components/world/RecordAccessTracker";
import { MENTIONED_BY, RECORD, REFERENCE_FORM, SERIES, SHELL, TAXONOMY_FIELDS, WORLD, XREF } from "@/ui/labels";
import { keepCanvas } from "@/world/canvasReturn";
import { groupOfType } from "@/ui/navigation";
import { categoryLabel, isWorldType, taxonomyPlacementLabel, worldHref } from "@/ui/world";
import { resolveRecordTaxonomy } from "@/world/taxonomy";
import { crossRefsFor, type CrossRefIndex } from "@/writing/crossRefs";
import type { CodexEntry } from "@/writing/codexSuggest";
import { parseMarkdown } from "@/writing/markdownParse";
import type { SpellChecker, SpellingLanguage } from "@/writing/spelling";
import { RecordEditor } from "./RecordForms";
import { ImageGallery, type GalleryImage } from "./ImageGallery";
import { RecordRenameSection } from "./RecordRenameSection";
import {
  CompareSection,
  HistorySection,
  ProtectionSection,
  sourceSummary,
  StatusSection,
  TrashSection,
  type InsideRecord,
} from "./RecordSections";
import type { EstablishedFactView } from "@/world/establishedFacts";
import type { PlaceRelationView } from "@/world/placeRelations";
import type { RecordRelationView } from "@/world/recordRelations";
import type { ReadingPinView } from "@/server/services/readingPinService";
import {
  EstablishedInRail,
  type DraftChoice,
  type EvidenceSourceChoice,
  type SceneChoice,
} from "./EstablishedInRail";
import { PlaceEvents } from "@/app/projects/[projectId]/world/maps/PlaceEvents";
import { placementHref, type RecordPlacement } from "@/world/inspectorModel";
import { OutlineReview } from "./OutlineReview";
import { PlaceRelations } from "./PlaceRelations";
import { RecordRelations } from "./RecordRelations";
import type { ReferenceInfoboxModel } from "@/world/referenceInfobox";
import { CharacterDevelopmentSection } from "./CharacterDevelopmentSection";
import { WorldProfileSection } from "./WorldProfileSection";
import { WorldPins } from "./WorldPins";
import { resolveReferenceTab, referenceTabVisibility } from "@/world/referenceTabs";

/*
 * Reference documents (everything except manuscript chapters and scenes):
 * tabbed workspace — Document, Living World / Character profile, Images,
 * Relationships, Established in. Editing uses the existing record form.
 * Context comes only from stored data. Nothing here is inferred.
 */

const RECENT = 5;

export interface ImportedFileView {
  id: string;
  originalFilename: string;
  content: string;
  byteSize: number;
  action: string;
  revisionNumber: number;
  createdAt: Date;
}

export interface ReviewItemView {
  id: string;
  origin: string;
  note: string;
  createdAt: Date;
}

export interface ReferenceViewProps {
  projectId: string;
  record: RecordView;
  editing: boolean;
  canvasBack?: { href: string; label: string } | { unavailable: true } | null;
  query: { from?: string; to?: string };
  revisions: RevisionWithSource[];
  parent: { id: string; title: string; type: string } | null;
  supersededBy: { id: string; title: string } | null;
  linking: (LinkingRecord & { chapterTitle: string | null })[];
  reviewItems: ReviewItemView[];
  proposals: PendingRecordProposal[];
  importedFiles: ImportedFileView[];
  /** Null when the database has not been migrated to include images yet. */
  images: RecordImageView[] | null;
  /** Records that would move to the Trash with this one (notes on it). */
  inside: InsideRecord[];
  crossRefs: CrossRefIndex;
  draftScopeId: string | null;
  initialPins: ReadingPinView[];
  placeRelations: { outgoing: PlaceRelationView[]; incoming: PlaceRelationView[] } | null;
  recordRelations: { outgoing: RecordRelationView[]; incoming: RecordRelationView[] } | null;
  recordRelationChoices: Array<{ id: string; title: string; typeLabel: string; homeLabel?: string | null }>;
  placeChoices: Array<{ id: string; title: string; typeLabel: string; homeLabel?: string | null }>;
  canShareSeries?: boolean;
  establishedFacts: EstablishedFactView[] | null;
  evidenceSources: EvidenceSourceChoice[];
  manuscriptDrafts: DraftChoice[];
  manuscriptScenes: SceneChoice[];
  placements: RecordPlacement[];
  mentionedBy: MentionedByItem[];
  /** Kept for wiki/series builders; not shown as a duplicate strip on this page. */
  infobox: ReferenceInfoboxModel | null;
  codexEntries: CodexEntry[];
  kindTemplates?: import("@/world/kindTemplates").KindTemplateView[];
  /** This reference is shared with other books in the series. Editing stays here. */
  seriesShared?: boolean;
  /** Shared project header. The record title replaces the book title; the cover stays. */
  header: { eyebrow: string; coverTitle: string; coverSrc: string | null };
  editor: {
    spellingLanguage: SpellingLanguage;
    spellChecker: SpellChecker;
    dictionaryWords: DictionaryWord[];
    proofread: ProofreadConfig;
  };
  /** From `?tab=` so the workspace paints the correct panel on first load. */
  initialTab?: string;
}

const when = (d: Date) => d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function Breadcrumbs({ projectId, record, parent }: { projectId: string; record: RecordView; parent: ReferenceViewProps["parent"] }) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const group = groupOfType(record.type);
  const crumbs: { href: string; label: string }[] = [];
  if (group === "world") {
    crumbs.push({ href: worldHref(projectId), label: SHELL.world });
    if (isWorldType(record.type)) {
      const kind = worldbuildingKindFromFields(record.fields);
      const custom = worldbuildingCustomKind(record.fields);
      crumbs.push({
        href: worldHref(projectId, {
          type: record.type,
          kind: kind ?? (custom ? WORLDBUILDING_KIND_OTHER : undefined),
        }),
        label: worldKindDisplayFromFields(record.fields) ?? categoryLabel(record.type),
      });
    }
  } else if (group === "plan") {
    crumbs.push({ href: `${base}/plan`, label: SHELL.plan });
  } else {
    crumbs.push({ href: `${base}/write`, label: SHELL.write });
    if (parent) crumbs.push({ href: `${base}/records/${encodeURIComponent(parent.id)}`, label: parent.title });
  }
  return (
    <BreadcrumbTrail
      label={WORLD.breadcrumb}
      items={[
        ...crumbs.map((crumb) => ({ href: crumb.href, label: crumb.label })),
        { label: record.title, current: true },
      ]}
    />
  );
}

export function ReferenceView(props: ReferenceViewProps) {
  const { projectId, record, revisions, editing } = props;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const recordHref = `${base}/records/${encodeURIComponent(record.id)}`;
  const canvasPath = props.canvasBack && "href" in props.canvasBack ? props.canvasBack.href : null;
  const doc = parseMarkdown(record.body);
  const current = revisions[0];
  const previous = revisions[1] ?? null;
  const disagreements = previous ? findFieldTextDisagreements(previous, record) : [];
  const worldKindDisplay = record.type === "worldbuilding" ? worldKindDisplayFromFields(record.fields) : null;
  const taxonomy = isWorldType(record.type) ? resolveRecordTaxonomy({ type: record.type, fields: record.fields }) : null;
  const linkable = isLinkableReferenceType(record.type);
  const gallery: GalleryImage[] = (props.images ?? []).map((img) => ({
    id: img.id,
    name: img.name,
    src: `${base}/images/${encodeURIComponent(img.id)}`,
    mimeType: img.mimeType,
    byteSize: img.byteSize,
    width: img.width,
    height: img.height,
    caption: img.caption,
    altText: img.altText,
    isPrimary: img.isPrimary,
  }));
  const attached: AttachedImages = new Map(gallery.map((g) => [g.name, g]));
  const namesInText = imageNamesInText(record.body);
  const refs = crossRefsFor(props.crossRefs, record.id);
  const primaryImage = gallery.find((g) => g.isPrimary) ?? gallery[0] ?? null;
  const visibility = referenceTabVisibility(record.type, {
    hasEstablishedFacts: linkable && props.establishedFacts !== null,
  });
  const initialTab = resolveReferenceTab(props.initialTab, visibility);

  const editHref = keepCanvas(`${recordHref}?edit=1`, canvasPath);
  const moreItems = [
    { href: "#history", label: WORLD.history },
    { href: "#record-status", label: WORLD.statusAndProtection },
    { href: `${base}/import-markdown`, label: WORLD.importReferences },
    { href: `${base}/export?record=${encodeURIComponent(record.id)}`, label: WORLD.exportForChatGpt },
    {
      href: `${base}/pdf?kind=references&record=${encodeURIComponent(record.id)}`,
      label: WORLD.downloadPdf,
    },
    ...(props.importedFiles.length ? [{ href: "#imported-files", label: WORLD.importedFiles }] : []),
  ];

  const documentPanel = (
    <div className="reference-document-panel">
      <div className="doc-toolbar">
        <div className="doc-toolbar-end">
          <TextAppearanceMenu />
        </div>
      </div>

      {disagreements.length ? (
        <section className="disagreements" aria-labelledby="disagreements-heading">
          <h2 id="disagreements-heading">{WORLD.disagreementsHeading}</h2>
          <p className="small">{WORLD.disagreementsNote(record.currentRevision)}</p>
          <ul>
            {disagreements.map((d, i) => (
              <li key={i}>{d.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {editing ? (
        <section className="panel" aria-label={RECORD.editHeading} id="reference-editor">
          <RecordEditor
            key={`${record.id}:${record.currentRevision}`}
            projectId={projectId}
            recordId={record.id}
            recordType={record.type}
            revision={record.currentRevision}
            title={record.title}
            body={record.body}
            fieldsJson={JSON.stringify(record.fields, null, 2)}
            authorityStatus={record.authorityStatus}
            isProtected={record.protected}
            isChapter={false}
            otherChaptersWords={null}
            spellingLanguage={props.editor.spellingLanguage}
            spellChecker={props.editor.spellChecker}
            kindTemplates={props.kindTemplates}
            dictionaryWords={props.editor.dictionaryWords}
            proofread={props.editor.proofread}
            images={gallery.map((g) => ({ name: g.name, label: g.caption || g.altText }))}
            codexEntries={props.codexEntries}
          />
        </section>
      ) : (
        <div className="reference-document-layout">
          <DocumentSectionNav headings={doc.headings} />
          <article className="reference-doc" aria-label={record.title}>
            {doc.blocks.length ? (
              <MarkdownView
                doc={doc}
                className="document"
                images={attached}
                xrefs={{ index: props.crossRefs, href: (t) => xrefHref(projectId, record.id, t) }}
              />
            ) : (
              <p className="muted">{WORLD.emptyDocument}</p>
            )}
          </article>
        </div>
      )}

      {isWorldType(record.type) ? (
        <OutlineReview
          projectId={projectId}
          recordId={record.id}
          revision={record.currentRevision}
          body={record.body}
          fieldKeys={Object.keys(record.fields)}
          isProtected={record.protected}
          editing={editing}
        />
      ) : null}
    </div>
  );

  const profilePanel: ReactNode =
    visibility.profile === "world" ? (
      <WorldProfileSection
        projectId={projectId}
        recordId={record.id}
        recordType={record.type}
        revision={record.currentRevision}
        body={record.body}
        fields={record.fields as import("@/domain/json").JsonObject}
        editable
        seriesHome={null}
        isProtected={record.protected}
        homeProjectId={projectId}
        placeRelations={props.placeRelations}
        placeChoices={props.placeChoices}
      />
    ) : visibility.profile === "character" ? (
      <CharacterDevelopmentSection projectId={projectId} recordId={record.id} />
    ) : null;

  const relationshipsPanel = (
    <div className="reference-relationships-panel">
      {linkable && props.placeRelations ? (
        <PlaceRelations
          projectId={projectId}
          recordId={record.id}
          outgoing={props.placeRelations.outgoing}
          incoming={props.placeRelations.incoming}
          choices={props.placeChoices}
          canShareSeries={props.canShareSeries}
        />
      ) : null}

      {linkable && props.recordRelations ? (
        <RecordRelations
          projectId={projectId}
          recordId={record.id}
          outgoing={props.recordRelations.outgoing}
          incoming={props.recordRelations.incoming}
          choices={props.recordRelationChoices}
          canShareSeries={props.canShareSeries}
        />
      ) : null}

      {!linkable && !props.placeRelations && !props.recordRelations ? (
        <p className="muted">{REFERENCE_FORM.noRelationshipsYet}</p>
      ) : null}

      <ContextSection title={XREF.heading} count={refs.defined.length + refs.files.length + refs.ids.length + refs.mentionedBy.length}>
        <CrossRefsPanel projectId={projectId} recordId={record.id} refs={refs} />
      </ContextSection>
      <ContextSection title={MENTIONED_BY.heading} count={props.mentionedBy.length}>
        <p className="small muted">{MENTIONED_BY.note}</p>
        <MentionedByPanel items={props.mentionedBy} />
      </ContextSection>

      {linkable ? <PlaceEvents projectId={projectId} locationRecordId={record.id} /> : null}
      <WorldPins
        projectId={projectId}
        recordId={record.id}
        draftScopeId={props.draftScopeId}
        initialPins={props.initialPins}
        canPinCurrent={linkable}
      />

      {props.parent && !linkable ? (
        <ContextSection title={WORLD.noteOn}>
          <p className="small">
            <Link href={`${base}/records/${encodeURIComponent(props.parent.id)}`}>{props.parent.title}</Link>
          </p>
          <p className="small muted">{WORLD.notLinkable}</p>
        </ContextSection>
      ) : null}

      {props.placements.length ? (
        <ContextSection title={WORLD.onBoardsAndMaps} count={props.placements.length}>
          <ul className="context-links">
            {props.placements.map((placement) => (
              <li key={`${placement.surface}-${placement.surfaceId}-${placement.itemId}`}>
                <Link href={placementHref(projectId, placement)}>{placement.surfaceTitle}</Link>
              </li>
            ))}
          </ul>
        </ContextSection>
      ) : null}
    </div>
  );

  const establishedPanel =
    visibility.established && props.establishedFacts ? (
      <EstablishedInRail
        projectId={projectId}
        subjectRecordId={record.id}
        recordType={record.type}
        initialFacts={props.establishedFacts}
        evidenceSources={props.evidenceSources}
        drafts={props.manuscriptDrafts}
        scenes={props.manuscriptScenes}
      />
    ) : (
      <p className="muted">{REFERENCE_FORM.noEstablishedYet}</p>
    );

  return (
    <div className="reference-page">
      <RecordAccessTracker
        projectId={projectId}
        recordId={record.id}
        title={record.title}
        isWorld={isWorldType(record.type)}
      />
      {props.seriesShared ? <Banner>{SERIES.sharedHere}</Banner> : null}
      <CanvasReturnBanner back={props.canvasBack ?? null} />
      <LandingHeader
        projectId={projectId}
        title={record.title}
        coverTitle={props.header.coverTitle}
        eyebrow={props.header.eyebrow}
        coverSrc={props.header.coverSrc}
        description={
          worldKindDisplay
            ? `${RECORD_TYPE_LABELS[record.type]} · ${worldKindDisplay}`
            : RECORD_TYPE_LABELS[record.type]
        }
        breadcrumbs={<Breadcrumbs projectId={projectId} record={record} parent={props.parent} />}
        gettingStarted={<ProjectOnboarding projectId={projectId} quiet marked />}
      />

      {(taxonomy && (taxonomy.primary || taxonomy.secondary.length || taxonomy.tags.length)) ||
      props.supersededBy ||
      record.supersededByRecordId ? (
        <ul className="reference-facts reference-facts-compact" aria-label={REFERENCE_FORM.identityDetails}>
          {taxonomy && taxonomy.primary ? (
            <li className="small">
              <span className="muted">
                {taxonomy.usedLegacyFallback ? TAXONOMY_FIELDS.viewInferred : TAXONOMY_FIELDS.viewPrimary}:{" "}
              </span>
              <span className="badge">{taxonomyPlacementLabel(taxonomy.primary)}</span>
            </li>
          ) : null}
          {taxonomy && taxonomy.secondary.length ? (
            <li className="small">
              <span className="muted">{TAXONOMY_FIELDS.viewSecondary}: </span>
              {taxonomy.secondary.map((item) => (
                <span key={`${item.category}\0${item.subcategory ?? ""}`} className="badge">
                  {taxonomyPlacementLabel(item)}
                </span>
              ))}
            </li>
          ) : null}
          {taxonomy && taxonomy.tags.length ? (
            <li className="small">
              <span className="muted">{TAXONOMY_FIELDS.tags}: </span>
              {taxonomy.tags.map((tag) => (
                <span key={tag} className="badge">
                  {tag}
                </span>
              ))}
            </li>
          ) : null}
          {props.supersededBy ? (
            <li className="small">
              {WORLD.supersededBy}{" "}
              <Link href={`${base}/records/${encodeURIComponent(props.supersededBy.id)}`}>{props.supersededBy.title}</Link>
            </li>
          ) : record.supersededByRecordId ? (
            <li className="small">
              {WORLD.supersededBy} <code>{record.supersededByRecordId}</code>
            </li>
          ) : null}
        </ul>
      ) : null}

      <ReferenceWorkspace
        recordHref={recordHref}
        editing={editing}
        canvasPath={canvasPath}
        visibility={visibility}
        initialTab={initialTab}
        editHref={editHref}
        moreItems={moreItems}
        identity={{
          thumbnailSrc: primaryImage?.src ?? null,
          thumbnailAlt: primaryImage?.altText || primaryImage?.caption || record.title,
          typeLabel: RECORD_TYPE_LABELS[record.type],
          kindLabel: worldKindDisplay,
          authorityStatus: record.authorityStatus,
          isProtected: record.protected,
          revision: record.currentRevision,
        }}
        panels={{
          document: documentPanel,
          profile: profilePanel ?? undefined,
          images: (
            <ImageGallery
              projectId={projectId}
              recordId={record.id}
              images={gallery}
              namesInText={namesInText}
              isProtected={record.protected}
              unavailable={props.images === null}
            />
          ),
          relationships: relationshipsPanel,
          established: establishedPanel,
        }}
      />

      <section aria-label={RECORD.detailsLabel} className="record-details reference-details">
        <div className="grid2">
          <StatusSection projectId={projectId} record={record} />
          <ProtectionSection projectId={projectId} record={record} />
        </div>
        {record.type === "character_dossier" || record.type === "worldbuilding" ? (
          <RecordRenameSection projectId={projectId} record={record} />
        ) : null}
        <HistorySection projectId={projectId} record={record} revisions={revisions} />
        <CompareSection projectId={projectId} record={record} revisions={revisions} query={props.query} />

        <ContextSection title={WORLD.recentChanges} count={revisions.length}>
          <ol className="context-links recent-changes">
            {revisions.slice(0, RECENT).map((r) => (
              <li key={r.id}>
                <Link href={`${recordHref}?from=${Math.max(1, r.revisionNumber - 1)}&to=${r.revisionNumber}#compare`}>
                  {WORLD.revision(r.revisionNumber)}
                </Link>{" "}
                <StatusBadge status={r.authorityStatus} />
                <div className="small muted">
                  {sourceSummary(r.source)}, {when(r.createdAt)}
                  {current && r.id === current.id ? (
                    <>
                      {" · "}
                      <SavedVersionBadge revision={r.revisionNumber} />
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <p className="small">
            {revisions.length > RECENT ? <span className="muted">{WORLD.showingRevisions(RECENT, revisions.length)}. </span> : null}
            <a href="#history">{WORLD.viewHistory}</a>
          </p>
        </ContextSection>

        <ContextSection title={WORLD.openReview} count={props.reviewItems.length}>
          {props.reviewItems.length ? (
            <>
              <ul className="context-links">
                {props.reviewItems.map((i) => (
                  <li key={i.id}>
                    <span className="small muted">
                      {i.origin === "detected_mention" ? "Mention found by the app" : "Note from a change package"}:{" "}
                    </span>
                    {i.note}
                  </li>
                ))}
              </ul>
              <p className="small">
                <Link href={`${base}/history`}>{WORLD.reviewAll}</Link>
              </p>
            </>
          ) : (
            <p className="small muted">{WORLD.noOpenReview}</p>
          )}
        </ContextSection>

        <ContextSection title={WORLD.proposals} count={props.proposals.length} className="proposals-section">
          {props.proposals.length ? (
            <>
              <p className="small muted">{WORLD.proposalNote}</p>
              <ul className="context-links">
                {props.proposals.map((p) => (
                  <li key={p.proposalId} className="proposal-item">
                    <span className="badge proposed">{WORLD.proposedBadge}</span>
                    <div>{WORLD.proposalFrom(p.conversationTitle)}</div>
                    <div className="small">
                      {WORLD.wouldChange}: {p.changes.join(", ") || "nothing listed"}
                    </div>
                    <div className="small muted">
                      {WORLD.preparedAgainst(p.expectedRevision)}, {when(p.createdAt)}
                    </div>
                    {p.expectedRevision < record.currentRevision ? (
                      <div className="small warning-text">{WORLD.proposalStale}</div>
                    ) : null}
                    <Link className="small" href={`${base}/assistant/proposals/${encodeURIComponent(p.proposalId)}`}>
                      {WORLD.reviewProposal}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="small muted">{WORLD.noProposals}</p>
          )}
        </ContextSection>

        {props.importedFiles.length ? (
          <section className="panel" id="imported-files">
            <h2>{WORLD.importedFiles}</h2>
            <p className="small muted">{WORLD.originalNote}</p>
            {props.importedFiles.map((f) => (
              <details key={f.id} className="imported-file">
                <summary>
                  <code>{f.originalFilename}</code>{" "}
                  <span className="small muted">
                    {WORLD.importedAs(f.action, f.revisionNumber)}, {when(f.createdAt)}, {f.byteSize.toLocaleString()} bytes
                  </span>
                </summary>
                <pre className="imported-source" tabIndex={0}>
                  {f.content}
                </pre>
              </details>
            ))}
          </section>
        ) : null}
        <TrashSection projectId={projectId} record={record} inside={props.inside} />
      </section>
    </div>
  );
}
