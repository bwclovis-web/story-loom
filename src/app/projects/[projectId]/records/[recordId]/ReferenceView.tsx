import Link from "next/link";
import type { ReactNode } from "react";
import { findFieldTextDisagreements } from "@/assistant/fieldText";
import { CanonBadge, ProtectionStateBadge, SavedVersionBadge, SectionTagBadge, StatusBadge } from "@/components/Badges";
import { ContextSection } from "@/components/ContextSection";
import { CrossRefsPanel, xrefHref } from "@/components/CrossRefsPanel";
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
import { RECORD, SHELL, WORLD, XREF } from "@/ui/labels";
import { groupOfType } from "@/ui/navigation";
import { categoryLabel, isWorldType, worldHref } from "@/ui/world";
import { crossRefsFor, type CrossRefIndex } from "@/writing/crossRefs";
import { parseMarkdown, type MarkdownDocument } from "@/writing/markdownParse";
import { splitStatusTag, statusTagOf } from "@/writing/sections";
import type { SpellChecker, SpellingLanguage } from "@/writing/spelling";
import { RecordEditor } from "./RecordForms";
import { ImageGallery, type GalleryImage } from "./ImageGallery";
import {
  CompareSection,
  HistorySection,
  ProtectionSection,
  sourceSummary,
  StatusSection,
  TrashSection,
  type InsideRecord,
} from "./RecordSections";
import type { ReadingPinView } from "@/server/services/readingPinService";
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
  editor: {
    spellingLanguage: SpellingLanguage;
    spellChecker: SpellChecker;
    dictionaryWords: DictionaryWord[];
    proofread: ProofreadConfig;
  };
}

const when = (d: Date) => d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function fieldValue(value: JsonValue): ReactNode {
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
    if (isWorldType(record.type)) crumbs.push({ href: worldHref(projectId, { type: record.type }), label: categoryLabel(record.type) });
  } else if (group === "plan") {
    crumbs.push({ href: `${base}/plan`, label: SHELL.plan });
  } else {
    crumbs.push({ href: `${base}/write`, label: SHELL.write });
    if (parent) crumbs.push({ href: `${base}/records/${encodeURIComponent(parent.id)}`, label: parent.title });
  }
  return (
    <nav aria-label={WORLD.breadcrumb} className="breadcrumbs">
      <ol>
        {crumbs.map((c) => (
          <li key={c.href}>
            <Link href={c.href}>{c.label}</Link>
          </li>
        ))}
        <li>
          <span aria-current="page">{record.title}</span>
        </li>
      </ol>
    </nav>
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
  const doc = parseMarkdown(record.body);
  const current = revisions[0];
  const previous = revisions[1] ?? null;
  const disagreements = previous ? findFieldTextDisagreements(previous, record) : [];
  const fieldEntries = Object.entries(record.fields);
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
  }));
  const attached: AttachedImages = new Map(gallery.map((g) => [g.name, g]));
  const namesInText = imageNamesInText(record.body);
  const refs = crossRefsFor(props.crossRefs, record.id);
  const xrefCount = refs.defined.length + refs.files.length + refs.ids.length + refs.mentionedBy.length;

  return (
    <div className="reference-page">
      <Breadcrumbs projectId={projectId} record={record} parent={props.parent} />
      <div className="page-head">
        <h1 className="reference-title">{record.title}</h1>
        <div className="page-actions">
          <Link className="button-link secondary" href={`${base}/import-markdown`}>
            {WORLD.importReferences}
          </Link>
          <Link className="button-link secondary" href={`${base}/export?record=${encodeURIComponent(record.id)}`}>
            {WORLD.exportForChatGpt}
          </Link>
          <a className="button-link secondary" href={`${base}/pdf?kind=references&record=${encodeURIComponent(record.id)}`} download>
            {WORLD.downloadPdf}
          </a>
        </div>
      </div>

      <ul className="reference-facts" aria-label="Record details">
        <li>
          <span className="badge labelled type">
            <span className="badge-label">{WORLD.documentType}:</span> {RECORD_TYPE_LABELS[record.type]}
          </span>
        </li>
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

      <WorldContextProvider>
      <div className="write-layout reference-write-layout">
        <div className="reference-main write-main">
          <div className="doc-toolbar">
            {editing ? (
              <Link className="button-link" href={recordHref}>
                {WORLD.doneEditing}
              </Link>
            ) : (
              <Link className="button-link" href={`${recordHref}?edit=1`}>
                {WORLD.edit}
              </Link>
            )}
            <a className="button-link secondary" href="#history">
              {WORLD.history}
            </a>
            <a className="button-link secondary" href="#record-status">
              {WORLD.statusAndProtection}
            </a>
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
                dictionaryWords={props.editor.dictionaryWords}
                proofread={props.editor.proofread}
                images={gallery.map((g) => ({ name: g.name, label: g.caption || g.altText }))}
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

              {fieldEntries.length ? (
                <section className="panel reference-fields" aria-labelledby="fields-heading">
                  <h2 id="fields-heading">{WORLD.fieldsHeading}</h2>
                  <p className="small muted">{WORLD.fieldsNote}</p>
                  <div className="md-table-wrap" tabIndex={0} role="region" aria-label={WORLD.fieldsHeading}>
                    <table>
                      <tbody>
                        {fieldEntries.map(([key, value]) => (
                          <tr key={key}>
                            <th scope="row">{key}</th>
                            <td>{fieldValue(value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </>
          )}

          <ImageGallery
            projectId={projectId}
            recordId={record.id}
            images={gallery}
            namesInText={namesInText}
            isProtected={record.protected}
            unavailable={props.images === null}
          />
        </div>

        <WorldContextAside>
          <WorldPins
            projectId={projectId}
            recordId={record.id}
            draftScopeId={props.draftScopeId}
            initialPins={props.initialPins}
            canPinCurrent={linkable}
          />

          {!editing && doc.headings.length ? (
            <ContextSection title={WORLD.contents} className="contents-section">
              <ContentsList doc={doc} label={WORLD.contents} />
            </ContextSection>
          ) : null}

          <ContextSection title={XREF.heading} count={xrefCount} className="xref-section">
            <CrossRefsPanel projectId={projectId} recordId={record.id} refs={refs} />
          </ContextSection>

          {props.parent && !linkable ? (
            <ContextSection title={WORLD.noteOn}>
              <p className="small">
                <Link href={`${base}/records/${encodeURIComponent(props.parent.id)}`}>{props.parent.title}</Link>
              </p>
              <p className="small muted">{WORLD.notLinkable}</p>
            </ContextSection>
          ) : linkable ? (
            <ContextSection title={WORLD.linkedManuscript} count={props.linking.length}>
              {props.linking.length ? (
                <ul className="context-links">
                  {props.linking.map((l) => (
                    <li key={l.recordId}>
                      <Link href={`${base}/records/${encodeURIComponent(l.recordId)}`}>{l.title}</Link>
                      <span className="small muted">
                        {" "}
                        {RECORD_TYPE_LABELS[l.type]}
                        {l.chapterTitle ? `, in ${l.chapterTitle}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">{WORLD.noLinkedManuscript}</p>
              )}
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
        </WorldContextAside>
      </div>
      </WorldContextProvider>

      <section aria-label={RECORD.detailsLabel} className="record-details reference-details">
        <div className="grid2">
          <StatusSection projectId={projectId} record={record} />
          <ProtectionSection projectId={projectId} record={record} />
        </div>
        <HistorySection projectId={projectId} record={record} revisions={revisions} />
        <CompareSection revisions={revisions} query={props.query} />
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
