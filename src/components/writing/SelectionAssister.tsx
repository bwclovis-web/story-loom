"use client";

import { useRef, useState, type RefObject } from "react";
import { HelpHint } from "@/components/HelpHint";
import type { SelectionAssistResult } from "@/server/services/selectionAssistService";
import type { SelectionAssistAction } from "@/selectionAssist/output";
import { SELECTION_ASSIST } from "@/ui/labels";
import type { ProofreadConfig } from "./Proofreader";
import { ProtectionTick } from "./ProtectionTick";
import { applyTextareaEdit, selectRange } from "./textareaEdit";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";

interface ApiError {
  code: string;
  message: string;
  size?: { items: { label: string; chars: number }[] };
}

const fmt = (n: number) => n.toLocaleString("en-US");

export function SelectionAssister({
  projectId,
  recordId,
  revision,
  savedText,
  text,
  selection,
  scopeDraftId,
  textareaRef,
  editable,
  onUnlock,
  onTextChange,
  config,
}: {
  projectId: string;
  recordId: string;
  revision: number;
  savedText: string;
  scopeDraftId: string;
  text: string;
  selection: { start: number; end: number };
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  editable: boolean;
  onUnlock: () => void;
  onTextChange: (value: string) => void;
  config: ProofreadConfig;
}) {
  const [result, setResult] = useState<SelectionAssistResult | null>(null);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ runId: string | null } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  if (!config.configured) return null;

  const dirty = text !== savedText;
  const hasSelection = selection.end > selection.start;
  const selectionChars = selection.end - selection.start;
  const estimate = (chars: number) => chars + config.fixedChars;
  const selectionOver = hasSelection && estimate(selectionChars) > config.maxInputChars;

  const rangeStale =
    result &&
    sourceText !== null &&
    (text !== sourceText ||
      result.range.start !== selection.start ||
      result.range.end !== selection.end);

  async function start(action: SelectionAssistAction) {
    if (dirty) {
      setMessage(SELECTION_ASSIST.saveFirst);
      return;
    }
    if (!hasSelection) {
      setMessage(SELECTION_ASSIST.needSelection);
      return;
    }
    setError(null);
    setMessage("");
    setDismissed(false);
    setResult(null);
    setBusy({ runId: null });
    const source = savedText;
    const range = { start: selection.start, end: selection.end };
    const controller = new AbortController();
    abortRef.current = controller;
    let response: Response;
    try {
      response = await fetch(`/api/projects/${projectId}/selection-assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "selection_assist",
          recordId,
          revision,
          range,
          action,
          scopeDraftId,
        }),
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
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let lineEnd = buffer.indexOf("\n");
        while (lineEnd >= 0) {
          const line = buffer.slice(0, lineEnd);
          buffer = buffer.slice(lineEnd + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type: string; runId?: string; result?: SelectionAssistResult; message?: string };
          if (event.type === "started" && event.runId) setBusy({ runId: event.runId });
          if (event.type === "done" && event.result) {
            setSourceText(source);
            setResult(event.result);
            selectRange(textareaRef.current!, range.start, range.end);
          }
          if (event.type === "error") setError({ code: "SERVER", message: event.message ?? "The request failed." });
          lineEnd = buffer.indexOf("\n");
        }
      }
    } catch {
      if (!controller.signal.aborted) setError({ code: "STREAM", message: "The response ended unexpectedly." });
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    const runId = busy?.runId;
    abortRef.current?.abort();
    if (runId) {
      await fetch(`/api/projects/${projectId}/selection-assist/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      }).catch(() => undefined);
    }
    setBusy(null);
  }

  function accept() {
    if (!result?.replacement || rangeStale || dismissed) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const edit = { start: result.range.start, end: result.range.end, text: result.replacement };
    applyTextareaEdit(ta, edit);
    onTextChange(ta.value);
    setDismissed(true);
    setMessage(SELECTION_ASSIST.accepted);
  }

  return (
    <div className="selection-assist stack" aria-label={SELECTION_ASSIST.heading}>
      <div className="row">
        <strong>{SELECTION_ASSIST.heading}</strong>
      </div>
      <HelpHint anchor="selection-assist" topic="AI writing assist on a selection">
        {SELECTION_ASSIST.privacyNote}
      </HelpHint>
      <p className="small muted">{SELECTION_ASSIST.pinNote}</p>
      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <Button type="button" variant="secondary" disabled={!!busy || !hasSelection || dirty || selectionOver} onClick={() => void start("rewrite")}>
          {SELECTION_ASSIST.rewrite}
        </Button>
        <Button type="button" variant="secondary" disabled={!!busy || !hasSelection || dirty || selectionOver} onClick={() => void start("expand")}>
          {SELECTION_ASSIST.expand}
        </Button>
        <Button type="button" variant="secondary" disabled={!!busy || !hasSelection || dirty || selectionOver} onClick={() => void start("describe")}>
          {SELECTION_ASSIST.describe}
        </Button>
        {busy ? (
          <>
            <span className="small" aria-live="polite">
              {SELECTION_ASSIST.running}
            </span>
            <Button type="button" variant="secondary" onClick={() => void cancel()}>
              {SELECTION_ASSIST.cancel}
            </Button>
          </>
        ) : (
          <span className="small muted">
            {hasSelection
              ? `Selection: about ${fmt(estimate(selectionChars))} of ${fmt(config.maxInputChars)} characters (codex pins add more).`
              : SELECTION_ASSIST.needSelection}
          </span>
        )}
      </div>
      {dirty && !busy ? <p className="small muted">{SELECTION_ASSIST.saveFirst}</p> : null}
      {selectionOver ? <p className="small error-text">{SELECTION_ASSIST.tooLarge}</p> : null}
      {message ? <p className="small muted">{message}</p> : null}
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
      {result && !dismissed && result.status === "complete" && result.replacement && !result.errorMessage ? (
        <div className="stack panel">
          <p className="small" style={{ margin: 0 }}>
            {SELECTION_ASSIST.suggestionFor(result.action)} {result.contextRecordIds.length ? SELECTION_ASSIST.usedPins(result.contextRecordIds.length) : SELECTION_ASSIST.noPins}
          </p>
          {rangeStale ? <p className="small muted">{SELECTION_ASSIST.staleNote}</p> : null}
          {!editable ? <ProtectionTick note={SELECTION_ASSIST.protectedNote} onUnlock={onUnlock} warning /> : null}
          <p className="small" style={{ margin: 0 }}>
            {result.note}
          </p>
          <pre className="small assist-preview" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
            {result.replacement}
          </pre>
          <div className="row">
            <Button type="button" disabled={!editable || !!rangeStale} onClick={accept}>
              {SELECTION_ASSIST.accept}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setDismissed(true)}>
              {SELECTION_ASSIST.dismiss}
            </Button>
          </div>
        </div>
      ) : null}
      {result?.errorMessage ? <Banner tone={result.status === "failed" ? "error" : "info"}>{result.errorMessage}</Banner> : null}
    </div>
  );
}