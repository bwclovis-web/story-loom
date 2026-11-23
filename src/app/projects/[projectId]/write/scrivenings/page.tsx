import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { ScriveningsScene, type ScriveningsRecord } from "@/components/write/ScriveningsScene";
import { ButtonLink } from "@/components/ui/Atoms/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Banner } from "@/components/ui/Banner";
import { stableStringify } from "@/domain/json";
import { getDb } from "@/server/db";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { findProject } from "@/server/services/projectService";
import { listRecordNav, getRecord } from "@/server/services/recordService";
import { NAV, SHELL, WRITE } from "@/ui/labels";
import { buildManuscriptTree } from "@/ui/manuscriptTree";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${WRITE.scrivenings} · ${NAV.brand}` };

export default async function ScriveningsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ chapter?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();
  const drafts = await listManuscriptDrafts(db, projectId);
  const activeDraftId = resolveWriteDraftId(drafts, await readWriteDraftCookie());
  const hasDrafts = drafts.length > 0;
  const nav = await listRecordNav(db, projectId, { hasDrafts, draftId: activeDraftId });
  const tree = buildManuscriptTree(nav.filter((r) => r.type === "manuscript_chapter" || r.type === "manuscript_scene"));
  const chapterId = query.chapter?.trim() || tree.chapters[0]?.id || null;
  const chapter = chapterId ? tree.chapters.find((c) => c.id === chapterId) : null;
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const writeHref = `${base}/write`;
  const draftOptions = drafts.map((d) => ({
    id: d.id,
    kind: d.kind,
    label: d.label,
    completedAt: d.completedAt?.toISOString() ?? null,
  }));

  const records: ScriveningsRecord[] = [];
  if (chapter) {
    const chapterRow = await getRecord(db, projectId, chapter.id);
    records.push({
      id: chapterRow.id,
      title: chapterRow.title,
      body: chapterRow.body,
      fieldsJson: stableStringify(chapterRow.fields ?? {}),
      revision: chapterRow.currentRevision,
      protected: chapterRow.protected,
      kind: "chapter",
    });
    for (const scene of chapter.scenes) {
      const row = await getRecord(db, projectId, scene.id);
      records.push({
        id: row.id,
        title: row.title,
        body: row.body,
        fieldsJson: stableStringify(row.fields ?? {}),
        revision: row.currentRevision,
        protected: row.protected,
        kind: "scene",
      });
    }
  }

  return (
    <>
      <ProjectPageHeader
        projectId={projectId}
        title={WRITE.scrivenings}
        crumbs={[
          { href: writeHref, label: SHELL.write },
          { label: WRITE.scrivenings, current: true },
        ]}
      />
      <div className="stack page-pad">
        <p className="lead">{WRITE.scriveningsLead}</p>
        {tree.chapters.length === 0 ? (
          <EmptyState>
            {WRITE.scriveningsEmpty}. {WRITE.scriveningsEmptyHint}
          </EmptyState>
        ) : (
          <>
            <nav className="row wrap" aria-label={WRITE.scriveningsChapter}>
              {tree.chapters.map((c) => (
                <ButtonLink
                  key={c.id}
                  href={`${base}/write/scrivenings?chapter=${encodeURIComponent(c.id)}`}
                  variant={c.id === chapter?.id ? "brass" : "secondary"}
                  size="sm"
                >
                  {c.title}
                </ButtonLink>
              ))}
            </nav>
            {!chapter ? (
              <Banner tone="info">{WRITE.scriveningsPickChapter}</Banner>
            ) : records.length === 0 ? (
              <EmptyState>{WRITE.scriveningsEmptyChapter}</EmptyState>
            ) : (
              <div className="scrivenings-stream stack">
                {records.map((record) => (
                  <ScriveningsScene
                    key={record.id}
                    projectId={projectId}
                    record={record}
                    drafts={draftOptions}
                    draftScopeId={activeDraftId}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
