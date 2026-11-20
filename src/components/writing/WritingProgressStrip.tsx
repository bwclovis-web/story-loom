import Link from "next/link";
import type { WritingProgressSnapshot } from "@/server/services/writingProgressService";
import { WRITING_GOALS } from "@/ui/labels";
import { formatWordCount } from "@/writing/wordCount";

export function WritingProgressStrip({
  projectId,
  progress,
  showChapter = false,
  compact = false,
}: {
  projectId: string;
  progress: WritingProgressSnapshot;
  showChapter?: boolean;
  compact?: boolean;
}) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const hasGoal = progress.projectTarget !== null || progress.chapterTarget !== null;
  if (!hasGoal && progress.wordsToday === 0 && progress.wordsSession === 0) return null;

  const bookPct =
    progress.projectTarget && progress.projectTarget > 0
      ? Math.min(100, Math.round((progress.bookWords / progress.projectTarget) * 100))
      : null;

  return (
    <section
      className={`panel writing-progress${compact ? " writing-progress--compact" : ""}`}
      aria-labelledby="writing-progress-heading"
    >
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
        <h2 id="writing-progress-heading" style={{ margin: 0, fontSize: "1rem" }}>
          {WRITING_GOALS.progressHeading}
        </h2>
        <Link href={`${base}/write/goals`} className="small">
          {WRITING_GOALS.editGoals}
        </Link>
      </div>
      <ul className="writing-progress-stats">
        <li>
          <span className="muted small">{WRITING_GOALS.today}</span> {formatWordCount(progress.wordsToday)}
        </li>
        <li>
          <span className="muted small">{WRITING_GOALS.session}</span> {formatWordCount(progress.wordsSession)}
        </li>
        <li>
          <span className="muted small">{WRITING_GOALS.book}</span>{" "}
          {progress.projectTarget
            ? WRITING_GOALS.ofTarget(progress.bookWords, progress.projectTarget)
            : formatWordCount(progress.bookWords)}
        </li>
        {showChapter && progress.chapterTarget && progress.chapterWords !== undefined ? (
          <li>
            <span className="muted small">{WRITING_GOALS.chapter}</span>{" "}
            {WRITING_GOALS.ofTarget(progress.chapterWords, progress.chapterTarget)}
          </li>
        ) : null}
      </ul>
      {bookPct !== null ? (
        <div className="writing-progress-bar" role="progressbar" aria-valuenow={bookPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="writing-progress-fill" style={{ width: `${bookPct}%` }} />
        </div>
      ) : null}
      {progress.projectDeadline ? (
        <p className="small muted">
          {WRITING_GOALS.deadlineBy(progress.projectDeadline.toLocaleDateString(undefined, { dateStyle: "medium" }))}
        </p>
      ) : null}
    </section>
  );
}
