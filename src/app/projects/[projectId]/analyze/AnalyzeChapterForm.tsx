"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ANALYZE } from "@/ui/labels";

export interface AnalyzeChapterChoice {
  id: string;
  title: string;
  currentRevision: number;
  revisions: number[];
}

export function AnalyzeChapterForm({
  projectId,
  chapters,
  assistantConfigured,
  limits,
}: {
  projectId: string;
  chapters: AnalyzeChapterChoice[];
  assistantConfigured: boolean;
  limits: { maxInputChars: number; maxRequestsPerHour: number; monthlyTokenCap: number };
}) {
  const router = useRouter();
  const [chapterId, setChapterId] = useState(chapters[0]?.id ?? "");
  const chapter = useMemo(() => chapters.find((item) => item.id === chapterId) ?? chapters[0], [chapters, chapterId]);
  const [revision, setRevision] = useState(chapter?.currentRevision ?? 1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const chooseChapter = (id: string) => {
    setChapterId(id);
    const next = chapters.find((item) => item.id === id);
    if (next) setRevision(next.currentRevision);
  };

  const analyze = async () => {
    setMessage("");
    if (!assistantConfigured) {
      setMessage("The assistant is not set up, so nothing was sent. See How to use, Assistant setup.");
      return;
    }
    if (!chapter) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapterRecordId: chapter.id, pinnedRevision: revision }),
      });
      const text = await res.text();
      if (!res.ok) {
        const payload = JSON.parse(text) as { error?: { message?: string } };
        setMessage(payload.error?.message ?? "The chapter was not analyzed.");
        return;
      }
      const lines = text.trim().split("\n").filter(Boolean);
      const last = JSON.parse(lines[lines.length - 1] ?? "{}") as { type?: string; result?: { id: string }; message?: string };
      if (last.type === "done" && last.result?.id) {
        router.push(`/projects/${encodeURIComponent(projectId)}/analyze/${encodeURIComponent(last.result.id)}`);
        return;
      }
      setMessage(last.message ?? "The analysis did not finish.");
    } catch {
      setMessage("The analysis could not be reached.");
    } finally {
      setBusy(false);
    }
  };

  if (!chapter) return null;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void analyze();
      }}
    >
      <p>
        <label htmlFor="analyze-chapter">
          {ANALYZE.chooseChapter}
          <select id="analyze-chapter" value={chapter.id} onChange={(event) => chooseChapter(event.target.value)}>
            {chapters.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label htmlFor="analyze-revision">
          {ANALYZE.pinRevision}
          <select
            id="analyze-revision"
            value={revision}
            onChange={(event) => setRevision(Number(event.target.value))}
          >
            {chapter.revisions.map((number) => (
              <option key={number} value={number}>
                {number}
                {number === chapter.currentRevision ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        The request stays inside {limits.maxInputChars.toLocaleString("en-US")} characters,{" "}
        {limits.maxRequestsPerHour.toLocaleString("en-US")} requests an hour, and{" "}
        {limits.monthlyTokenCap.toLocaleString("en-US")} tokens this month. Those limits are shared with discussion and
        proofreading.
      </p>
      <Button type="submit" disabled={busy}>
        {busy ? ANALYZE.analyzing : ANALYZE.analyze}
      </Button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
