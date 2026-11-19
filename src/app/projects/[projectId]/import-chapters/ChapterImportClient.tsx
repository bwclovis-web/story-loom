"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ProtectionBadge } from "@/components/Badges";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import type {
  ChapterDecision,
  ChapterFile,
  ChapterFilePreview,
  ChapterImportItem,
  ChapterImportOutcome,
} from "@/server/services/chapterImportService";
import { CHAPTER_IMPORT } from "@/ui/labels";
import { importChaptersAction, previewChaptersAction } from "./actions";

interface Choice {
  title: string;
  /** "" = undecided, "create", "skip", or "replace:<recordId>". */
  decision: string;
}

function toDecision(f: ChapterFilePreview, value: string): ChapterDecision | undefined {
  if (value === "create" || value === "skip") return { action: value };
  if (value.startsWith("replace:")) {
    const target = f.matches.find((m) => m.recordId === value.slice(8));
    if (target) return { action: "replace", recordId: target.recordId, expectedRevision: target.currentRevision };
  }
  return undefined;
}

export function ChapterImportClient({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<ChapterFile[]>([]);
  const [preview, setPreview] = useState<ChapterFilePreview[] | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [confirmProtected, setConfirmProtected] = useState(false);
  const [tidy, setTidy] = useState(true);
  const [outcome, setOutcome] = useState<ChapterImportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setPreview(null);
    setOutcome(null);
    setError(null);
    setConfirmProtected(false);
  };

  const loadPreview = (read: () => Promise<ChapterFile[]>, tidyText: boolean) => {
    reset();
    startTransition(async () => {
      try {
        const loaded = await read();
        const p = await previewChaptersAction(projectId, loaded, tidyText);
        setFiles(loaded);
        setPreview(p);
        setChoices(p.map((f) => ({ title: f.suggestedTitle, decision: f.matches.length ? "" : "create" })));
      } catch {
        setError("The files could not be read. Nothing was written.");
      }
    });
  };

  const onFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return reset();
    const picked = [...list];
    loadPreview(() => Promise.all(picked.map(async (f) => ({ filename: f.name, content: await f.text() }))), tidy);
  };

  /** Tidying can change which chapters a file matches, so the list is worked out again and choices start over. */
  const onTidy = (on: boolean) => {
    setTidy(on);
    if (files.length) loadPreview(async () => files, on);
  };

  const update = (i: number, patch: Partial<Choice>) => {
    setOutcome(null);
    setChoices((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  };

  const protectedReplacements =
    preview?.filter((f, i) => {
      const d = choices[i]?.decision ?? "";
      return d.startsWith("replace:") && f.matches.find((m) => m.recordId === d.slice(8))?.protected;
    }).length ?? 0;

  const incomplete = choices.some((c) => !c.decision || (c.decision === "create" && !c.title.trim()));
  const importing = choices.filter((c) => c.decision && c.decision !== "skip").length;

  const runImport = () =>
    startTransition(async () => {
      if (!preview) return;
      const items: ChapterImportItem[] = preview.map((f, i) => ({
        ...files[f.index],
        title: choices[i].title,
        decision: toDecision(f, choices[i].decision),
      }));
      setOutcome(await importChaptersAction(projectId, items, confirmProtected, tidy));
    });

  const rejected = outcome?.status === "rejected" ? outcome.issues : [];
  /** Items are sent in the preview's order, so issue indexes are preview positions. */
  const fileIssues = (i: number) => rejected.filter((x) => x.operationIndex === i);
  const batchIssues = rejected.filter((x) => x.operationIndex === undefined);

  if (outcome?.status === "applied") {
    return (
      <div className="stack">
        <Banner tone="ok">{CHAPTER_IMPORT.done}</Banner>
        <table>
          <thead>
            <tr>
              <th>File</th>
              <th>Result</th>
              <th>Chapter</th>
            </tr>
          </thead>
          <tbody>
            {outcome.results.map((r) => (
              <tr key={r.filename}>
                <td>{r.filename}</td>
                <td>
                  {r.action}
                  {r.revision ? ` (rev ${r.revision})` : ""}
                </td>
                <td>{r.recordId ? <Link href={`/projects/${projectId}/records/${r.recordId}`}>{r.title}</Link> : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          <Button onClick={() => { reset(); setFiles([]); }} variant="secondary">
            {CHAPTER_IMPORT.importMore}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="panel stack">
        <div className="row">
          <input
            type="file"
            multiple
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            onChange={(e) => onFiles(e.target.files)}
            aria-label={CHAPTER_IMPORT.filesLabel}
          />
          {pending ? <span className="small muted">Working...</span> : null}
        </div>
        <label className="inline">
          <input type="checkbox" checked={tidy} disabled={pending} onChange={(e) => onTidy(e.target.checked)} />
          {CHAPTER_IMPORT.tidy}
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          {CHAPTER_IMPORT.tidyHint}
        </p>
      </div>
      {error ? <Banner tone="error">{error}</Banner> : null}

      {preview ? (
        <>
          <ol className="chapter-import-list">
            {preview.map((f, i) => {
              const choice = choices[i];
              const replacing = choice?.decision.startsWith("replace:");
              const pos = choices.slice(0, i + 1).filter((c) => c.decision === "create").length;
              return (
                <li key={f.index} className="panel stack" style={fileIssues(i).some((x) => x.severity === "error") ? { borderColor: "var(--danger)" } : undefined}>
                  <div className="row">
                    <strong>{f.filename}</strong>
                    <span className="small muted">
                      {CHAPTER_IMPORT.order}: {f.number ?? CHAPTER_IMPORT.noNumber} · {CHAPTER_IMPORT.words(f.words.toLocaleString("en-US"))}
                      {choice?.decision === "create" ? ` · new chapter ${pos} of this import` : ""}
                    </span>
                  </div>
                  <IssueList issues={f.issues} />
                  {f.sameInBatch.length ? (
                    <Banner tone="warn" className="small">
                      {CHAPTER_IMPORT.sameInBatch(f.sameInBatch.join(", "))}
                    </Banner>
                  ) : null}
                  {f.matches.length ? (
                    <div className="small">
                      <strong>{CHAPTER_IMPORT.matches}</strong>
                      <ul>
                        {f.matches.map((m) => (
                          <li key={m.recordId}>
                            <Link href={`/projects/${projectId}/records/${m.recordId}`} target="_blank">
                              {m.title}
                            </Link>{" "}
                            <ProtectionBadge isProtected={m.protected} /> rev {m.currentRevision} (
                            {m.reasons.map((r) => CHAPTER_IMPORT.reasons[r]).join(", ")})
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="row">
                    <select value={choice?.decision ?? ""} onChange={(e) => update(i, { decision: e.target.value })} aria-label={`Action for ${f.filename}`}>
                      {f.matches.length ? <option value="">{CHAPTER_IMPORT.choose}</option> : null}
                      <option value="create">{CHAPTER_IMPORT.createNew}</option>
                      {f.matches.map((m) => (
                        <option key={m.recordId} value={`replace:${m.recordId}`}>
                          {CHAPTER_IMPORT.replacePrefix} &ldquo;{m.title}&rdquo; (rev {m.currentRevision})
                        </option>
                      ))}
                      <option value="skip">{CHAPTER_IMPORT.skip}</option>
                    </select>
                    {choice?.decision === "create" ? (
                      <label className="inline">
                        {CHAPTER_IMPORT.titleLabel}
                        <input
                          type="text"
                          value={choice.title}
                          onChange={(e) => update(i, { title: e.target.value })}
                          style={{ minWidth: "min(20rem, 100%)" }}
                          spellCheck
                        />
                      </label>
                    ) : null}
                  </div>
                  {replacing ? <p className="small muted">{CHAPTER_IMPORT.replaceKeepsTitle}</p> : null}
                  <details>
                    <summary className="small">{tidy ? CHAPTER_IMPORT.previewTidied : CHAPTER_IMPORT.previewText}</summary>
                    <pre className="mono small" style={{ whiteSpace: "pre-wrap" }}>
                      {f.excerpt}
                      {f.excerptTruncated ? "\n..." : ""}
                    </pre>
                  </details>
                  <IssueList issues={fileIssues(i)} />
                </li>
              );
            })}
          </ol>

          <div className="panel stack">
            {outcome?.status === "rejected" ? (
              <>
                <Banner tone="error">{CHAPTER_IMPORT.rejected}</Banner>
                <IssueList issues={batchIssues} />
              </>
            ) : null}
            {protectedReplacements > 0 ? (
              <label className="inline">
                <input type="checkbox" checked={confirmProtected} onChange={(e) => setConfirmProtected(e.target.checked)} />
                {CHAPTER_IMPORT.confirmProtected(protectedReplacements)}
              </label>
            ) : null}
            <div className="row">
              <Button onClick={runImport} disabled={pending || incomplete || importing === 0}>
                {CHAPTER_IMPORT.importFiles(importing)}
              </Button>
              {incomplete ? <span className="small muted">{CHAPTER_IMPORT.incomplete}</span> : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
