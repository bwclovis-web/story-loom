"use client";
import { Hand, ImageIcon, Library, NotebookPen, Scan, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { RadioGroup } from "@/components/ui/RadioGroup";

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
  const previewTitle = title.trim() || WORLD.boardPreviewTitle;

  return (
  <>
    <div className="world-create-shell">
      <form
        className="world-create-form stack"
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
        <label className="world-create-field">
          {WORLD.boardTitle}
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder={WORLD.boardPreviewTitle} />
        </label>
        <RadioGroup
          layout="stack"
          legend={WORLD.boardTemplate}
          name="template"
          value={templateKey}
          onValueChange={(value) => {
            if (value === "blank" || value === "geography") setTemplateKey(value);
          }}
          options={[
            { value: "blank", label: WORLD.templateBlank },
            { value: "geography", label: WORLD.templateGeography },
          ]}
        />
        <p className="small muted">{WORLD.templateBlankHint}</p>
        {templateKey === "geography" ? <p className="small muted">{WORLD.templateGeographyHint}</p> : null}
        <IssueList issues={issues} />
        <div className="world-create-actions">
          <Button type="submit" disabled={pending} size="sm">
            {WORLD.createBoard}
          </Button>
        </div>
      </form>

      <aside className="world-create-preview board-create-preview" aria-hidden="true">
        <p className="world-create-preview-label">{previewTitle}</p>
        <div className="board-create-preview-canvas">
          <div className="board-create-preview-chrome" aria-hidden="true">
            <Hand strokeWidth={1.6} />
            <Scan strokeWidth={1.6} />
            <Search strokeWidth={1.6} />
          </div>
        </div>
      </aside>
    </div>

    <section className="world-create-next" aria-labelledby="board-next-heading">
      <h3 id="board-next-heading">{WORLD.afterCreateBoard}</h3>
      <ul className="world-create-next-list">
        <li>
          <Library strokeWidth={1.5} aria-hidden="true" />
          <div>
            <strong>{WORLD.boardNextReferenceTitle}</strong>
            <span className="small muted">{WORLD.boardNextReferenceHint}</span>
          </div>
        </li>
        <li>
          <ImageIcon strokeWidth={1.5} aria-hidden="true" />
          <div>
            <strong>{WORLD.boardNextImageTitle}</strong>
            <span className="small muted">{WORLD.boardNextImageHint}</span>
          </div>
        </li>
        <li>
          <NotebookPen strokeWidth={1.5} aria-hidden="true" />
          <div>
            <strong>{WORLD.boardNextNoteTitle}</strong>
            <span className="small muted">{WORLD.boardNextNoteHint}</span>
          </div>
        </li>
      </ul>
    </section>
  </>
  );
}