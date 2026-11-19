"use client";
import { Button } from "@/components/ui/Button";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import type { Issue } from "@/domain/issues";
import { WORLD } from "@/ui/labels";
import { createBoardAction } from "./actions";

export function CreateBoardForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [templateKey, setTemplateKey] = useState<"blank" | "geography">("blank");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await createBoardAction(projectId, { title, templateKey });
          if (!result.ok) {
            setIssues(result.issues);
            return;
          }
          setIssues([]);
          setTitle("");
          router.push(`/projects/${encodeURIComponent(projectId)}/world/boards/${encodeURIComponent(result.boardId)}`);
          router.refresh();
        });
      }}
    >
      <label>
        {WORLD.boardTitle}
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <fieldset>
        <legend>{WORLD.boardTemplate}</legend>
        <label className="inline">
          <input
            type="radio"
            name="template"
            checked={templateKey === "blank"}
            onChange={() => setTemplateKey("blank")}
          />
          {WORLD.templateBlank}
        </label>
        <label className="inline">
          <input
            type="radio"
            name="template"
            checked={templateKey === "geography"}
            onChange={() => setTemplateKey("geography")}
          />
          {WORLD.templateGeography}
        </label>
        {templateKey === "geography" ? <p className="small muted">{WORLD.templateGeographyHint}</p> : null}
      </fieldset>
      <IssueList issues={issues} />
      <Button type="submit" disabled={pending} size="sm">
        {WORLD.createBoard}
      </Button>
    </form>
  );
}
