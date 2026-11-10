"use client";

import { useCallback } from "react";
import { PackageReview } from "@/components/review/PackageReview";
import type { ProposalReview } from "@/server/services/assistantProposalService";
import { REVIEW } from "@/ui/labels";
import type { ApplyResponse } from "@/ui/packageReview";
import { applyProposalAction, refreshProposalAction } from "../../actions";

export function ProposalReviewClient({ projectId, review, checkedAt }: { projectId: string; review: ProposalReview; checkedAt: number }) {
  const { proposalId, contentHash } = review;
  const onApply = useCallback(
    async (confirm: { canon: boolean }): Promise<ApplyResponse> => {
      const response = await applyProposalAction(projectId, proposalId, contentHash, confirm.canon);
      return response.ok ? response.outcome : { status: "failed", message: response.message };
    },
    [projectId, proposalId, contentHash],
  );
  const onCheck = useCallback(async () => {
    const response = await refreshProposalAction(projectId, proposalId);
    return response.ok ? response.preview : null;
  }, [projectId, proposalId]);

  return (
    <PackageReview
      projectId={projectId}
      kind="proposal"
      initialPreview={review.preview}
      conversation={review.conversation}
      preparedAt={review.createdAt}
      checkedAt={checkedAt}
      back={{
        label: REVIEW.backToDiscussion,
        href: `/projects/${projectId}/assistant?c=${encodeURIComponent(review.conversation.id)}#proposal-${proposalId}`,
      }}
      onApply={onApply}
      onCheck={onCheck}
    />
  );
}
