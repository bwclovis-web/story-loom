import Link from "next/link";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { getDb } from "@/server/db";
import { getChapterAnalysis } from "@/server/services/chapterAnalysisService";
import { NotFoundError } from "@/server/services/errors";
import { LIVE_RECORD } from "@/server/services/trashFilters";
import { ANALYZE, SHELL } from "@/ui/labels";
import { AnalyzeReview } from "../AnalyzeReview";

export const dynamic = "force-dynamic";

export default async function AnalyzeReviewPage({ params }: { params: Promise<{ projectId: string; runId: string }> }) {
  const { projectId, runId } = await params;
  const db = getDb();
  let run;
  try {
    run = await getChapterAnalysis(db, projectId, runId);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return (
        <>
          <PageHeader title={ANALYZE.heading} lead="This analysis is not in the project." />
        </>
      );
    }
    throw error;
  }
  const characters = await db.record.findMany({
    where: { projectId, ...LIVE_RECORD, type: "character_dossier" },
    select: { id: true, title: true },
    orderBy: { title: "asc" },
  });
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <Breadcrumbs
        label="Breadcrumb"
        items={[
          { href: `${base}/plan`, label: SHELL.plan },
          { href: `${base}/analyze`, label: ANALYZE.heading },
          { label: run.chapterTitle, current: true },
        ]}
      />
      <PageHeader
        title={ANALYZE.review}
        lead={`${run.chapterTitle}, revision ${run.pinnedRevision}. Status: ${run.status}.`}
      />
      {run.errorMessage ? <p role="status">{run.errorMessage}</p> : null}
      {run.proposal ? (
        <AnalyzeReview
          projectId={projectId}
          runId={run.id}
          contentHash={run.contentHash}
          proposal={run.proposal}
          initialDecisions={run.decisions}
          sentMaterial={run.sentMaterial}
          requestChars={run.requestChars}
          characters={characters}
          canApply={run.status === "proposed" || run.status === "applied"}
        />
      ) : (
        <p>
          <Link href={`${base}/analyze`}>Back to Analyze chapter</Link>
        </p>
      )}
    </>
  );
}
