import Link from "next/link";
import { CopyButton } from "@/components/CopyButton";
import { ResultSummary } from "@/components/PackagePreview";
import { Banner } from "@/components/ui/Banner";
import { ButtonLink } from "@/components/ui/ButtonLink";
import type { ProposalView } from "@/server/services/assistantProposalService";
import { ASSISTANT } from "@/ui/labels";
import { reviewRecords, validationState } from "@/ui/packageReview";

/* A prepared proposal under its answer. Reviewing and applying happen on the proposal review page. */
export function ProposalCard({ projectId, proposal }: { projectId: string; proposal: ProposalView }) {
  const result = proposal.result;
  const preview = proposal.preview;
  const records = preview ? reviewRecords(preview) : [];
  const state = preview ? validationState(preview) : null;
  const reviewHref = `/projects/${projectId}/assistant/proposals/${proposal.id}`;

  return (
    <section id={`proposal-${proposal.id}`} className="panel stack proposal" aria-label={`${ASSISTANT.proposalHeading} ${proposal.packageId}`}>
      <div className="row">
        <h3 style={{ margin: 0 }}>{ASSISTANT.proposalHeading}</h3>
        <code className="small">{proposal.packageId}</code>
        <span className={`badge ${result ? "approved" : "proposed"}`}>{result ? "applied" : "not applied"}</span>
        <span className="small muted">
          {records.length || proposal.operationCount} record{(records.length || proposal.operationCount) === 1 ? "" : "s"}
        </span>
      </div>

      {result ? (
        <>
          <Banner tone="ok">
            {ASSISTANT.proposalApplied} <Link href={`/projects/${projectId}/history`}>History &amp; review</Link>
          </Banner>
          <ResultSummary result={result} projectId={projectId} />
        </>
      ) : preview ? (
        <>
          <p className="small">
            {ASSISTANT.proposalNotApplied}{" "}
            {state === "ready" ? ASSISTANT.proposalReady : state === "stale" ? ASSISTANT.proposalOutOfDate : ASSISTANT.proposalBlocked}
          </p>
          <ul className="small">
            {records.map((r) => (
              <li key={r.recordId}>
                <strong>{r.title}</strong> <span className="muted">({r.changes.join(", ")})</span>
              </li>
            ))}
          </ul>
          <div>
            <ButtonLink href={reviewHref}>{ASSISTANT.reviewProposal}</ButtonLink>
          </div>
        </>
      ) : null}

      <details>
        <summary className="small">Package JSON (marked proposed)</summary>
        <textarea className="mono" readOnly spellCheck={false} value={proposal.packageJson} aria-label="Proposal package JSON" style={{ minHeight: "10rem" }} />
        <CopyButton text={proposal.packageJson} label={ASSISTANT.copyPackage} />
      </details>
    </section>
  );
}
