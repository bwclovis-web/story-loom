import { notFound } from "next/navigation";
import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { HelpHint } from "@/components/HelpHint";
import { WritingProgressStrip } from "@/components/writing/WritingProgressStrip";
import { WritingSessionInit } from "@/components/writing/WritingSessionInit";
import { getDb } from "@/server/db";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { findProject } from "@/server/services/projectService";
import { listRecordNav } from "@/server/services/recordService";
import { getProjectWritingGoal, listChapterWritingGoals } from "@/server/services/writingGoalService";
import { buildWritingPace } from "@/server/services/writingPaceService";
import { buildWritingProgress } from "@/server/services/writingProgressService";
import { SHELL, WRITING_GOALS } from "@/ui/labels";
import { cookies } from "next/headers";
import { WritingGoalsForm } from "./WritingGoalsForm";

export const dynamic = "force-dynamic";

const SESSION_COOKIE = "wordly-writing-session";

export default async function WritingGoalsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();
  const drafts = await listManuscriptDrafts(db, projectId);
  const draftId = resolveWriteDraftId(drafts, await readWriteDraftCookie());
  const hasDrafts = drafts.length > 0;
  const cookieStore = await cookies();
  const sessionRaw = cookieStore.get(SESSION_COOKIE)?.value;
  const sessionSince = sessionRaw ? new Date(decodeURIComponent(sessionRaw)) : null;
  const [projectGoal, chapterGoals, nav, progress] = await Promise.all([
    getProjectWritingGoal(db, projectId),
    listChapterWritingGoals(db, projectId),
    listRecordNav(db, projectId, { hasDrafts, draftId }),
    buildWritingProgress(db, { projectId, hasDrafts, draftId, sessionSince: sessionSince && !Number.isNaN(sessionSince.getTime()) ? sessionSince : null }),
  ]);
  const pace = await buildWritingPace(db, {
    projectId,
    hasDrafts,
    draftId,
    bookWords: progress.bookWords,
    projectTarget: progress.projectTarget,
    projectDeadline: progress.projectDeadline,
  });
  const chapters = nav
    .filter((row) => row.type === "manuscript_chapter")
    .map((row) => ({ id: row.id, title: row.title }));

  return (
    <>
      <WritingSessionInit />
      <ProjectPageHeader
        projectId={projectId}
        title={WRITING_GOALS.heading}
        description={WRITING_GOALS.lead}
        crumbs={[
          { href: `/projects/${encodeURIComponent(projectId)}/write`, label: SHELL.write },
          { label: WRITING_GOALS.heading, current: true },
        ]}
      />
      <HelpHint anchor="writing-goals" topic="writing goals">
        {WRITING_GOALS.lead}
      </HelpHint>
      <WritingProgressStrip projectId={projectId} progress={progress} />
      <section className="panel" aria-labelledby="pace-heading">
        <h2 id="pace-heading" style={{ marginTop: 0 }}>
          {WRITING_GOALS.dailyPace}
        </h2>
        <p>{pace.dailyTarget == null ? WRITING_GOALS.paceNone : WRITING_GOALS.dailyPaceValue(pace.dailyTarget)}</p>
        <p>
          {WRITING_GOALS.streak}: {WRITING_GOALS.streakDays(pace.streak)}
        </p>
        <h3>{WRITING_GOALS.chartHeading}</h3>
        <div className="pace-chart" aria-label={WRITING_GOALS.chartHeading}>
          {pace.days.map((day) => {
            const max = Math.max(...pace.days.map((item) => item.words), 1);
            return (
              <div key={day.iso} className="pace-chart-col" title={`${day.iso}: ${day.words}`}>
                <div className="pace-chart-bar" style={{ height: `${Math.max(day.words ? 4 : 0, (day.words / max) * 100)}%` }} />
              </div>
            );
          })}
        </div>
      </section>
      <WritingGoalsForm
        projectId={projectId}
        projectGoal={projectGoal}
        chapterGoals={chapterGoals}
        chapters={chapters}
      />
    </>
  );
}