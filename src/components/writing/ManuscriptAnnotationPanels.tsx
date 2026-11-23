"use client";

import { useRouter } from "next/navigation";
import { useState, type RefObject } from "react";
import { Button } from "@/components/ui/Atoms/Button";
import type { MarginCommentView } from "@/server/services/manuscriptAnnotationService";
import {
  addMarginCommentAction,
  clearSynopsisAction,
  removeMarginCommentAction,
  resolveMarginCommentAction,
  saveSynopsisAction,
} from "@/app/projects/[projectId]/records/[recordId]/annotationActions";
import { MANUSCRIPT_ANNOTATIONS } from "@/ui/labels";
import { selectRange } from "@/components/writing/textareaEdit";

export function ManuscriptSynopsisPanel({
  projectId,
  recordId,
  initialBody,
}: {
  projectId: string;
  recordId: string;
  initialBody: string;
}) {
  const [body, setBody] = useState(initialBody);
  const [pending, setPending] = useState(false);
  const dirty = body !== initialBody;

  const save = async () => {
    setPending(true);
    try {
      await saveSynopsisAction(projectId, recordId, body);
    } finally {
      setPending(false);
    }
  };

  const clear = async () => {
    setPending(true);
    try {
      await clearSynopsisAction(projectId, recordId);
      setBody("");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="panel manuscript-synopsis" aria-labelledby={`synopsis-${recordId}`}>
      <h2 id={`synopsis-${recordId}`}>{MANUSCRIPT_ANNOTATIONS.synopsis}</h2>
      <p className="small muted">{MANUSCRIPT_ANNOTATIONS.synopsisLead}</p>
      <textarea
        className="manuscript-synopsis-field"
        rows={4}
        value={body}
        placeholder={MANUSCRIPT_ANNOTATIONS.synopsisPlaceholder}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <Button type="button" size="sm" disabled={pending || !dirty} onClick={() => void save()}>
          {MANUSCRIPT_ANNOTATIONS.saveSynopsis}
        </Button>
        {initialBody.trim() ? (
          <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => void clear()}>
            {MANUSCRIPT_ANNOTATIONS.clearSynopsis}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export function MarginCommentsPanel({
  projectId,
  recordId,
  revision,
  dirty,
  textareaRef,
  initialComments,
}: {
  projectId: string;
  recordId: string;
  revision: number;
  dirty: boolean;
  textareaRef: RefObject<import("@/components/writing/EditorSurface").EditorSurface | HTMLTextAreaElement | null>;
  initialComments: MarginCommentView[];
}) {
  const router = useRouter();
  const [comments, setComments] = useState(initialComments);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [showResolved, setShowResolved] = useState(false);

  const pin = async () => {
    const ta = textareaRef.current;
    if (!ta || dirty) return;
    if (ta.selectionStart === ta.selectionEnd) return;
    setPending(true);
    try {
      await addMarginCommentAction(projectId, recordId, {
        passageStart: ta.selectionStart,
        passageEnd: ta.selectionEnd,
        expectedRevision: revision,
        body: note,
      });
      setNote("");
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const jump = (start: number, end: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    selectRange(ta, start, end);
    ta.focus();
  };

  const resolve = async (id: string) => {
    setPending(true);
    try {
      await resolveMarginCommentAction(projectId, recordId, id);
      setComments((list) => list.filter((c) => c.id !== id));
    } finally {
      setPending(false);
    }
  };

  const remove = async (id: string) => {
    setPending(true);
    try {
      await removeMarginCommentAction(projectId, recordId, id);
      setComments((list) => list.filter((c) => c.id !== id));
    } finally {
      setPending(false);
    }
  };

  const open = comments.filter((c) => !c.resolvedAt);

  return (
    <section className="panel manuscript-comments" aria-labelledby={`comments-${recordId}`}>
      <h2 id={`comments-${recordId}`}>{MANUSCRIPT_ANNOTATIONS.marginComments}</h2>
      <p className="small muted">{MANUSCRIPT_ANNOTATIONS.marginLead}</p>
      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="stack" style={{ flex: "1 1 12rem", minWidth: 0 }}>
          <span className="small">{MANUSCRIPT_ANNOTATIONS.commentNote}</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} disabled={pending} />
        </label>
        <Button type="button" size="sm" disabled={pending || dirty} onClick={() => void pin()}>
          {dirty ? MANUSCRIPT_ANNOTATIONS.pinRequiresSave : MANUSCRIPT_ANNOTATIONS.pinSelection}
        </Button>
      </div>
      {open.length === 0 ? <p className="small muted">{MANUSCRIPT_ANNOTATIONS.noComments}</p> : null}
      <ul className="manuscript-comment-list">
        {open.map((c) => (
          <li key={c.id} className={`manuscript-comment${c.needsRecheck ? " manuscript-comment--stale" : ""}`}>
            {c.needsRecheck ? <p className="small manuscript-comment-stale">{MANUSCRIPT_ANNOTATIONS.needsRecheck}</p> : null}
            <button type="button" className="manuscript-comment-excerpt" onClick={() => jump(c.passageStart, c.passageEnd)}>
              {c.passageExcerpt.trim() || `… (${c.passageEnd - c.passageStart} characters)`}
            </button>
            {c.body ? <p className="small">{c.body}</p> : null}
            <p className="small muted">
              Rev {c.revisionNumber}
            </p>
            <div className="row" style={{ gap: "0.35rem" }}>
              <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => void resolve(c.id)}>
                {MANUSCRIPT_ANNOTATIONS.resolveComment}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => void remove(c.id)}>
                {MANUSCRIPT_ANNOTATIONS.removeComment}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {showResolved ? null : (
        <p className="small">
          <button type="button" className="linkish" onClick={() => setShowResolved(true)}>
            {MANUSCRIPT_ANNOTATIONS.showResolved}
          </button>
        </p>
      )}
    </section>
  );
}