import type { Metadata } from "next";
import Link from "next/link";
import { MarkdownView } from "@/components/MarkdownView";
import { TextAppearanceMenu } from "@/components/TextAppearanceMenu";
import { getDb } from "@/server/db";
import { listRecordNav } from "@/server/services/recordService";
import { NAV, READ_BOOK } from "@/ui/labels";
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

export default async function ReadBookPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getDb();
  const tree = buildManuscriptTree(await listRecordNav(db, projectId));
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
    <div className="book-view">
      <div className="book-top">
        <div>
          <h1>{NAV.readBook}</h1>
          <p className="page-lead">{READ_BOOK.lead}</p>
        </div>
        <TextAppearanceMenu />
      </div>
      {ids.length === 0 ? (
        <p className="muted">
          {READ_BOOK.empty} <Link href={`${base}/import-chapters`}>{NAV.importChapters}</Link>
        </p>
      ) : (
        <>
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
