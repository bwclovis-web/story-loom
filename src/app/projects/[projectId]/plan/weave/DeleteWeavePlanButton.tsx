"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IssueList } from "@/components/IssueList";
import { Button } from "@/components/ui/Atoms/Button";
import type { Issue } from "@/domain/issues";
import { WEAVE } from "@/ui/labels";
import { deleteWeaveGridAction } from "./actions";

/** Confirm-then-delete for a Weave plan. Manuscript records stay. */
export function DeleteWeavePlanButton({
  projectId,
  gridId,
  title,
  size = "sm",
  variant = "ghost",
  redirectToLibrary = false,
}: {
  projectId: string;
  gridId: string;
  title: string;
  size?: "sm" | "md";
  variant?: "ghost" | "secondary";
  redirectToLibrary?: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();

  return (
    <div className="weave-delete-plan">
      <IssueList issues={issues} />
      {!confirm ? (
        <Button
          type="button"
          size={size}
          variant={variant}
          aria-label={WEAVE.deletePlanNamed(title)}
          disabled={pending}
          onClick={() => setConfirm(true)}
        >
          {WEAVE.deleteGrid}
        </Button>
      ) : (
        <Button
          type="button"
          size={size}
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteWeaveGridAction(projectId, gridId);
              if (!result.ok) {
                setIssues(result.issues);
                setConfirm(false);
                return;
              }
              setIssues([]);
              if (redirectToLibrary) {
                router.push(`/projects/${encodeURIComponent(projectId)}/plan`);
                return;
              }
              router.refresh();
            })
          }
        >
          {pending ? WEAVE.deletingPlan : WEAVE.confirmDeleteGrid(title)}
        </Button>
      )}
    </div>
  );
}
