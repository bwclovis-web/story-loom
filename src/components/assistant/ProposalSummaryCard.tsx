import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";
import type { ProposalView } from "@/server/services/assistantProposalService";
import { cn } from "@/ui/cn";
import { ASSISTANT } from "@/ui/labels";

/** Compact proposal card for the Write rail and other dense surfaces. */
export function ProposalSummaryCard({ projectId, proposal }: { projectId: string; proposal: ProposalView }) {
  const applied = Boolean(proposal.result);
  const first = proposal.preview?.operations[0];
  const detail =
    first?.note?.trim() ||
    first?.titleAfter ||
    (proposal.operationCount
      ? `${proposal.operationCount} change${proposal.operationCount === 1 ? "" : "s"} ready to review`
      : ASSISTANT.proposalHeading);
  return (
    <section className="proposal-summary-card">
      <div className="proposal-summary-head">
        <h3>{ASSISTANT.suggestedUpdate}</h3>
        <span className={`badge ${applied ? "approved" : "proposed"}`}>
          {applied ? ASSISTANT.proposalAppliedShort : ASSISTANT.proposalNotAppliedShort}
        </span>
      </div>
      <p className="small">{detail}</p>
      <Link
        className={cn(buttonVariants({ variant: "primary", size: "sm" }), "no-underline")}
        href={`/projects/${encodeURIComponent(projectId)}/assistant/proposals/${encodeURIComponent(proposal.id)}`}
      >
        {ASSISTANT.reviewProposal}
      </Link>
    </section>
  );
}
