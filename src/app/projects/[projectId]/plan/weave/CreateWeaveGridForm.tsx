"use client";
import { Button } from "@/components/ui/Atoms/Button";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import type { Issue } from "@/domain/issues";
import { WEAVE_VIEW_KINDS, WEAVE_VIEW_LABELS, type WeaveViewKind } from "@/server/services/weaveService";
import { HOME, WEAVE } from "@/ui/labels";
import { createWeaveGridAction } from "./actions";

export function CreateWeaveGridForm({
  projectId,
  initialViewKind = "original",
  onCancel,
}: {
  projectId: string;
  initialViewKind?: WeaveViewKind;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [viewKind, setViewKind] = useState<WeaveViewKind>(initialViewKind);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="weave-create-form"
      onSubmit={(e) => {
        e.preventDefault();
        setIssues([]);
        startTransition(async () => {
          const result = await createWeaveGridAction(projectId, { title, viewKind });
          if (!result.ok) {
            setIssues(result.issues);
            return;
          }
          router.push(`/projects/${encodeURIComponent(projectId)}/plan/weave/${encodeURIComponent(result.gridId)}`);
        });
      }}
    >
      <label>
        {WEAVE.gridTitle}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={WEAVE_VIEW_LABELS[viewKind]} maxLength={200} autoComplete="off" />
      </label>
      <label>
        {WEAVE.planningScope}
        <select value={viewKind} onChange={(e) => setViewKind(e.target.value as WeaveViewKind)}>
          {WEAVE_VIEW_KINDS.map((k) => (
            <option key={k} value={k}>
              {WEAVE_VIEW_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <Button type="submit" disabled={pending}>
          {pending ? WEAVE.creatingGrid : WEAVE.createGridAction}
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
            {HOME.cancel}
          </Button>
        ) : null}
      </div>
      <IssueList issues={issues} />
    </form>
  );
}
