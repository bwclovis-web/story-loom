"use client";

import { useId, useRef, useState, type RefObject } from "react";
import { PromptPresetSelect } from "@/components/assistant/PromptPresetSelect";
import { ContextInspector, useDisabledInspectIds } from "@/components/assistant/ContextInspector";
import { HelpHint } from "@/components/HelpHint";
import type { ContextInspectReport } from "@/server/services/assistantContextInspect";
import type { SelectionAssistResult } from "@/server/services/selectionAssistService";
import { readAssistantJobStream } from "@/assistant/jobStream";
import type { SelectionAssistAction } from "@/selectionAssist/output";
import type { PromptPresetView } from "@/server/services/promptPresetService";
import { ASSISTANT, SELECTION_ASSIST } from "@/ui/labels";
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
  selectionPresets = [],
}: {
  projectId: string;
  recordId: string;
  revision: number;
  savedText: string;
  scopeDraftId: string;
  text: string;
  selection: { start: number; end: number };
  textareaRef: RefObject<import("@/components/writing/EditorSurface").EditorSurface | HTMLTextAreaElement | null>;
  editable: boolean;
  onUnlock: () => void;
  onTextChange: (value: string) => void;
  config: ProofreadConfig;
  selectionPresets?: PromptPresetView[];
}) {
  const fieldId = useId().replace(/:/g, "");
  const [presetId, setPresetId] = useState("");
  const [instructionLens, setInstructionLens] = useState("");
  const [result, setResult] = useState<SelectionAssistResult | null>(null);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ runId: string | null } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [message, setMessage] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [inspect, setInspect] = useState<ContextInspectReport | null>(null);
  const [pendingAction, setPendingAction] = useState<SelectionAssistAction | null>(null);
  const { disabledIds, toggle, reset } = useDisabledInspectIds();
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

  async function openInspect(action: SelectionAssistAction) {
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
    reset();
    setPendingAction(action);
    try {
      const response = await fetch(`/api/projects/${projectId}/assistant/context-inspect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "selection_assist",
          recordId,
          revision,
          range: { start: selection.start, end: selection.end },
          action,
          scopeDraftId,
          authorInstructionText: instructionLens.trim() || undefined,
          promptPresetId: presetId || undefined,
        }),
      });
      const json = (await response.json()) as { report?: ContextInspectReport; error?: ApiError };
      if (!response.ok || !json.report) {
        setError(json.error ?? { code: "HTTP", message: `Inspect failed (${response.status}).` });
        setPendingAction(null);
        return;
      }
      setInspect(json.report);
    } catch {
      setError({ code: "NETWORK", message: "Could not reach the app server. Is it still running?" });
      setPendingAction(null);
    }
  }

  async function start(action: SelectionAssistAction, excludeRecordIds: string[]) {
    setError(null);
    setMessage("");
    setDismissed(false);
    setResult(null);
    setInspect(null);
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
          excludeRecordIds,
          authorInstructionText: instructionLens.trim() || undefined,
          promptPresetId: presetId || undefined,
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

    try {
      await readAssistantJobStream(response, (event) => {
        if (event.type === "started" && event.runId) setBusy({ runId: event.runId });
        // Token deltas may be raw JSON while the model streams; the final done event has the parsed result.
        if (event.type === "done" && event.result) {
          setSourceText(source);
          setResult(event.result as SelectionAssistResult);
          selectRange(textareaRef.current!, range.start, range.end);
        }
        if (event.type === "error") setError({ code: "SERVER", message: event.message ?? "The request failed." });
      });
    } catch {
      if (!controller.signal.aborted) setError({ code: "STREAM", message: "The response ended unexpectedly." });
    } finally {
      setBusy(null);
      setPendingAction(null);
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

  const excludeRecordIds = [...disabledIds].filter((id) => id.startsWith("record:")).map((id) => id.slice("record:".length));

  return (
    <div className="selection-assist stack" aria-label={SELECTION_ASSIST.heading}>
      <div className="row">
        <strong>{SELECTION_ASSIST.heading}</strong>
      </div>
      <HelpHint anchor="selection-assist" topic="AI writing assist on a selection">
        {SELECTION_ASSIST.privacyNote}
      </HelpHint>
      <p className="small muted">{SELECTION_ASSIST.pinNote}</p>
      <PromptPresetSelect
        id={fieldId}
        presets={selectionPresets}
        presetId={presetId}
        onPresetIdChange={setPresetId}
        instructionLens={instructionLens}
        onInstructionLensChange={setInstructionLens}
        disabled={!!busy}
      />
      <div className="row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
        <Button type="button" variant="secondary" disabled={!!busy || !hasSelection || dirty || selectionOver} onClick={() => void openInspect("rewrite")}>
          {SELECTION_ASSIST.rewrite}
        </Button>
        <Button type="button" variant="secondary" disabled={!!busy || !hasSelection || dirty || selectionOver} onClick={() => void openInspect("expand")}>
          {SELECTION_ASSIST.expand}
        </Button>
        <Button type="button" variant="secondary" disabled={!!busy || !hasSelection || dirty || selectionOver} onClick={() => void openInspect("describe")}>
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
      <p className="small muted">{SELECTION_ASSIST.inspectBeforeSend}</p>
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
      {inspect && pendingAction ? (
        <ContextInspector
          report={inspect}
          disabledIds={disabledIds}
          onToggle={toggle}
          busy={!!busy}
          onClose={() => {
            setInspect(null);
            setPendingAction(null);
          }}
          onConfirmSend={() => void start(pendingAction, excludeRecordIds)}
        />
      ) : null}
      {result && !dismissed && result.status === "complete" && result.replacement && !result.errorMessage ? (
        <div className="stack panel">
          <p className="small" style={{ margin: 0 }}>
            {SELECTION_ASSIST.suggestionFor(result.action)}{" "}
            {result.contextRecordIds.length ? SELECTION_ASSIST.usedPins(result.contextRecordIds.length) : SELECTION_ASSIST.noPins}
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
      {/* Keep ASSISTANT labels referenced for help consistency */}
      <span className="sr-only">{ASSISTANT.inspectHeading}</span>
    </div>
  );
}
