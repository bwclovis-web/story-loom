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
  const [characters, pinned] = await Promise.all([
    db.record.findMany({
      where: { projectId, ...LIVE_RECORD, type: "character_dossier" },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    db.revision.findUnique({
      where: { recordId_revisionNumber: { recordId: run.chapterRecordId, revisionNumber: run.pinnedRevision } },
      select: { body: true },
    }),
  ]);
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const retry = `${base}/analyze?chapter=${encodeURIComponent(run.chapterRecordId)}&revision=${run.pinnedRevision}`;

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
      {run.usage ? (
        <p>
          Provider reported {run.usage.inputTokens.toLocaleString("en-US")} input and {run.usage.outputTokens.toLocaleString("en-US")} output tokens
          {run.usage.estimated ? " (estimated from length, not a price)" : ""}.
        </p>
      ) : null}
      {run.proposal ? (
        <AnalyzeReview
          projectId={projectId}
          runId={run.id}
          contentHash={run.contentHash}
          proposal={run.proposal}
          chapterBody={pinned?.body ?? ""}
          initialDecisions={run.decisions}
          initialAssessments={run.assessments}
          appliedKeys={run.appliedKeys}
          sentMaterial={run.sentMaterial}
          requestChars={run.requestChars}
          outputTokenAllowance={run.outputTokenAllowance}
          usage={run.usage}
          characters={characters}
          canApply={run.status === "proposed" || run.status === "applied"}
        />
      ) : (
        <p>
          <Link href={retry}>{ANALYZE.retry}</Link>
        </p>
      )}
    </>
  );
}
