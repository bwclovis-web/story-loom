"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Atoms/Button";
import type { Issue } from "@/domain/issues";
import type { WeaveBeatView } from "@/server/services/weaveService";
import { WEAVE } from "@/ui/labels";
import { createSceneFromWeaveBeatAction } from "./actions";

export function CreateSceneFromBeat({
  projectId,
  beat,
  chapters,
  onCreated,
  onIssues,
}: {
  projectId: string;
  beat: WeaveBeatView;
  chapters: Array<{ id: string; title: string }>;
  onCreated: (beat: WeaveBeatView) => void;
  onIssues: (issues: Issue[]) => void;
}) {
  const [chapterId, setChapterId] = useState(chapters[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  if (beat.manuscriptRecordId) return null;

  return (
    <form
      className="stack"
      style={{ gap: "0.4rem" }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!chapterId) return;
        startTransition(async () => {
          const result = await createSceneFromWeaveBeatAction(projectId, beat.id, chapterId);
          if (!result.ok) {
            onIssues(result.issues);
            return;
          }
          onIssues([]);
          onCreated(result.beat);
        });
      }}
    >
      <p className="small muted" style={{ margin: 0 }}>
        {WEAVE.createSceneHint}
      </p>
      {chapters.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          {WEAVE.createSceneNeedChapter}
        </p>
      ) : (
        <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap", alignItems: "end" }}>
          <label className="small">
            {WEAVE.createSceneChapter}
            <select
              value={chapterId}
              aria-label={WEAVE.createSceneChapter}
              onChange={(event) => setChapterId(event.target.value)}
              required
            >
              {chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.title}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" disabled={pending || !chapterId}>
            {pending ? WEAVE.createSceneWorking : WEAVE.createSceneFromBeat}
          </Button>
        </div>
      )}
    </form>
  );
}
