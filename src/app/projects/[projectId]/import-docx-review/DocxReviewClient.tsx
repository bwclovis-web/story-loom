"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { FileInput } from "@/components/ui/FileInput";
import type { DiffPart } from "@/changePackage/diff";
import type { DocxReviewOutcome, DocxReviewPreview } from "@/server/services/docxReviewService";
import { DOCX_REVIEW } from "@/ui/labels";
import { applyDocxReviewAction, previewDocxReviewAction } from "./actions";

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function DiffView({ parts }: { parts: DiffPart[] }) {
  return (
    <pre className="mono small" style={{ whiteSpace: "pre-wrap" }}>
      {parts.map((p, i) => {
        if (p.added)
          return (
            <ins key={i} style={{ background: "color-mix(in srgb, var(--color-ok) 25%, transparent)" }}>
              {p.value}
            </ins>
          );
        if (p.removed)
          return (
            <del key={i} style={{ background: "color-mix(in srgb, var(--color-danger) 25%, transparent)" }}>
              {p.value}
            </del>
          );
        return <span key={i}>{p.value}</span>;
      })}
    </pre>
  );
}

export function DocxReviewClient({ projectId }: { projectId: string }) {
  const [filename, setFilename] = useState("");
  const [base64, setBase64] = useState("");
  const [preview, setPreview] = useState<DocxReviewPreview | null>(null);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [importComments, setImportComments] = useState(true);
  const [confirmProtected, setConfirmProtected] = useState(false);
  const [outcome, setOutcome] = useState<DocxReviewOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onFile = (list: FileList | null) => {
    setPreview(null);
    setOutcome(null);
    setError(null);
    setConfirmProtected(false);
    if (!list?.[0]) return;
    const file = list[0];
    startTransition(async () => {
      try {
        const b64 = await fileToBase64(file);
        setFilename(file.name);
        setBase64(b64);
        const p = await previewDocxReviewAction(projectId, file.name, b64);
        setPreview(p);
        const next: Record<number, boolean> = {};
        for (const c of p.chapters) next[c.index] = c.selected;
        setSelected(next);
        if (p.issues.length) setError(p.issues[0]?.message ?? DOCX_REVIEW.readError);
      } catch {
        setError(DOCX_REVIEW.readError);
      }
    });
  };

  const acceptIndexes = Object.entries(selected)
    .filter(([, on]) => on)
    .map(([k]) => Number(k));

  const protectedSelected =
    preview?.chapters.filter((c) => selected[c.index] && c.protected && c.hasBodyChange).length ?? 0;

  const run = () =>
    startTransition(async () => {
      const result = await applyDocxReviewAction(projectId, {
        filename,
        base64,
        acceptIndexes,
        importComments,
        confirmProtected,
      });
      setOutcome(result);
      if (result.status === "rejected") setError(result.issues[0]?.message ?? DOCX_REVIEW.rejected);
    });

  if (outcome?.status === "applied") {
    return (
      <div className="stack">
        <Banner tone="ok">{DOCX_REVIEW.done}</Banner>
        <ul>
          {outcome.updated.map((u) => (
            <li key={u.recordId}>
              <Link href={`/projects/${projectId}/records/${u.recordId}`}>{u.title}</Link> — rev {u.revision}
              {u.commentsAdded ? ` · ${DOCX_REVIEW.commentsAdded(u.commentsAdded)}` : ""}
            </li>
          ))}
        </ul>
        <Button
          variant="secondary"
          onClick={() => {
            setOutcome(null);
            setPreview(null);
          }}
        >
          {DOCX_REVIEW.reviewMore}
        </Button>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="panel stack">
        <FileInput accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => onFile(e.target.files)} aria-label={DOCX_REVIEW.filesLabel} disabled={pending} />
        <p className="small muted" style={{ margin: 0 }}>
          {DOCX_REVIEW.hint}
        </p>
        {pending ? <span className="small muted">Working...</span> : null}
      </div>
      {error ? <Banner tone="error">{error}</Banner> : null}

      {preview ? (
        <>
          {preview.hasTrackedChanges ? <Banner tone="warn">{DOCX_REVIEW.trackedHint}</Banner> : null}
          <ol className="chapter-import-list">
            {preview.chapters.map((c) => (
              <li key={c.index} className="panel stack">
                <div className="row">
                  <Checkbox
                    checked={Boolean(selected[c.index])}
                    disabled={!c.recordId || (!c.hasBodyChange && !(importComments && c.comments.length))}
                    onChange={(e) => setSelected((s) => ({ ...s, [c.index]: e.target.checked }))}
                    label={<strong>{c.title}</strong>}
                  />
                  <span className="small muted">
                    {c.recordId
                      ? DOCX_REVIEW.matched(c.recordTitle ?? c.title, c.matchReason)
                      : DOCX_REVIEW.unmatched}
                  </span>
                </div>
                {c.hasBodyChange ? (
                  <details open>
                    <summary className="small">{DOCX_REVIEW.diffHeading}</summary>
                    <DiffView parts={c.bodyDiff} />
                  </details>
                ) : (
                  <p className="small muted">{DOCX_REVIEW.noChange}</p>
                )}
                {c.comments.length ? (
                  <div className="small">
                    <strong>{DOCX_REVIEW.commentsHeading}</strong>
                    <ul>
                      {c.comments.map((cm) => (
                        <li key={cm.id}>
                          {cm.author}: {cm.body}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          {preview.unmatchedComments.length ? (
            <Banner tone="warn">
              {DOCX_REVIEW.unmatchedComments(preview.unmatchedComments.length)}
            </Banner>
          ) : null}
          <div className="panel stack">
            <Checkbox checked={importComments} onChange={(e) => setImportComments(e.target.checked)} label={DOCX_REVIEW.importComments} />
            {protectedSelected > 0 ? (
              <Checkbox
                checked={confirmProtected}
                onChange={(e) => setConfirmProtected(e.target.checked)}
                label={DOCX_REVIEW.confirmProtected(protectedSelected)}
              />
            ) : null}
            <IssueList issues={outcome?.status === "rejected" ? outcome.issues : []} />
            <Button onClick={run} disabled={pending || acceptIndexes.length === 0}>
              {DOCX_REVIEW.apply(acceptIndexes.length)}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
