"use client";

import Link from "next/link";
import { Button, ButtonLink } from "@/components/ui/Button";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import type { Issue } from "@/domain/issues";
import type { BoardAskPreview } from "@/server/services/establishedFactService";
import { WORLD } from "@/ui/labels";
import { previewBoardAskAction } from "./actions";
export function AskAboutBoard({ projectId, boardId }: { projectId: string; boardId: string }) {
  const [pending, startTransition] = useTransition();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [preview, setPreview] = useState<BoardAskPreview | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <div className="stack">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await previewBoardAskAction(projectId, boardId);
            if (!result.ok) {
              setIssues(result.issues);
              setPreview(null);
              setOpen(true);
              return;
            }
            setIssues([]);
            setPreview(result.preview);
            setOpen(true);
          })
        }
      >
        {WORLD.askAboutBoard}
      </Button>

      {open ? (
        <section className="panel stack" aria-label={WORLD.askAboutBoardPreview}>
          <p className="small muted">{WORLD.askAboutBoardNote}</p>
          <IssueList issues={issues} />
          {preview ? (
            <>
              <h3 className="small">{WORLD.askAboutBoardPreview}</h3>
              {preview.records.length === 0 ? (
                <p className="small muted">{WORLD.boardAskNoRecords}</p>
              ) : (
                <ul className="context-links">
                  {preview.records.map((r) => (
                    <li key={r.recordId}>
                      <strong>{r.title}</strong>
                      <span className="small muted"> ({r.typeLabel})</span>
                      {r.sections.length ? (
                        <div className="small muted">
                          {WORLD.boardAskSections}: {r.sections.map((s) => s.title || "(untitled)").join(", ")}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {preview.noteCards.length ? (
                <>
                  <h3 className="small">{WORLD.boardAskNotes}</h3>
                  <ul className="context-links">
                    {preview.noteCards.map((n) => (
                      <li key={n.cardId}>
                        <strong>{n.title}</strong>
                        <div className="small muted">{n.bodyPreview || "(empty)"}</div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {preview.records.length ? (
                <ButtonLink href={`/projects/${encodeURIComponent(projectId)}/assistant?board=${encodeURIComponent(boardId)}`}>{WORLD.openAssistantWithBoard}</ButtonLink>
              ) : null}
            </>
          ) : null}
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </section>
      ) : null}
    </div>
  );
}
