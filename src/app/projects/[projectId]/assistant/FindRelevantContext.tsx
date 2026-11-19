"use client";

import { useState, useTransition } from "react";
import type { FindContextCandidate, FindRelevantContextResult } from "@/server/services/findRelevantContextService";
import { ASSISTANT } from "@/ui/labels";
import { findRelevantContextAction } from "./actions";
import { Button } from "@/components/ui/Button";

export interface FindSelectionApply {
  selectedRefs: string[];
  sectionPicks: Record<string, string[]>;
}

const LABEL_TEXT: Record<string, string> = {
  unsaved: ASSISTANT.labelUnsaved,
  zero_draft: ASSISTANT.labelZeroDraft,
  linked: ASSISTANT.labelLinked,
  pinned: ASSISTANT.labelPinned,
  search: ASSISTANT.labelSearch,
  selection: ASSISTANT.labelSelection,
  open_scene: ASSISTANT.labelOpenScene,
};

/**
 * Discovers candidate context, previews exact passages/revisions, lets the author
 * remove/replace, then confirms into Include — never sends to the provider.
 */
export function FindRelevantContext({
  projectId,
  question,
  manuscript,
  draftScopeId,
  onApply,
  disabled,
}: {
  projectId: string;
  question: string;
  manuscript: {
    recordId: string;
    start?: number;
    end?: number;
    unsavedBody?: string | null;
  } | null;
  draftScopeId?: string | null;
  onApply: (selection: FindSelectionApply) => void;
  disabled?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [includeZero, setIncludeZero] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<FindRelevantContextResult["snapshot"] | null>(null);
  const [candidates, setCandidates] = useState<FindContextCandidate[]>([]);
  const [chosen, setChosen] = useState<FindContextCandidate[]>([]);
  const [replacingId, setReplacingId] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      const result = await findRelevantContextAction(projectId, {
        question,
        manuscript,
        draftScopeId,
        includePinnedZeroDraft: includeZero,
      });
      if (!result.ok) {
        setError(result.message);
        setCandidates([]);
        setChosen([]);
        setSnapshot(null);
        return;
      }
      setSnapshot(result.snapshot);
      setCandidates(result.candidates);
      setChosen(result.candidates);
      try {
        sessionStorage.setItem(
          `wordly.findContext.${projectId}`,
          JSON.stringify({ snapshot: result.snapshot, at: Date.now() }),
        );
      } catch {
        /* ignore quota */
      }
    });
  };

  const remove = (recordId: string) => {
    setChosen((list) => list.filter((c) => c.recordId !== recordId));
    setReplacingId(null);
  };

  const replaceWith = (fromId: string, next: FindContextCandidate) => {
    setChosen((list) => list.map((c) => (c.recordId === fromId ? next : c)));
    setReplacingId(null);
  };

  const confirm = () => {
    const selectedRefs: string[] = [];
    const sectionPicks: Record<string, string[]> = {};
    for (const c of chosen) {
      if (c.kind === "sections" && c.sectionIds?.length) {
        sectionPicks[c.recordId] = c.sectionIds;
      } else {
        selectedRefs.push(c.recordId);
      }
    }
    onApply({ selectedRefs, sectionPicks });
  };

  const pool = candidates.filter((c) => !chosen.some((x) => x.recordId === c.recordId));

  return (
    <section className="stack find-relevant" aria-label={ASSISTANT.findRelevantContext}>
      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <Button type="button" variant="secondary" size="sm" disabled={disabled || pending} onClick={run}>
          {pending ? ASSISTANT.findRelevantRunning : ASSISTANT.findRelevantContext}
        </Button>
        <label className="inline small">
          <input type="checkbox" checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} disabled={disabled || pending} />
          {ASSISTANT.includePinnedZeroDraft}
        </label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {ASSISTANT.findRelevantHint}
      </p>
      <p className="small muted" style={{ margin: 0 }}>
        {ASSISTANT.includePinnedZeroDraftHint}
      </p>
      {error ? <p className="error-text small">{error}</p> : null}

      {chosen.length || snapshot ? (
        <div className="stack find-relevant-preview">
          <h4 style={{ margin: 0 }}>{ASSISTANT.findRelevantPreview}</h4>
          {chosen.length === 0 ? (
            <p className="small muted">{ASSISTANT.findRelevantEmpty}</p>
          ) : (
            <ul className="context-list">
              {chosen.map((c) => (
                <li key={c.recordId}>
                  <span className="context-item-title">{c.title}</span>
                  <span className="small muted">
                    rev {c.revisionNumber}
                    {c.kind === "sections" ? " · sections" : ""}
                    {c.labels.map((l) => (
                      <span key={l} className="badge" style={{ marginLeft: "0.25rem" }}>
                        {LABEL_TEXT[l] ?? l}
                      </span>
                    ))}
                  </span>
                  <pre className="reference-text document small" style={{ whiteSpace: "pre-wrap", maxHeight: "8rem", overflow: "auto" }}>
                    {c.previewText.slice(0, 4000)}
                    {c.previewText.length > 4000 ? "…" : ""}
                  </pre>
                  <div className="row">
                    <Button type="button" variant="secondary" size="sm" onClick={() => remove(c.recordId)}>
                      {ASSISTANT.findRelevantRemove}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary" size="sm"
                      onClick={() => setReplacingId(replacingId === c.recordId ? null : c.recordId)}
                      disabled={!pool.length && replacingId !== c.recordId}
                    >
                      {ASSISTANT.findRelevantReplace}
                    </Button>
                  </div>
                  {replacingId === c.recordId ? (
                    <div className="stack">
                      <p className="small muted">{ASSISTANT.findRelevantReplacePick}</p>
                      <ul className="context-links">
                        {pool.map((alt) => (
                          <li key={alt.recordId}>
                            <button type="button" className="linkish small" onClick={() => replaceWith(c.recordId, alt)}>
                              {alt.title} (rev {alt.revisionNumber})
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Button type="button" size="sm" disabled={!chosen.length} onClick={confirm}>
            {ASSISTANT.findRelevantConfirm}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
