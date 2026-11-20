"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ANALYSIS_KINDS, type AnalysisKind } from "@/analyze/chapterAnalysisOutput";
import { CATEGORY_BOUNDARY } from "@/analyze/chapterAnalysisReview";
import { Button } from "@/components/ui/Button";
import { ANALYZE } from "@/ui/labels";
import { previewChapterAnalysisAction } from "./actions";

export interface AnalyzeChapterChoice {
  id: string;
  title: string;
  currentRevision: number;
  revisions: number[];
}

type Preview = Extract<Awaited<ReturnType<typeof previewChapterAnalysisAction>>, { ok: true }>["preview"];

export function AnalyzeChapterForm({
  projectId,
  chapters,
  assistantConfigured,
  initialChapterId,
  initialRevision,
}: {
  projectId: string;
  chapters: AnalyzeChapterChoice[];
  assistantConfigured: boolean;
  initialChapterId?: string;
  initialRevision?: number;
}) {
  const router = useRouter();
  const storageKey = `storyloom.analyze.categories.${projectId}`;
  const [chapterId, setChapterId] = useState(chapters.find((item) => item.id === initialChapterId)?.id ?? chapters[0]?.id ?? "");
  const chapter = useMemo(() => chapters.find((item) => item.id === chapterId) ?? chapters[0], [chapters, chapterId]);
  const [revision, setRevision] = useState(initialRevision ?? chapter?.currentRevision ?? 1);
  const [categories, setCategories] = useState<AnalysisKind[]>([...ANALYSIS_KINDS]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const allowed = new Set<string>(ANALYSIS_KINDS);
      const picked = parsed.filter((item): item is AnalysisKind => typeof item === "string" && allowed.has(item));
      if (picked.length) setCategories(picked);
    } catch {
      // keep every category
    }
  }, [storageKey]);

  const fingerprint = `${chapter?.id ?? ""}|${revision}|${categories.join(",")}`;
  const current = preview && previewKey === fingerprint ? preview : null;

  const chooseChapter = (id: string) => {
    setChapterId(id);
    const next = chapters.find((item) => item.id === id);
    if (next) setRevision(next.currentRevision);
    setPreview(null);
  };

  const toggle = (kind: AnalysisKind) => {
    setCategories((currentCategories) => {
      const next = currentCategories.includes(kind)
        ? currentCategories.filter((item) => item !== kind)
        : [...ANALYSIS_KINDS.filter((item) => currentCategories.includes(item) || item === kind)];
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
    setPreview(null);
  };

  const show = async () => {
    setMessage("");
    if (!chapter || categories.length === 0) {
      setMessage("Choose at least one category.");
      return;
    }
    setBusy("preview");
    const result = await previewChapterAnalysisAction(projectId, {
      chapterRecordId: chapter.id,
      pinnedRevision: revision,
      categories,
    });
    setBusy(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setPreview(result.preview);
    setPreviewKey(fingerprint);
  };

  const send = async () => {
    if (!current || current.problem || !assistantConfigured) return;
    setMessage("");
    setBusy("send");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterRecordId: current.chapterRecordId,
          pinnedRevision: current.pinnedRevision,
          categories: current.categories,
          sourceHash: current.sourceHash,
        }),
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
      setBusy(null);
    }
  };

  if (!chapter) return null;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void show();
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
            onChange={(event) => {
              setRevision(Number(event.target.value));
              setPreview(null);
            }}
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
      <fieldset>
        <legend>{ANALYZE.categories}</legend>
        {ANALYSIS_KINDS.map((kind) => (
          <p key={kind}>
            <label>
              <input type="checkbox" checked={categories.includes(kind)} onChange={() => toggle(kind)} /> {ANALYZE.kind[kind]}
            </label>
            <br />
            <span>{CATEGORY_BOUNDARY[kind]}</span>
          </p>
        ))}
      </fieldset>
      <Button type="submit" disabled={busy !== null}>
        {busy === "preview" ? ANALYZE.showing : ANALYZE.showRequest}
      </Button>
      {current ? (
        <section>
          <h2>What will be sent</h2>
          <p>
            {current.projectTitle} · {current.draftLabel} ({current.draftKind === "zero_draft" ? "Zero draft" : current.draftKind}) ·{" "}
            {current.chapterTitle} · revision {current.pinnedRevision}
          </p>
          <p>
            {ANALYZE.model}: {current.model ?? "not configured"}
          </p>
          <p>
            {ANALYZE.categories}: {current.categories.map((kind) => ANALYZE.kind[kind]).join(", ")}
          </p>
          <p>
            {ANALYZE.requestChars}: {current.inputChars.toLocaleString("en-US")} (instructions, the user message of{" "}
            {current.userChars.toLocaleString("en-US")} characters, and the schema allowance). {ANALYZE.estimatedTokens}:{" "}
            {current.estimatedInputTokens.toLocaleString("en-US")}. {ANALYZE.estimateNote}
          </p>
          <p>
            {ANALYZE.outputAllowance}: {current.outputTokenAllowance.toLocaleString("en-US")} tokens. {ANALYZE.remaining}:{" "}
            {current.requestsLastHour.toLocaleString("en-US")} of {current.maxRequestsPerHour.toLocaleString("en-US")} requests this hour,{" "}
            {current.monthTokens.toLocaleString("en-US")} of {current.monthlyTokenCap.toLocaleString("en-US")} tokens this month.
          </p>
          {current.problem ? <p role="status">{current.problem}</p> : null}
          {current.catalogs.map((section) => (
            <details key={section.heading}>
              <summary>
                {section.heading}: {section.count}
              </summary>
              <pre style={{ whiteSpace: "pre-wrap" }}>{section.text || ANALYZE.none}</pre>
            </details>
          ))}
          <details>
            <summary>{ANALYZE.instructions}</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{current.instructions}</pre>
          </details>
          <details>
            <summary>{ANALYZE.sent}</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{current.userText}</pre>
          </details>
          <Button type="button" disabled={busy !== null || Boolean(current.problem) || !current.configured} onClick={() => void send()}>
            {busy === "send" ? ANALYZE.sending : ANALYZE.send}
          </Button>
        </section>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
