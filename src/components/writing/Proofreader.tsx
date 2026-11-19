"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import { HelpHint } from "@/components/HelpHint";
import type { ProofreadSuggestion } from "@/proofread/anchors";
import {
  acceptEdit,
  locateSuggestion,
  mapText,
  nextOpen,
  undoEdit,
  type Decision,
  type LocatedSuggestion,
} from "@/proofread/apply";
import type { ProofreadResult } from "@/server/services/proofreadService";
import { PROOFREAD } from "@/ui/labels";
import { ProtectionTick } from "./ProtectionTick";
import { applyTextareaEdit, selectRange } from "./textareaEdit";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";

export interface ProofreadConfig {
  configured: boolean;
  maxInputChars: number;
  /** Characters every request adds: instructions, output format, labels. */
  fixedChars: number;
  /** Why the assistant/proofread connection is off; empty when configured. */
  problems?: string[];
}

interface ApiError {
  code: string;
  message: string;
  size?: { items: { label: string; chars: number }[] };
}

interface Run {
  /** The saved text that was proofread, as the text box showed it. */
  source: string;
  result: ProofreadResult;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const CONTEXT_SHOWN = 30;

function locateAll(run: Run, current: string, decisions: Record<string, Decision>): LocatedSuggestion[] {
  const map = mapText(run.source, current);
  return run.result.suggestions.map((s) => locateSuggestion(run.source, current, map, s, decisions[s.id]));
}

export function Proofreader({
  projectId,
  recordId,
  revision,
  savedText,
  text,
  selection,
  textareaRef,
  editable,
  onUnlock,
  config,
}: {
  projectId: string;
  recordId: string;
  revision: number;
  /** The saved text with line endings as "\n", as the text box shows it. */
  savedText: string;
  text: string;
  selection: { start: number; end: number };
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  editable: boolean;
  onUnlock: () => void;
  config: ProofreadConfig;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<{ runId: string | null } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const located = useMemo(() => (run ? locateAll(run, text, decisions) : []), [run, text, decisions]);
  const counts = useMemo(() => {
    const c = { open: 0, accepted: 0, dismissed: 0, stale: 0 };
    for (const l of located) c[l.status] += 1;
    return c;
  }, [located]);

  if (!config.configured) {
    return (
      <div className="proofread stack">
        <strong>{PROOFREAD.heading}</strong>
        <HelpHint anchor="proofreading" topic="AI proofreading">
          {PROOFREAD.notConfigured}
        </HelpHint>
      </div>
    );
  }

  const dirty = text !== savedText;
  const hasSelection = selection.end > selection.start;
  const selectionChars = selection.end - selection.start;
  const estimate = (chars: number) => chars + config.fixedChars;
  const selectionOver = hasSelection && estimate(selectionChars) > config.maxInputChars;
  const documentOver = estimate(savedText.length) > config.maxInputChars;

  const show = (i: number, list: LocatedSuggestion[] = located) => {
    setIndex(i);
    const r = list[i]?.range;
    const ta = textareaRef.current;
    if (ta && r) selectRange(ta, r.start, r.end);
  };

  async function start(range: { start: number; end: number } | null) {
    if (dirty) {
      setMessage(PROOFREAD.saveFirst);
      return;
    }
    setError(null);
    setMessage("");
    setBusy({ runId: null });
    const source = savedText;
    const controller = new AbortController();
    abortRef.current = controller;
    let response: Response;
    try {
      response = await fetch(`/api/projects/${projectId}/proofread`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "proofread", recordId, revision, range }),
        signal: controller.signal,
      });
    } catch {
      setBusy(null);
      if (!controller.signal.aborted) setError({ code: "NETWORK", message: "Could not reach the app server. Is it still running?" });
      return;
    }
    if (!response.ok || !response.body) {
      const json = (await response.json().catch(() => null)) as { error?: ApiError } | null;
      setBusy(null);
      setError(json?.error ?? { code: "HTTP", message: `The request failed (${response.status}).` });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finished = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type: string; runId?: string; result?: ProofreadResult; message?: string };
          if (event.type === "started") setBusy({ runId: event.runId ?? null });
          else if (event.type === "error") {
            finished = true;
            setError({ code: "STORAGE", message: event.message ?? "Proofreading failed." });
          } else if (event.type === "done" && event.result) {
            finished = true;
            const result = event.result;
            if (result.recordId !== recordId || result.revision !== revision) {
              setError({ code: "MISMATCH", message: "The result is for a different version of this record. Reload the page." });
              continue;
            }
            const next: Run = { source, result };
            setRun(next);
            setDecisions({});
            const list = locateAll(next, textareaRef.current?.value ?? source, {});
            setIndex(0);
            if (list.length) show(0, list);
          }
        }
      }
    } catch {
      // Aborted or connection lost; the server stores the outcome.
    }
    if (!finished) setError({ code: "CANCELLED", message: "Proofreading was cancelled or interrupted. No suggestions were made." });
    setBusy(null);
    abortRef.current = null;
  }

  const cancel = async () => {
    const id = busy?.runId;
    if (id) {
      await fetch(`/api/projects/${projectId}/proofread/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: id }),
      }).catch(() => abortRef.current?.abort());
    } else abortRef.current?.abort();
  };

  /** Re-locates against the text box itself, so an edit is never placed using an outdated position. */
  const freshLocate = (s: ProofreadSuggestion, ta: HTMLTextAreaElement) =>
    locateSuggestion(run!.source, ta.value, mapText(run!.source, ta.value), s, decisions[s.id]);

  const accept = (i: number) => {
    const ta = textareaRef.current;
    const s = run?.result.suggestions[i];
    if (!ta || !s) return;
    const result = acceptEdit(freshLocate(s, ta), s, editable);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    applyTextareaEdit(ta, result.edit);
    const nextDecisions = { ...decisions, [s.id]: "accepted" as const };
    setDecisions(nextDecisions);
    setMessage("Accepted. Undo it here or with Ctrl+Z; save to keep it.");
    const list = locateAll(run!, ta.value, nextDecisions);
    const n = nextOpen(list, i, 1);
    if (n >= 0) show(n, list);
    else setIndex(i);
  };

  const undo = (i: number) => {
    const ta = textareaRef.current;
    const s = run?.result.suggestions[i];
    if (!ta || !s) return;
    const result = undoEdit(ta.value, freshLocate(s, ta), s, editable);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    applyTextareaEdit(ta, result.edit);
    // The decision stays "accepted": with the original back it reads as open,
    // and if Ctrl+Z restores the correction it reads as accepted, not stale.
    setMessage("Correction undone.");
    show(i, locateAll(run!, ta.value, decisions));
  };

  const dismiss = (i: number) => {
    const s = run?.result.suggestions[i];
    if (!s) return;
    const nextDecisions = { ...decisions, [s.id]: "dismissed" as const };
    setDecisions(nextDecisions);
    setMessage("");
    const list = locateAll(run!, textareaRef.current?.value ?? text, nextDecisions);
    const n = nextOpen(list, i, 1);
    if (n >= 0) show(n, list);
  };

  const step = (direction: 1 | -1) => {
    const n = located.length;
    if (!n) return;
    setMessage("");
    show((((index + direction) % n) + n) % n);
  };

  const result = run?.result;
  const current = result?.suggestions[index];
  const currentLoc = located[index];

  return (
    <div className="proofread stack" aria-label={PROOFREAD.heading}>
      <div className="row">
        <strong>{PROOFREAD.heading}</strong>
        <span className="small muted">{PROOFREAD.scopeNote}</span>
      </div>
      <HelpHint anchor="proofreading" topic="AI proofreading">
        {PROOFREAD.privacyNote}
      </HelpHint>
      <div className="row">
        <Button type="button" variant="secondary" onClick={() => void start(selection)} disabled={!!busy || !hasSelection || dirty || selectionOver}>
          {PROOFREAD.proofreadSelection}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void start(null)} disabled={!!busy || dirty || documentOver}>
          {PROOFREAD.proofreadDocument}
        </Button>
        {busy ? (
          <>
            <span className="small" aria-live="polite">
              {PROOFREAD.running}
            </span>
            <Button type="button" variant="secondary" onClick={() => void cancel()}>
              {PROOFREAD.cancel}
            </Button>
          </>
        ) : (
          <span className="small muted">
            {hasSelection ? `Selection: about ${fmt(estimate(selectionChars))}` : `Document: about ${fmt(estimate(savedText.length))}`} of{" "}
            {fmt(config.maxInputChars)} characters.
          </span>
        )}
      </div>
      {dirty && !busy ? <p className="small muted">{PROOFREAD.saveFirst}</p> : null}
      {selectionOver || documentOver ? (
        <p className="small error-text">
          {documentOver && !selectionOver
            ? "The whole document is over the request limit. Select a part of it to proofread. Nothing is cut automatically."
            : "The selection is over the request limit. Select less text. Nothing is cut automatically."}
        </p>
      ) : null}

      {error ? (
        <Banner tone="error" role="alert">
          <p style={{ margin: 0 }}>{error.message}</p>
          {error.size ? (
            <ul className="small">
              {error.size.items.map((i) => (
                <li key={i.label}>
                  {i.label}: {fmt(i.chars)} characters
                </li>
              ))}
            </ul>
          ) : null}
        </Banner>
      ) : null}

      {result ? (
        <div className="stack">
          <p className="small" style={{ margin: 0 }}>
            Checked{" "}
            {result.scope === "selection"
              ? `the selection (characters ${fmt(result.range.start + 1)} to ${fmt(result.range.end)})`
              : "the whole document"}{" "}
            of saved revision {result.revision}.{" "}
            {result.status === "complete"
              ? result.suggestions.length
                ? `${result.suggestions.length} suggestion${result.suggestions.length === 1 ? "" : "s"}: ${counts.open} open, ${counts.accepted} accepted, ${counts.dismissed} dismissed, ${counts.stale} stale.`
                : PROOFREAD.noSuggestions
              : null}
          </p>
          {result.errorMessage ? <div className={`banner ${result.status === "failed" ? "error" : ""}`}>{result.errorMessage}</div> : null}
          {!editable && result.suggestions.length ? <ProtectionTick note={PROOFREAD.protectedNote} onUnlock={onUnlock} warning /> : null}

          {current && currentLoc ? (
            <div className="proofread-card stack" aria-live="polite">
              <div className="row small">
                <strong>
                  Suggestion {index + 1} of {result.suggestions.length}
                </strong>
                <span className="badge">{current.category}</span>
                <span className={`badge ${currentLoc.status === "stale" ? "stale" : currentLoc.status === "accepted" ? "approved" : ""}`}>
                  {currentLoc.status === "stale" ? PROOFREAD.stale : currentLoc.status}
                </span>
              </div>
              <div className="diff">
                <span className="context">
                  {current.before.length > CONTEXT_SHOWN ? "..." : ""}
                  {current.before.slice(-CONTEXT_SHOWN)}
                </span>
                <del>{current.original}</del>
                <ins>{current.replacement}</ins>
                <span className="context">
                  {current.after.slice(0, CONTEXT_SHOWN)}
                  {current.after.length > CONTEXT_SHOWN ? "..." : ""}
                </span>
              </div>
              <p className="small" style={{ margin: 0 }}>
                <del>{current.original}</del> &rarr; <ins>{current.replacement}</ins>. {current.explanation}
              </p>
              {current.overlaps.length && currentLoc.status === "open" ? <p className="small muted">{PROOFREAD.overlapNote}</p> : null}
              {currentLoc.status === "stale" ? <p className="small muted">{PROOFREAD.staleNote}</p> : null}
              <div className="row">
                {currentLoc.status === "accepted" ? (
                  <Button type="button" variant="secondary" onClick={() => undo(index)} disabled={!editable}>
                    {PROOFREAD.undo}
                  </Button>
                ) : (
                  <>
                    <Button type="button" onClick={() => accept(index)} disabled={!editable || currentLoc.status !== "open"}>
                      {PROOFREAD.accept}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => dismiss(index)} disabled={currentLoc.status !== "open"}>
                      {PROOFREAD.dismiss}
                    </Button>
                  </>
                )}
                <Button type="button" variant="secondary" onClick={() => show(index)} disabled={!currentLoc.range}>
                  {PROOFREAD.showInText}
                </Button>
                <Button type="button" variant="secondary" onClick={() => step(-1)} disabled={result.suggestions.length < 2}>
                  {PROOFREAD.previous}
                </Button>
                <Button type="button" variant="secondary" onClick={() => step(1)} disabled={result.suggestions.length < 2}>
                  {PROOFREAD.next}
                </Button>
              </div>
            </div>
          ) : null}
          {message ? (
            <p className="small" aria-live="polite" style={{ margin: 0 }}>
              {message}
            </p>
          ) : null}

          {result.rejected.length ? (
            <details className="small">
              <summary>{PROOFREAD.leftOut(result.rejected.length)}</summary>
              <ul>
                {result.rejected.map((r, i) => (
                  <li key={i}>
                    &ldquo;{r.original}&rdquo; &rarr; &ldquo;{r.replacement}&rdquo;: {r.message}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <p className="small muted" style={{ margin: 0 }}>
            Model {result.model}.{" "}
            {result.usage
              ? `Tokens: ${fmt(result.usage.inputTokens)} in, ${fmt(result.usage.outputTokens)} out${result.usage.estimated ? " (estimate)" : " (reported by OpenAI)"}.`
              : "No token usage recorded."}
          </p>
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRun(null);
                setDecisions({});
                setMessage("");
              }}
            >
              {PROOFREAD.clear}
            </Button>
          </div>
        </div>
      ) : message ? (
        <p className="small">{message}</p>
      ) : null}
    </div>
  );
}
