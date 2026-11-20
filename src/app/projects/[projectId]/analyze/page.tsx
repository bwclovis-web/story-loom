import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { getAssistantConfig } from "@/server/assistantConfig";
import { getDb } from "@/server/db";
import { listChapterAnalyses, manuscriptCountsByDraft } from "@/server/services/chapterAnalysisService";
import { LIVE_RECORD } from "@/server/services/trashFilters";
import { ANALYZE, SHELL } from "@/ui/labels";
import { AnalyzeChapterForm } from "./AnalyzeChapterForm";

export const dynamic = "force-dynamic";

export default async function AnalyzeChapterPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getDb();
  const [counts, runs] = await Promise.all([
    manuscriptCountsByDraft(db, projectId),
    listChapterAnalyses(db, projectId).catch(() => []),
  ]);
  const zeroIds = counts.filter((row) => row.kind === "zero_draft" && row.id).map((row) => row.id as string);
  const chapters = zeroIds.length
    ? await db.record.findMany({
        where: { projectId, ...LIVE_RECORD, type: "manuscript_chapter", draftId: { in: zeroIds } },
        select: { id: true, title: true, currentRevision: true },
        orderBy: [{ position: "asc" }, { title: "asc" }],
      })
    : [];
  const revisions = chapters.length
    ? await db.revision.findMany({
        where: { recordId: { in: chapters.map((chapter) => chapter.id) } },
        select: { recordId: true, revisionNumber: true },
        orderBy: { revisionNumber: "asc" },
      })
    : [];
  const byChapter = new Map<string, number[]>();
  for (const revision of revisions) {
    const list = byChapter.get(revision.recordId) ?? [];
    list.push(revision.revisionNumber);
    byChapter.set(revision.recordId, list);
  }
  const titles = new Map(chapters.map((chapter) => [chapter.id, chapter.title]));
  const config = getAssistantConfig();
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <Breadcrumbs
        label="Breadcrumb"
        items={[
          { href: `${base}/plan`, label: SHELL.plan },
          { label: ANALYZE.heading, current: true },
        ]}
      />
      <PageHeader title={ANALYZE.heading} lead={ANALYZE.lead} />
      <h2>{ANALYZE.counts}</h2>
      <table>
        <thead>
          <tr>
            <th>Draft</th>
            <th>{ANALYZE.chapters}</th>
            <th>{ANALYZE.scenes}</th>
          </tr>
        </thead>
        <tbody>
          {counts.map((row) => (
            <tr key={row.id ?? "legacy"}>
              <td>
                {row.label}
                {row.kind === "legacy" ? "" : row.kind === "zero_draft" ? " (Zero draft)" : " (Author manuscript)"}
              </td>
              <td>{row.chapters}</td>
              <td>{row.scenes}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {chapters.length ? (
        <AnalyzeChapterForm
          projectId={projectId}
          assistantConfigured={config.status.configured}
          limits={config.status.limits}
          chapters={chapters.map((chapter) => ({
            id: chapter.id,
            title: chapter.title,
            currentRevision: chapter.currentRevision,
            revisions: byChapter.get(chapter.id) ?? [chapter.currentRevision],
          }))}
        />
      ) : (
        <p>{ANALYZE.noZero}</p>
      )}
      {runs.length ? (
        <>
          <h2>{ANALYZE.recent}</h2>
          <ul>
            {runs.map((run) => (
              <li key={run.id}>
                <Link href={`${base}/analyze/${encodeURIComponent(run.id)}`}>
                  {titles.get(run.chapterRecordId) ?? "Chapter"} · revision {run.pinnedRevision} · {run.status}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
