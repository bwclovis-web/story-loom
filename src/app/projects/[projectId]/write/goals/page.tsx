import Link from "next/link";
import { notFound } from "next/navigation";
import { HelpHint } from "@/components/HelpHint";
import { WritingProgressStrip } from "@/components/writing/WritingProgressStrip";
import { WritingSessionInit } from "@/components/writing/WritingSessionInit";
import { getDb } from "@/server/db";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { findProject } from "@/server/services/projectService";
import { listRecordNav } from "@/server/services/recordService";
import { getProjectWritingGoal, listChapterWritingGoals } from "@/server/services/writingGoalService";
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
  const chapters = nav
    .filter((row) => row.type === "manuscript_chapter")
    .map((row) => ({ id: row.id, title: row.title }));

  return (
    <>
      <WritingSessionInit />
      <p className="small muted">
        <Link href={`/projects/${encodeURIComponent(projectId)}/write`}>{SHELL.write}</Link>
      </p>
      <h1>{WRITING_GOALS.heading}</h1>
      <p className="page-lead">{WRITING_GOALS.lead}</p>
      <HelpHint anchor="writing-goals" topic="writing goals">
        {WRITING_GOALS.lead}
      </HelpHint>
      <WritingProgressStrip projectId={projectId} progress={progress} />
      <WritingGoalsForm
        projectId={projectId}
        projectGoal={projectGoal}
        chapterGoals={chapterGoals}
        chapters={chapters}
      />
    </>
  );
}