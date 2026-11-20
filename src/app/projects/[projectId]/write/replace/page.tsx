import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VisitDraftSwitcher } from "@/components/drafts/DraftControls";
import { HelpHint } from "@/components/HelpHint";
import { Button, ButtonLink } from "@/components/ui/Button";
import { DRAFT } from "@/ui/labels";
import { getDb } from "@/server/db";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { previewManuscriptReplace } from "@/server/services/manuscriptReplaceService";
import { findProject } from "@/server/services/projectService";
import { MANUSCRIPT_REPLACE, MANUSCRIPT_SEARCH, NAV } from "@/ui/labels";
import { ManuscriptReplaceReview } from "./ManuscriptReplaceReview";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ projectId: string }> }): Promise<Metadata> {
  const { projectId } = await params;
  const db = getDb();
  const project = await findProject(db, projectId);
  return { title: project ? `${MANUSCRIPT_REPLACE.heading} · ${project.title}` : NAV.brand };
}

export default async function ManuscriptReplacePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ find?: string; replace?: string; case?: string; word?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const find = (query.find ?? "").trim();
  const replace = String(query.replace ?? "");
  const matchCase = query.case === "1";
  const wholeWord = query.word === "1";
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const drafts = await listManuscriptDrafts(db, projectId);
  const hasDrafts = drafts.length > 0;
  const draftId = resolveWriteDraftId(drafts, await readWriteDraftCookie());
  const preview =
    find.length > 0
      ? await previewManuscriptReplace(db, {
          projectId,
          find,
          replace,
          matchCase,
          wholeWord,
          hasDrafts,
          draftId,
        })
      : null;

  return (
    <>
      <h1>{MANUSCRIPT_REPLACE.heading}</h1>
      <p className="page-lead">{MANUSCRIPT_REPLACE.lead}</p>
      <HelpHint anchor="manuscript-replace" topic="replace across the manuscript">
        {MANUSCRIPT_SEARCH.note}
      </HelpHint>

      {hasDrafts ? (
        <section className="panel">
          <VisitDraftSwitcher
            drafts={drafts.map((d) => ({
              id: d.id,
              kind: d.kind,
              label: d.label,
              completedAt: d.completedAt?.toISOString() ?? null,
            }))}
            selectedDraftId={draftId}
            basePath={`${base}/write/replace`}
            label={DRAFT.draftLabel}
          />
        </section>
      ) : null}

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>{MANUSCRIPT_REPLACE.searchHeading}</h2>
        <form className="stack" method="get" action={`${base}/write/replace`}>
          <label>
            {MANUSCRIPT_REPLACE.find}
            <input type="search" name="find" required defaultValue={find} />
          </label>
          <label>
            {MANUSCRIPT_REPLACE.replaceWith}
            <input type="text" name="replace" defaultValue={replace} />
          </label>
          <div className="row">
            <label className="inline small">
              <input type="checkbox" name="case" value="1" defaultChecked={matchCase} /> {MANUSCRIPT_SEARCH.matchCase}
            </label>
            <label className="inline small">
              <input type="checkbox" name="word" value="1" defaultChecked={wholeWord} /> {MANUSCRIPT_REPLACE.wholeWord}
            </label>
          </div>
          <div className="row">
            <Button type="submit">{MANUSCRIPT_REPLACE.preview}</Button>
            <ButtonLink href={`${base}/write`} variant="secondary">
              {MANUSCRIPT_REPLACE.backToWrite}
            </ButtonLink>
          </div>
        </form>
      </section>

      {preview ? <ManuscriptReplaceReview projectId={projectId} preview={preview} base={base} /> : null}
    </>
  );
}