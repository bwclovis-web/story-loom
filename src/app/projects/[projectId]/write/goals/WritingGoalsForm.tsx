"use client";

import { useActionState } from "react";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Atoms/Button";
import { submitWithoutReset } from "@/components/submitWithoutReset";
import type { WritingGoalView } from "@/server/services/writingGoalService";
import { WRITING_GOALS } from "@/ui/labels";
import {
  clearChapterGoalAction,
  clearProjectGoalAction,
  saveChapterGoalAction,
  saveProjectGoalAction,
  type GoalFormResult,
} from "./actions";

export function WritingGoalsForm({
  projectId,
  projectGoal,
  chapterGoals,
  chapters,
}: {
  projectId: string;
  projectGoal: WritingGoalView | null;
  chapterGoals: WritingGoalView[];
  chapters: { id: string; title: string }[];
}) {
  const [projectState, saveProject, projectPending] = useActionState<GoalFormResult, FormData>(
    saveProjectGoalAction.bind(null, projectId),
    { ok: true },
  );
  const [chapterState, saveChapter, chapterPending] = useActionState<GoalFormResult, FormData>(
    saveChapterGoalAction.bind(null, projectId),
    { ok: true },
  );
  const goalByChapter = new Map(chapterGoals.flatMap((g) => (g.recordId ? [[g.recordId, g] as const] : [])));

  return (
    <div className="stack">
      <form onSubmit={submitWithoutReset(saveProject)} className="stack panel">
        <h2 style={{ marginTop: 0 }}>{WRITING_GOALS.projectTarget}</h2>
        <div className="row">
          <label>
            {WRITING_GOALS.projectTarget}
            <input
              type="number"
              name="targetWords"
              min={1}
              defaultValue={projectGoal?.targetWords ?? ""}
              required
            />
          </label>
          <label>
            {WRITING_GOALS.projectDeadline}
            <input
              type="date"
              name="deadlineAt"
              defaultValue={projectGoal?.deadlineAt ? projectGoal.deadlineAt.toISOString().slice(0, 10) : ""}
            />
          </label>
        </div>
        <Result state={projectState} />
        <div className="row">
          <Button type="submit" disabled={projectPending}>
            {WRITING_GOALS.saveProject}
          </Button>
          {projectGoal ? (
            <Button
              type="button"
              variant="secondary"
              disabled={projectPending}
              onClick={() => void clearProjectGoalAction(projectId).then(() => window.location.reload())}
            >
              {WRITING_GOALS.clearProject}
            </Button>
          ) : null}
        </div>
      </form>

      <section className="panel stack">
        <h2 style={{ marginTop: 0 }}>{WRITING_GOALS.chapterTargets}</h2>
        {chapters.length === 0 ? <p className="muted">{WRITING_GOALS.noChapterGoals}</p> : null}
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {chapters.map((chapter) => {
            const existing = goalByChapter.get(chapter.id);
            return (
              <li key={chapter.id}>
                <form onSubmit={submitWithoutReset(saveChapter)} className="row" style={{ alignItems: "flex-end" }}>
                  <input type="hidden" name="recordId" value={chapter.id} />
                  <label style={{ flex: 1 }}>
                    {chapter.title}
                    <input
                      type="number"
                      name="targetWords"
                      min={1}
                      placeholder={WRITING_GOALS.chapterTarget}
                      defaultValue={existing?.targetWords ?? ""}
                    />
                  </label>
                  <Button type="submit" variant="secondary" disabled={chapterPending}>
                    {WRITING_GOALS.addChapter}
                  </Button>
                  {existing ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void clearChapterGoalAction(projectId, chapter.id).then(() => window.location.reload())}
                    >
                      {WRITING_GOALS.clearChapter}
                    </Button>
                  ) : null}
                </form>
              </li>
            );
          })}
        </ul>
        <Result state={chapterState} />
      </section>
    </div>
  );
}

function Result({ state }: { state: GoalFormResult }) {
  return (
    <>
      {state.message ? <Banner tone={state.ok ? "ok" : "error"}>{state.message}</Banner> : null}
      <IssueList issues={state.issues ?? []} />
    </>
  );
}