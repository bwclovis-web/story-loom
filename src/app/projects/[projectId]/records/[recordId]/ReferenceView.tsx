import { LandingHeader } from "@/components/library/LandingHeader";
import { ButtonAnchor, ButtonLink } from "@/components/ui/Button";
import { Breadcrumbs as BreadcrumbTrail } from "@/components/ui/Breadcrumbs";
import Link from "next/link";
import type { ReactNode } from "react";
import { findFieldTextDisagreements } from "@/assistant/fieldText";
import { CanonBadge, ProtectionStateBadge, SavedVersionBadge, SectionTagBadge, StatusBadge } from "@/components/Badges";
import { ContextSection } from "@/components/ContextSection";
import { CrossRefsPanel, xrefHref } from "@/components/CrossRefsPanel";
import { MentionedByPanel } from "@/components/MentionedByPanel";
import { MarkdownView, type AttachedImages } from "@/components/MarkdownView";
import { TextAppearanceMenu } from "@/components/TextAppearanceMenu";
import type { ProofreadConfig } from "@/components/writing/Proofreader";
import type { JsonValue } from "@/domain/json";
import type { RecordView } from "@/domain/records";
import { isLinkableReferenceType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import type { PendingRecordProposal } from "@/server/services/assistantProposalService";
import { imageNamesInText } from "@/images/imageFormat";
import type { RecordImageView } from "@/server/services/imageService";
import type { LinkingRecord } from "@/server/services/linkService";
import type { RevisionWithSource } from "@/server/services/recordService";
import type { DictionaryWord } from "@/spelling/dictionary";
import type { MentionedByItem } from "@/server/services/mentionedByService";
import { isWorldKindKey } from "@/world/referenceTemplates";
import {
  WORLDBUILDING_KIND_OTHER,
  worldbuildingCustomKind,
  worldbuildingKindFromFields,
  worldKindDisplayFromFields,
  worldKindLabel,
} from "@/world/worldKinds";
import { Banner } from "@/components/ui/Banner";
import { CanvasReturnBanner } from "@/components/world/CanvasReturnBanner";
import { MENTIONED_BY, RECORD, REFERENCE_FORM, SERIES, SHELL, WORLD, WORLD_KIND, XREF } from "@/ui/labels";
import { keepCanvas } from "@/world/canvasReturn";
import { groupOfType } from "@/ui/navigation";
import { categoryLabel, isWorldType, worldHref } from "@/ui/world";
import { crossRefsFor, type CrossRefIndex } from "@/writing/crossRefs";
import type { CodexEntry } from "@/writing/codexSuggest";
import { parseMarkdown, type MarkdownDocument } from "@/writing/markdownParse";
import { splitStatusTag, statusTagOf } from "@/writing/sections";
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
import type { EstablishedFactView } from "@/server/services/establishedFactService";
import type { PlaceRelationView } from "@/server/services/placeRelationService";
import type { RecordRelationView } from "@/server/services/recordRelationService";
import type { ReadingPinView } from "@/server/services/readingPinService";
import { type DraftChoice, type EvidenceSourceChoice, type SceneChoice } from "./EstablishedInRail";
import { ReferenceInspector } from "@/components/world/ReferenceInspector";
import { PlaceEvents } from "@/app/projects/[projectId]/world/maps/PlaceEvents";
import { buildReferenceInspectorModel, type RecordPlacement } from "@/world/inspectorModel";
import { OutlineReview } from "./OutlineReview";
import { PlaceRelations } from "./PlaceRelations";
import { RecordRelations } from "./RecordRelations";
import { ReferenceInfobox } from "@/components/world/ReferenceInfobox";
import type { ReferenceInfoboxModel } from "@/world/referenceInfobox";
import { CharacterDevelopmentSection } from "./CharacterDevelopmentSection";
import { WorldContextAside, WorldContextProvider, WorldContextToggle } from "./WorldContextRail";
import { WorldPins } from "./WorldPins";

/*
 * Reference documents (everything except manuscript chapters and scenes):
 * the saved text rendered as Markdown, with type, canon status, saved version
 * and protection shown separately. Editing uses the existing record form.
 * Context comes only from stored data: links, revisions, review items,
 * unapplied proposals and imported files. Nothing here is inferred.
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
  recordRelationChoices: Array<{ id: string; title: string; typeLabel: string }>;
  placeChoices: Array<{ id: string; title: string; typeLabel: string }>;
  establishedFacts: EstablishedFactView[] | null;
  evidenceSources: EvidenceSourceChoice[];
  manuscriptDrafts: DraftChoice[];
  manuscriptScenes: SceneChoice[];
  placements: RecordPlacement[];
  mentionedBy: MentionedByItem[];
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
}

const when = (d: Date) => d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function fieldLabel(key: string, recordType: RecordView["type"]): string {
  if (key === "kind" && recordType === "worldbuilding") return WORLD_KIND.fieldKind;
  return key;
}

function fieldValue(key: string, recordType: RecordView["type"], value: JsonValue): ReactNode {
  if (key === "kind" && recordType === "worldbuilding" && typeof value === "string" && isWorldKindKey(value)) {
    return worldKindLabel(value);
  }
  if (value === null) return <span className="muted">null</span>;
  if (typeof value === "string") return value === "" ? <span className="muted">(empty)</span> : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) return value.join(", ");
  return <code>{JSON.stringify(value)}</code>;
}

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

function ContentsList({ doc, label }: { doc: MarkdownDocument; label: string }) {
  if (!doc.headings.length) return <p className="small muted">{WORLD.noHeadings}</p>;
  const top = Math.min(...doc.headings.map((h) => h.level));
  const tagged = doc.headings.some((h) => statusTagOf(h.text));
  return (
    <nav aria-label={label}>
      {tagged ? <p className="small muted">{XREF.sectionTagsNote}</p> : null}
      <ol className="doc-contents">
        {doc.headings.map((h) => {
          const { title, tag } = splitStatusTag(h.text);
          return (
            <li key={h.id} style={{ paddingLeft: `${(h.level - top) * 0.85}rem` }}>
              <a href={`#${h.id}`}>{title || "(untitled heading)"}</a>
              {tag ? (
                <>
                  {" "}
                  <SectionTagBadge tag={tag} />
                </>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
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
  const fieldEntries = Object.entries(record.fields);
  const worldKindDisplay = record.type === "worldbuilding" ? worldKindDisplayFromFields(record.fields) : null;
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
  const inspector = buildReferenceInspectorModel({
    id: record.id,
    title: record.title,
    type: record.type,
    authorityStatus: record.authorityStatus,
    revision: record.currentRevision,
    protected: record.protected,
    body: record.body,
    fields: record.fields,
    fieldKeys: Object.keys(record.fields),
    images: gallery.map((image) => ({
      id: image.id,
      name: image.name,
      altText: image.altText,
      caption: image.caption,
    })),
    relations: [
      ...(props.placeRelations?.outgoing ?? []).map((relation) => ({
        id: `plr-out-${relation.id}`,
        direction: "from" as const,
        kindLabel: relation.kindLabel,
        otherRecordId: relation.toRecordId,
        otherTitle: relation.toTitle,
        otherTypeLabel: relation.toTypeLabel,
      })),
      ...(props.placeRelations?.incoming ?? []).map((relation) => ({
        id: `plr-in-${relation.id}`,
        direction: "to" as const,
        kindLabel: relation.kindLabel,
        otherRecordId: relation.fromRecordId,
        otherTitle: relation.fromTitle,
        otherTypeLabel: relation.fromTypeLabel,
      })),
      ...(props.recordRelations?.outgoing ?? []).map((relation) => ({
        id: `rrl-out-${relation.id}`,
        direction: "from" as const,
        kindLabel: relation.kindLabel,
        otherRecordId: relation.toRecordId,
        otherTitle: relation.toTitle,
        otherTypeLabel: relation.toTypeLabel,
      })),
      ...(props.recordRelations?.incoming ?? []).map((relation) => ({
        id: `rrl-in-${relation.id}`,
        direction: "to" as const,
        kindLabel: relation.kindLabel,
        otherRecordId: relation.fromRecordId,
        otherTitle: relation.fromTitle,
        otherTypeLabel: relation.fromTypeLabel,
      })),
    ],
    manuscriptLinks: props.linking.map((link) => ({
      recordId: link.recordId,
      title: link.title,
      typeLabel: RECORD_TYPE_LABELS[link.type],
      chapterTitle: link.chapterTitle,
    })),
    placements: props.placements,
  });

  return (
    <div className="reference-page">
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
        actions={
          <div className="page-actions">
            {editing ? null : (
              <ButtonLink href={keepCanvas(`${recordHref}?edit=1`, canvasPath)}>{REFERENCE_FORM.editReference}</ButtonLink>
            )}
            <ButtonLink variant="secondary" href={`${base}/import-markdown`}>
              {WORLD.importReferences}
            </ButtonLink>
            <ButtonLink variant="secondary" href={`${base}/export?record=${encodeURIComponent(record.id)}`}>
              {WORLD.exportForChatGpt}
            </ButtonLink>
            <ButtonAnchor variant="secondary" href={`${base}/pdf?kind=references&record=${encodeURIComponent(record.id)}`} download>
              {WORLD.downloadPdf}
            </ButtonAnchor>
          </div>
        }
      />

      <ul className="reference-facts" aria-label="Record details">
        <li>
          <CanonBadge status={record.authorityStatus} />
        </li>
        <li>
          <SavedVersionBadge revision={record.currentRevision} />
          {current ? <span className="small muted"> {when(current.createdAt)}</span> : null}
        </li>
        <li>
          <ProtectionStateBadge isProtected={record.protected} />
        </li>
        <li className="small muted">
          ID <code>{record.id}</code>
        </li>
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

      {!editing && props.infobox?.rows.length ? <ReferenceInfobox model={props.infobox} factsOnly /> : null}
      {!editing && !props.infobox?.rows.length ? (
        <p className="reference-add-details">
          <Link href={keepCanvas(`${recordHref}?edit=1#reference-editor`, canvasPath)}>{REFERENCE_FORM.addDetails}</Link>
        </p>
      ) : null}

      <WorldContextProvider>
      <div className="write-layout reference-write-layout">
        <div className="reference-main write-main">
          <div className="doc-toolbar">
            {editing ? (
              <ButtonLink href={keepCanvas(recordHref, canvasPath)} variant="secondary">
                {WORLD.doneEditing}
              </ButtonLink>
            ) : null}
            <ButtonAnchor variant="secondary" href="#history">
              {WORLD.history}
            </ButtonAnchor>
            <ButtonAnchor variant="secondary" href="#record-status">
              {WORLD.statusAndProtection}
            </ButtonAnchor>
            <div className="doc-toolbar-end">
              <TextAppearanceMenu />
              <WorldContextToggle />
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
            <section className="panel" aria-label={RECORD.editHeading}>
              <RecordEditor
                key={record.id}
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
            <>
              {doc.headings.length > 1 ? (
                <details className="contents-inline">
                  <summary>{WORLD.contents}</summary>
                  <ContentsList doc={doc} label={`${WORLD.contents} (inline)`} />
                </details>
              ) : null}
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

              {fieldEntries.length || record.type === "worldbuilding" ? (
                <section className="panel reference-fields" aria-labelledby="fields-heading">
                  <h2 id="fields-heading">{WORLD.fieldsHeading}</h2>
                  <p className="small muted">{WORLD.fieldsNote}</p>
                  {record.type === "worldbuilding" ? <p className="small muted">{WORLD_KIND.historyNote}</p> : null}
                  {fieldEntries.length ? (
                    <div className="md-table-wrap" tabIndex={0} role="region" aria-label={WORLD.fieldsHeading}>
                      <table>
                        <tbody>
                          {fieldEntries.map(([key, value]) => (
                            <tr key={key}>
                              <th scope="row">{fieldLabel(key, record.type)}</th>
                              <td>{fieldValue(key, record.type, value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="small muted">{WORLD_KIND.readNoneHint}</p>
                  )}
                </section>
              ) : null}
            </>
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

          <ImageGallery
            projectId={projectId}
            recordId={record.id}
            images={gallery}
            namesInText={namesInText}
            isProtected={record.protected}
            unavailable={props.images === null}
          />

          {linkable && props.placeRelations ? (
            <PlaceRelations
              projectId={projectId}
              recordId={record.id}
              outgoing={props.placeRelations.outgoing}
              incoming={props.placeRelations.incoming}
              choices={props.placeChoices}
            />
          ) : null}

          {record.type === "character_dossier" ? (
            <CharacterDevelopmentSection projectId={projectId} recordId={record.id} />
          ) : null}

          {linkable && props.recordRelations ? (
            <RecordRelations
              projectId={projectId}
              recordId={record.id}
              outgoing={props.recordRelations.outgoing}
              incoming={props.recordRelations.incoming}
              choices={props.recordRelationChoices}
            />
          ) : null}
        </div>

        <WorldContextAside>
          {inspector ? (
            <ReferenceInspector
              projectId={projectId}
              model={inspector}
              linkMode="page"
              context="page"
              hasDetails={Boolean(props.infobox?.rows.length)}
              editing={editing}
              established={
                linkable && props.establishedFacts
                  ? {
                      facts: props.establishedFacts,
                      evidenceSources: props.evidenceSources,
                      drafts: props.manuscriptDrafts,
                      scenes: props.manuscriptScenes,
                    }
                  : null
              }
              relationshipsExtra={
                <>
                  <ContextSection title={XREF.heading} count={refs.defined.length + refs.files.length + refs.ids.length + refs.mentionedBy.length}>
                    <CrossRefsPanel projectId={projectId} recordId={record.id} refs={refs} />
                  </ContextSection>
                  <ContextSection title={MENTIONED_BY.heading} count={props.mentionedBy.length}>
                    <p className="small muted">{MENTIONED_BY.note}</p>
                    <MentionedByPanel items={props.mentionedBy} />
                  </ContextSection>
                </>
              }
              overviewExtra={
                <>
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
                      <span className="small muted">{i.origin === "detected_mention" ? "Mention found by the app" : "Note from a change package"}: </span>
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
                      {p.expectedRevision < record.currentRevision ? <div className="small warning-text">{WORLD.proposalStale}</div> : null}
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

          <ContextSection title={WORLD.importedFiles} count={props.importedFiles.length}>
            {props.importedFiles.length ? (
              <>
                <ul className="context-links">
                  {props.importedFiles.map((f) => (
                    <li key={f.id}>
                      <code>{f.originalFilename}</code>
                      <div className="small muted">
                        {WORLD.importedAs(f.action, f.revisionNumber)}, {when(f.createdAt)}
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="small">
                  <a href="#imported-files">{WORLD.showOriginal}</a>
                </p>
              </>
            ) : (
              <p className="small muted">{WORLD.noImportedFiles}</p>
            )}
          </ContextSection>
                </>
              }
            />
          ) : null}
        </WorldContextAside>
      </div>
      </WorldContextProvider>

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
