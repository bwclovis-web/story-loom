"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { FileInput } from "@/components/ui/FileInput";
import type { ChapterDecision, ChapterImportItem } from "@/server/services/chapterImportService";
import type { ImportDecision, MarkdownImportItem } from "@/server/services/markdownImportService";
import { CHAPTER_IMPORT, SCRIVENER_IMPORT } from "@/ui/labels";
import { applyScrivenerAction, previewScrivenerAction, type ScrivenerPreviewPayload } from "./actions";

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

export function ScrivenerImportClient({ projectId }: { projectId: string }) {
  const [preview, setPreview] = useState<ScrivenerPreviewPayload | null>(null);
  const [chapterChoices, setChapterChoices] = useState<string[]>([]);
  const [refChoices, setRefChoices] = useState<string[]>([]);
  const [confirmChapters, setConfirmChapters] = useState(false);
  const [confirmRefs, setConfirmRefs] = useState(false);
  const [tidy, setTidy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onFile = (list: FileList | null) => {
    setPreview(null);
    setDone(null);
    setError(null);
    setConfirmChapters(false);
    setConfirmRefs(false);
    if (!list?.[0]) return;
    const file = list[0];
    startTransition(async () => {
      try {
        const base64 = await fileToBase64(file);
        const p = await previewScrivenerAction(projectId, base64, tidy);
        setPreview(p);
        setChapterChoices(
          p.chapterPreview.map((f) => (f.matches.length ? "" : "create")),
        );
        setRefChoices(p.referencePreview?.files.map((f) => (f.needsDecision ? "" : "create")) ?? []);
        if (p.issues.length) setError(p.issues[0]?.message ?? SCRIVENER_IMPORT.readError);
      } catch {
        setError(SCRIVENER_IMPORT.readError);
      }
    });
  };

  const protectedChapterReplacements =
    preview?.chapterPreview.filter((f, i) => {
      const d = chapterChoices[i] ?? "";
      return d.startsWith("replace:") && f.matches.find((m) => m.recordId === d.slice(8))?.protected;
    }).length ?? 0;

  const run = () =>
    startTransition(async () => {
      if (!preview) return;
      const chapters: ChapterImportItem[] = preview.chapterPreview.map((f, i) => {
        const choice = chapterChoices[i] ?? "";
        let decision: ChapterDecision | undefined;
        if (choice === "create" || choice === "skip") decision = { action: choice };
        else if (choice.startsWith("replace:")) {
          const m = f.matches.find((x) => x.recordId === choice.slice(8));
          if (m) decision = { action: "replace", recordId: m.recordId, expectedRevision: m.currentRevision };
        }
        return {
          ...preview.chapters[f.index]!,
          title: f.suggestedTitle,
          decision,
        };
      });

      const references: MarkdownImportItem[] =
        preview.referencePreview?.files.map((f, i) => {
          const choice = refChoices[i] ?? "create";
          let decision: ImportDecision | undefined;
          if (choice === "create" || choice === "skip") decision = { action: choice };
          else if (choice.startsWith("replace:")) {
            const d = f.duplicates.find((x) => x.recordId === choice.slice(8));
            if (d) decision = { action: "replace", recordId: d.recordId, expectedRevision: d.currentRevision };
          }
          return {
            ...preview.references[f.index]!,
            title: f.suggestedTitle,
            type: "research_note",
            authorityStatus: "draft",
            protected: false,
            decision,
          };
        }) ?? [];

      const result = await applyScrivenerAction(projectId, {
        chapters,
        confirmProtectedChapters: confirmChapters,
        tidy,
        references,
        confirmProtectedReferences: confirmRefs,
      });
      if (result.issues.length) {
        setError(result.issues[0]?.message ?? SCRIVENER_IMPORT.rejected);
        return;
      }
      const created =
        (result.chapters?.status === "applied" ? result.chapters.results.filter((r) => r.action !== "skipped").length : 0) +
        (result.references?.status === "applied" ? result.references.results.filter((r) => r.action !== "skipped").length : 0);
      setDone(SCRIVENER_IMPORT.done(created));
    });

  const incomplete =
    chapterChoices.some((c) => !c) ||
    refChoices.some((c) => !c) ||
    ((preview?.chapterPreview.length ?? 0) === 0 && (preview?.references.length ?? 0) === 0);

  if (done) {
    return (
      <div className="stack">
        <Banner tone="ok">{done}</Banner>
        <Button
          variant="secondary"
          onClick={() => {
            setDone(null);
            setPreview(null);
          }}
        >
          {SCRIVENER_IMPORT.importMore}
        </Button>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="panel stack">
        <FileInput
          accept=".zip,application/zip"
          onChange={(e) => onFile(e.target.files)}
          aria-label={SCRIVENER_IMPORT.filesLabel}
          disabled={pending}
        />
        <label className="inline">
          <input type="checkbox" checked={tidy} disabled={pending} onChange={(e) => setTidy(e.target.checked)} />
          {CHAPTER_IMPORT.tidy}
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          {SCRIVENER_IMPORT.hint}
        </p>
        {pending ? <span className="small muted">Working...</span> : null}
      </div>
      {error ? <Banner tone="error">{error}</Banner> : null}

      {preview ? (
        <>
          {preview.projectTitle ? (
            <p className="small muted">
              {SCRIVENER_IMPORT.projectLabel}: {preview.projectTitle}
            </p>
          ) : null}

          {preview.unsupported.length ? (
            <div className="panel stack">
              <strong>{SCRIVENER_IMPORT.unsupportedHeading}</strong>
              <ul className="small">
                {preview.unsupported.map((u, i) => (
                  <li key={`${u.path}-${i}`}>
                    {u.title} — {u.reason}
                    {u.path !== u.title ? ` (${u.path})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.chapterPreview.length ? (
            <div className="stack">
              <h2 className="h3">{SCRIVENER_IMPORT.chaptersHeading}</h2>
              <ol className="chapter-import-list">
                {preview.chapterPreview.map((f, i) => (
                  <li key={f.index} className="panel stack">
                    <strong>{f.suggestedTitle}</strong>
                    <span className="small muted">{CHAPTER_IMPORT.words(f.words.toLocaleString("en-US"))}</span>
                    <IssueList issues={f.issues} />
                    <select
                      value={chapterChoices[i] ?? ""}
                      onChange={(e) => setChapterChoices((cs) => cs.map((c, j) => (j === i ? e.target.value : c)))}
                      aria-label={`Action for ${f.suggestedTitle}`}
                    >
                      {f.matches.length ? <option value="">{CHAPTER_IMPORT.choose}</option> : null}
                      <option value="create">{CHAPTER_IMPORT.createNew}</option>
                      {f.matches.map((m) => (
                        <option key={m.recordId} value={`replace:${m.recordId}`}>
                          {CHAPTER_IMPORT.replacePrefix} &ldquo;{m.title}&rdquo;
                        </option>
                      ))}
                      <option value="skip">{CHAPTER_IMPORT.skip}</option>
                    </select>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {preview.referencePreview?.files.length ? (
            <div className="stack">
              <h2 className="h3">{SCRIVENER_IMPORT.referencesHeading}</h2>
              <p className="small muted">{SCRIVENER_IMPORT.referencesHint}</p>
              <ol className="chapter-import-list">
                {preview.referencePreview.files.map((f, i) => (
                  <li key={f.index} className="panel stack">
                    <strong>{f.suggestedTitle}</strong>
                    <select
                      value={refChoices[i] ?? ""}
                      onChange={(e) => setRefChoices((cs) => cs.map((c, j) => (j === i ? e.target.value : c)))}
                      aria-label={`Action for reference ${f.suggestedTitle}`}
                    >
                      {f.needsDecision ? <option value="">{CHAPTER_IMPORT.choose}</option> : null}
                      <option value="create">{CHAPTER_IMPORT.createNew}</option>
                      {f.duplicates.map((d) => (
                        <option key={d.recordId} value={`replace:${d.recordId}`}>
                          {CHAPTER_IMPORT.replacePrefix} &ldquo;{d.title}&rdquo;
                        </option>
                      ))}
                      <option value="skip">{CHAPTER_IMPORT.skip}</option>
                    </select>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className="panel stack">
            {protectedChapterReplacements > 0 ? (
              <label className="inline">
                <input type="checkbox" checked={confirmChapters} onChange={(e) => setConfirmChapters(e.target.checked)} />
                {CHAPTER_IMPORT.confirmProtected(protectedChapterReplacements)}
              </label>
            ) : null}
            <div className="row">
              <Button onClick={run} disabled={pending || incomplete}>
                {SCRIVENER_IMPORT.importAction}
              </Button>
              <Link className="small" href={`/projects/${projectId}/import-chapters`}>
                {SCRIVENER_IMPORT.chaptersOnlyLink}
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
