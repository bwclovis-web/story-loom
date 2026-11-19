"use client";
import { Button } from "@/components/ui/Button";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import type { Issue } from "@/domain/issues";
import { WEAVE_VIEW_KINDS, WEAVE_VIEW_LABELS, type WeaveViewKind } from "@/server/services/weaveService";
import { WEAVE } from "@/ui/labels";
import { createWeaveGridAction } from "./actions";

export function CreateWeaveGridForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [viewKind, setViewKind] = useState<WeaveViewKind>("original");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="row"
      style={{ flexWrap: "wrap", gap: "0.5rem", alignItems: "end" }}
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
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={WEAVE_VIEW_LABELS[viewKind]} maxLength={200} />
      </label>
      <label>
        {WEAVE.viewKind}
        <select value={viewKind} onChange={(e) => setViewKind(e.target.value as WeaveViewKind)}>
          {WEAVE_VIEW_KINDS.map((k) => (
            <option key={k} value={k}>
              {WEAVE_VIEW_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={pending}>
        {WEAVE.createGrid}
      </Button>
      <IssueList issues={issues} />
    </form>
  );
}
