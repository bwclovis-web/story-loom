import type { Metadata } from "next";
import Link from "next/link";
import { DraftDefaultsPanel, VisitDraftSwitcher, type DraftOption } from "@/components/drafts/DraftControls";
import { MarkdownView } from "@/components/MarkdownView";
import { TextAppearanceMenu } from "@/components/TextAppearanceMenu";
import { getDb } from "@/server/db";
import { resolveReadingDraftId } from "@/server/draftSelection";
import { getDraftDefaults, listManuscriptDrafts } from "@/server/services/draftService";
import { listRecordNav } from "@/server/services/recordService";
import { DRAFT, NAV, READ_BOOK } from "@/ui/labels";
import { buildManuscriptTree } from "@/ui/manuscriptTree";
import { parseMarkdown } from "@/writing/markdownParse";
import { countWords, formatWordCount } from "@/writing/wordCount";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${NAV.readBook} · ${NAV.brand}` };

/** Imported chapters often open with their own title as a heading; it is already shown above the text. */
function withoutTitleHeading(body: string, title: string): string {
  const m = body.match(/^\s*#{1,6}[ \t]+(.+?)[ \t#]*(?:\r?\n|$)/);
  return m && m[1].trim().toLowerCase() === title.trim().toLowerCase() ? body.slice(m[0].length) : body;
}

export default async function ReadBookPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ draft?: string; beside?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const db = getDb();
  const [drafts, defaults] = await Promise.all([listManuscriptDrafts(db, projectId), getDraftDefaults(db, projectId)]);
  const hasDrafts = drafts.length > 0;
  const selectedDraftId = resolveReadingDraftId(drafts, defaults, query.draft ?? null);
  const draftOptions: DraftOption[] = drafts.map((d) => ({
    id: d.id,
    kind: d.kind,
    label: d.label,
    completedAt: d.completedAt?.toISOString() ?? null,
  }));
  const tree = buildManuscriptTree(await listRecordNav(db, projectId, { hasDrafts, draftId: selectedDraftId }));
  const ids = [...tree.chapters.flatMap((c) => [c.id, ...c.scenes.map((s) => s.id)]), ...tree.unplaced.map((s) => s.id)];
  const rows = await db.record.findMany({
    where: { projectId, id: { in: ids }, trashedAt: null },
    select: { id: true, title: true, body: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const words = rows.reduce((sum, r) => sum + countWords(r.body), 0);
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const editHref = (id: string) => `${base}/records/${encodeURIComponent(id)}`;
  const anchor = (id: string) => `read-${id}`;
  const selectedLabel = drafts.find((d) => d.id === selectedDraftId)?.label;
  const beside = query.beside === "1" && drafts.length >= 2;
  const zeroDraft = drafts.find((d) => d.kind === "zero_draft") ?? drafts[0];
  const authorDraft = drafts.find((d) => d.kind === "author_manuscript" && d.id !== zeroDraft?.id) ?? drafts.find((d) => d.id !== zeroDraft?.id);


  const Part = ({ id, level }: { id: string; level: 2 | 3 }) => {
    const record = byId.get(id);
    if (!record) return null;
    const Heading = level === 2 ? "h2" : "h3";
    const text = withoutTitleHeading(record.body, record.title);
    return (
      <section className={level === 2 ? "book-chapter" : "book-scene"} aria-labelledby={anchor(id)}>
        <div className="book-heading">
          <Heading id={anchor(id)}>{record.title}</Heading>
          <Link className="small" href={editHref(id)} aria-label={`${READ_BOOK.edit} ${record.title}`}>
            {READ_BOOK.edit}
          </Link>
        </div>
        {text.trim() ? (
          <MarkdownView doc={parseMarkdown(text)} className="book-text" />
        ) : (
          <p className="muted small">{READ_BOOK.emptyText}</p>
        )}
      </section>
    );
  };

  return (
    <div className={`book-view${beside ? " is-beside" : ""}`}>
      <div className="book-top">
        <div>
          <h1>{NAV.readBook}</h1>
          <p className="page-lead">{READ_BOOK.lead}</p>
        </div>
        <TextAppearanceMenu />
      </div>
      {drafts.length >= 2 ? (
        <p className="row">
          {beside ? (
            <Link href={`${base}/read`}>{READ_BOOK.oneDraft}</Link>
          ) : (
            <Link href={`${base}/read?beside=1`}>{READ_BOOK.besideDrafts}</Link>
          )}
        </p>
      ) : null}
      {hasDrafts ? (
        <section className="panel stack">
          <VisitDraftSwitcher
            drafts={draftOptions}
            selectedDraftId={selectedDraftId}
            basePath={`${base}/read`}
            label={DRAFT.readingDraft}
          />
          <p className="small muted">
            {defaults.defaultReadingDraftId
              ? DRAFT.defaultReadingIs(drafts.find((d) => d.id === defaults.defaultReadingDraftId)?.label ?? defaults.defaultReadingDraftId)
              : DRAFT.noDefaultReading}
          </p>
          <DraftDefaultsPanel
            projectId={projectId}
            drafts={draftOptions}
            selectedDraftId={selectedDraftId}
            defaultReadingDraftId={defaults.defaultReadingDraftId}
            defaultExportDraftId={defaults.defaultExportDraftId}
            mode="reading"
          />
        </section>
      ) : null}
      {beside && zeroDraft && authorDraft ? (
        <div className="book-beside">
          <BookColumn projectId={projectId} draft={zeroDraft} hasDrafts={hasDrafts} />
          <BookColumn projectId={projectId} draft={authorDraft} hasDrafts={hasDrafts} />
        </div>
      ) : hasDrafts && !selectedDraftId ? (
        <p className="muted">{DRAFT.chooseDraftFirst}</p>
      ) : ids.length === 0 ? (
        <p className="muted">
          {READ_BOOK.empty} <Link href={`${base}/import-chapters`}>{NAV.importChapters}</Link>
        </p>
      ) : (
        <>
          {selectedLabel ? (
            <p className="small muted">
              {DRAFT.readingDraft}: {selectedLabel}
            </p>
          ) : null}
          <nav className="panel book-contents" aria-labelledby="book-contents-heading">
            <h2 id="book-contents-heading">{READ_BOOK.contents}</h2>
            <p className="small muted">
              {READ_BOOK.wordsTotal(formatWordCount(words))}. {READ_BOOK.order}
            </p>
            <ol>
              {tree.chapters.map((c) => (
                <li key={c.id}>
                  <a href={`#${anchor(c.id)}`}>{c.title}</a>
                </li>
              ))}
            </ol>
          </nav>
          <article className="book-body">
            {tree.chapters.map((c) => (
              <div key={c.id}>
                <Part id={c.id} level={2} />
                {c.scenes.map((s) => (
                  <Part key={s.id} id={s.id} level={3} />
                ))}
              </div>
            ))}
            {tree.unplaced.length ? (
              <div>
                <h2>{READ_BOOK.unplaced}</h2>
                {tree.unplaced.map((s) => (
                  <Part key={s.id} id={s.id} level={3} />
                ))}
              </div>
            ) : null}
          </article>
        </>
      )}
    </div>
  );
}

async function BookColumn({
  projectId,
  draft,
  hasDrafts,
}: {
  projectId: string;
  draft: { id: string; label: string };
  hasDrafts: boolean;
}) {
  const db = getDb();
  const tree = buildManuscriptTree(await listRecordNav(db, projectId, { hasDrafts, draftId: draft.id }));
  const ids = [...tree.chapters.flatMap((c) => [c.id, ...c.scenes.map((s) => s.id)]), ...tree.unplaced.map((s) => s.id)];
  const rows = ids.length
    ? await db.record.findMany({
        where: { projectId, id: { in: ids }, trashedAt: null },
        select: { id: true, title: true, body: true },
      })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const words = rows.reduce((sum, r) => sum + countWords(r.body), 0);
  const anchor = (id: string) => `read-${draft.id}-${id}`;
  const editHref = (id: string) => `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(id)}`;
  const Part = ({ id, level }: { id: string; level: 2 | 3 }) => {
    const record = byId.get(id);
    if (!record) return null;
    const Heading = level === 2 ? "h2" : "h3";
    const text = withoutTitleHeading(record.body, record.title);
    return (
      <section className={level === 2 ? "book-chapter" : "book-scene"} aria-labelledby={anchor(id)}>
        <div className="book-heading">
          <Heading id={anchor(id)}>{record.title}</Heading>
          <Link className="small" href={editHref(id)} aria-label={`${READ_BOOK.edit} ${record.title}`}>
            {READ_BOOK.edit}
          </Link>
        </div>
        {text.trim() ? <MarkdownView doc={parseMarkdown(text)} className="book-text" /> : <p className="muted small">{READ_BOOK.emptyText}</p>}
      </section>
    );
  };
  return (
    <section className="book-beside-col" aria-label={draft.label}>
      <h2>{draft.label}</h2>
      {ids.length === 0 ? (
        <p className="muted">{READ_BOOK.besideEmpty}</p>
      ) : (
        <>
          <p className="small muted">{READ_BOOK.wordsTotal(formatWordCount(words))}</p>
          <article className="book-body">
            {tree.chapters.map((c) => (
              <div key={c.id}>
                <Part id={c.id} level={2} />
                {c.scenes.map((s) => (
                  <Part key={s.id} id={s.id} level={3} />
                ))}
              </div>
            ))}
          </article>
        </>
      )}
    </section>
  );
}
