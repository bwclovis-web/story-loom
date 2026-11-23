"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IssueList } from "@/components/IssueList";
import { Button } from "@/components/ui/Atoms/Button";
import { TextField } from "@/components/ui/TextField";
import type { Issue } from "@/domain/issues";
import { WEAVE } from "@/ui/labels";
import { createCustomWeaveStructureAction } from "./actions";

type StageDraft = { title: string; guidance: string; groupTitle: string };

export function CustomStructureForm({
  projectId,
  gridId,
  onDone,
  onCancel,
}: {
  projectId: string;
  gridId: string;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [attribution, setAttribution] = useState("");
  const [stages, setStages] = useState<StageDraft[]>([{ title: "", guidance: "", groupTitle: "" }]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();

  return (
    <section className="panel weave-custom-structure" aria-labelledby="custom-structure-heading">
      <h2 id="custom-structure-heading">{WEAVE.customStructureHeading}</h2>
      <p className="small muted">{WEAVE.customStructureLead}</p>
      <IssueList issues={issues} />
      <div className="weave-structure-fields">
        <TextField label={WEAVE.customStructureTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField
          label={WEAVE.customStructureAttribution}
          value={attribution}
          onChange={(e) => setAttribution(e.target.value)}
        />
      </div>
      <ul className="weave-custom-stage-list">
        {stages.map((stage, index) => (
          <li key={index}>
            <TextField
              label={`${WEAVE.customStructureStageTitle} ${index + 1}`}
              value={stage.title}
              onChange={(e) =>
                setStages((list) => list.map((row, i) => (i === index ? { ...row, title: e.target.value } : row)))
              }
            />
            <TextField
              label={WEAVE.customStructureGroup}
              value={stage.groupTitle}
              onChange={(e) =>
                setStages((list) =>
                  list.map((row, i) => (i === index ? { ...row, groupTitle: e.target.value } : row)),
                )
              }
            />
            <TextField
              multiline
              rows={2}
              label={WEAVE.customStructureGuidance}
              value={stage.guidance}
              onChange={(e) =>
                setStages((list) =>
                  list.map((row, i) => (i === index ? { ...row, guidance: e.target.value } : row)),
                )
              }
            />
          </li>
        ))}
      </ul>
      <div className="weave-structure-actions">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => setStages((list) => [...list, { title: "", guidance: "", groupTitle: "" }])}
        >
          {WEAVE.customStructureAddStage}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              if (!title.trim()) {
                setIssues([{ code: "INVALID_CHANGE", severity: "error", message: WEAVE.customStructureNeedTitle }]);
                return;
              }
              if (!stages.some((stage) => stage.title.trim())) {
                setIssues([{ code: "INVALID_CHANGE", severity: "error", message: WEAVE.customStructureNeedStages }]);
                return;
              }
              const result = await createCustomWeaveStructureAction(projectId, gridId, {
                title,
                attribution,
                stages,
              });
              if (!result.ok) {
                setIssues(result.issues);
                return;
              }
              setIssues([]);
              onDone?.();
              router.refresh();
            })
          }
        >
          {pending ? WEAVE.structuresAdding : WEAVE.customStructureCreate}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </section>
  );
}
