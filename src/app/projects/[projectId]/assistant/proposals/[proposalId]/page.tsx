import { notFound } from "next/navigation";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { HelpHint } from "@/components/HelpHint";
import { getDb } from "@/server/db";
import { getProposalReview, type ProposalReview } from "@/server/services/assistantProposalService";
import { AssistantError } from "@/server/services/assistantService";
import { findProject } from "@/server/services/projectService";
import { REVIEW, SHELL } from "@/ui/labels";
import { ProposalReviewClient } from "./ProposalReviewClient";

export const dynamic = "force-dynamic";

export default async function ProposalReviewPage({ params }: { params: Promise<{ projectId: string; proposalId: string }> }) {
  const { projectId, proposalId } = await params;
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();

  let review: ProposalReview;
  try {
    review = await getProposalReview(db, projectId, proposalId);
  } catch (error) {
    if (error instanceof AssistantError) notFound();
    throw error;
  }

  return (
    <div className="stack">
      <ProjectPageHeader
        projectId={projectId}
        title={REVIEW.pageHeading}
        crumbs={[
          { href: `/projects/${encodeURIComponent(projectId)}/assistant`, label: SHELL.assistant },
          { label: REVIEW.pageHeading, current: true },
        ]}
      />
      <p className="muted small">{REVIEW.proposalIntro}</p>
      <HelpHint anchor="assistant-proposals" topic="reviewing proposals">
        Nothing changes until you choose Apply. The proposal is applied as a whole.
      </HelpHint>
      <ProposalReviewClient projectId={projectId} review={review} checkedAt={Date.now()} />
    </div>
  );
}
