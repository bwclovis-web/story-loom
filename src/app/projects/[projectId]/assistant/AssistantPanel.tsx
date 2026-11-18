"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { SectionTagBadge, StatusBadge } from "@/components/Badges";
import { ASSISTANT_INSTRUCTIONS } from "@/assistant/prompt";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import type { ProposalView } from "@/server/services/assistantProposalService";
import type { ConversationView, MessageView, SelectableRecord, SelectableSection } from "@/server/services/assistantService";
import { ASSISTANT } from "@/ui/labels";
import { loadManuscriptAction } from "./actions";
import { DeleteConversation } from "./ConversationControls";
import { FindRelevantContext } from "./FindRelevantContext";
import { ProposalCard } from "./ProposalCard";

interface ApiError {
  code: string;
  message: string;
  size?: { items: { label: string; chars: number }[] };
}

interface LoadedChapter {
  recordId: string;
  title: string;
  revision: number;
  body: string;
}

interface Live {
  mode: "chat" | "proposal";
  question: string;
  assistantMessageId: string | null;
  text: string;
}

/** Per-source labels and separators the server adds; the client total is an approximation. */
const SOURCE_OVERHEAD = 250;
const CONTEXT_PANEL_KEY = "wordly.assistant.contextPanel";
const fmt = (n: number) => n.toLocaleString("en-US");

/** Textareas report offsets with "\r\n" counted as one character; map them back to the stored text. */
function originalOffset(original: string, normalized: number): number {
  let i = 0;
  for (let n = 0; i < original.length && n < normalized; n++) {
    i += original[i] === "\r" && original[i + 1] === "\n" ? 2 : 1;
  }
  return i;
}

function includable(m: MessageView): boolean {
  return m.role === "user" || m.status === "complete" || m.status === "incomplete";
}

function statusText(m: MessageView): string {
  switch (m.status) {
    case "complete":
      return "complete";
    case "incomplete":
      return "incomplete";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return "running";
  }
}

export function AssistantPanel(props: {
  projectId: string;
  configured: boolean;
  maxInputChars: number;
  conversation: ConversationView;
  records: SelectableRecord[];
  proposals: Record<string, ProposalView>;
  /** Extra fixed characters a proposal request sends (its instructions and output format). */
  proposalExtraChars: number;
  /** Active Write draft for pin/discovery scope; null when the project has no drafts. */
  draftScopeId?: string | null;
  /** Manuscript record id from Write “Find relevant context” deep link. */
  seedRecordId?: string | null;
}) {
  const { projectId, conversation, records } = props;
  const router = useRouter();
  const references = records.filter((r) => r.contentClass === "reference");
  const chapters = records.filter((r) => r.contentClass === "manuscript");
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const messageById = useMemo(() => new Map(conversation.messages.map((m) => [m.id, m])), [conversation.messages]);

  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [chapter, setChapter] = useState<LoadedChapter | null>(null);
  const [chapterError, setChapterError] = useState("");
  const [passage, setPassage] = useState<{ start: number; end: number } | null>(null);
  const [mode, setMode] = useState<"whole" | "passage">("whole");
  const [includeIds, setIncludeIds] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chapterBoxRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLOListElement>(null);
  const contextId = useId();
  const [contextOpen, setContextOpenState] = useState(true);

  useEffect(() => {
    if (localStorage.getItem(CONTEXT_PANEL_KEY) === "hidden") setContextOpenState(false);
  }, []);
  const setContextOpen = (open: boolean) => {
    setContextOpenState(open);
    localStorage.setItem(CONTEXT_PANEL_KEY, open ? "shown" : "hidden");
  };

  // Keep the newest message in view unless the author has scrolled up to read.
  const messageCount = conversation.messages.length;
  const liveLength = live?.text.length ?? -1;
  const pinnedRef = useRef(true);
  useEffect(() => {
    const box = transcriptRef.current;
    if (box && pinnedRef.current) box.scrollTop = box.scrollHeight;
  }, [messageCount, liveLength]);
  useEffect(() => {
    const box = transcriptRef.current;
    if (!box) return;
    const onScroll = () => {
      pinnedRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, []);

  const busy = live !== null;
  const streamingStored = conversation.messages.some((m) => m.status === "streaming");

  const [sectionPicks, setSectionPicks] = useState<Record<string, string[]>>({});

  const toggleRef = (id: string, on: boolean) => {
    setSelectedRefs((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));
    if (on) setSectionPicks((prev) => ({ ...prev, [id]: [] }));
  };
  const toggleSection = (recordId: string, sectionId: string, on: boolean) => {
    setSectionPicks((prev) => {
      const current = prev[recordId] ?? [];
      return { ...prev, [recordId]: on ? [...current, sectionId] : current.filter((x) => x !== sectionId) };
    });
    if (on) setSelectedRefs((prev) => prev.filter((x) => x !== recordId));
  };
  /** Chosen sections without those inside another chosen section, in document order. */
  const chosenSections = (r: SelectableRecord): SelectableSection[] => {
    const picked = new Set(sectionPicks[r.id] ?? []);
    const parent = new Map(r.sections.map((s) => [s.id, s.parentId]));
    const insidePicked = (id: string) => {
      for (let p = parent.get(id); p; p = parent.get(p)) if (picked.has(p)) return true;
      return false;
    };
    return r.sections.filter((s) => picked.has(s.id) && !insidePicked(s.id));
  };
  const sectionRefs = references.flatMap((r) => {
    const chosen = chosenSections(r);
    return chosen.length ? [{ record: r, chosen }] : [];
  });
  const toggleInclude = (id: string, on: boolean) =>
    setIncludeIds((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));

  const chooseChapter = async (recordId: string) => {
    setChapter(null);
    setPassage(null);
    setChapterError("");
    if (!recordId) return;
    const result = await loadManuscriptAction(projectId, recordId);
    if (result.ok) setChapter({ recordId: result.recordId, title: result.title, revision: result.revision, body: result.body });
    else setChapterError(result.message);
  };

  useEffect(() => {
    if (!props.seedRecordId || chapter?.recordId === props.seedRecordId) return;
    void chooseChapter(props.seedRecordId);
    setContextOpen(true);
    // Intentionally once per seed id when the panel mounts / seed changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.seedRecordId]);

  const takePassage = () => {
    const box = chapterBoxRef.current;
    if (!box || box.selectionEnd <= box.selectionStart) {
      setChapterError("Select some text in the chapter first.");
      return;
    }
    setChapterError("");
    setPassage({ start: originalOffset(chapter!.body, box.selectionStart), end: originalOffset(chapter!.body, box.selectionEnd) });
  };

  const summary = useMemo(() => {
    const items: { label: string; chars: number }[] = [];
    for (const id of selectedRefs) {
      const r = byId.get(id);
      if (r) items.push({ label: `${r.title} (rev ${r.currentRevision})`, chars: r.chars });
    }
    for (const { record, chosen } of sectionRefs) {
      for (const s of chosen) items.push({ label: `${record.title} (rev ${record.currentRevision}), section "${s.title}"`, chars: s.chars });
    }
    if (chapter) {
      if (mode === "passage" && passage) {
        items.push({ label: `${chapter.title} (rev ${chapter.revision}), passage`, chars: passage.end - passage.start });
      } else if (mode === "whole") {
        items.push({ label: `${chapter.title} (rev ${chapter.revision}), whole chapter`, chars: chapter.body.length });
      }
    }
    const earlier = includeIds.map((id) => messageById.get(id)).filter((m): m is MessageView => !!m);
    const earlierChars = earlier.reduce((n, m) => n + m.content.length, 0);
    const total =
      ASSISTANT_INSTRUCTIONS.length +
      items.reduce((n, i) => n + i.chars + SOURCE_OVERHEAD, 0) +
      earlierChars +
      question.length +
      100;
    return { items, earlierCount: earlier.length, earlierChars, total };
  }, [selectedRefs, sectionPicks, byId, chapter, mode, passage, includeIds, messageById, question]);

  const passageMissing = chapter !== null && mode === "passage" && !passage;
  const overLimit = summary.total > props.maxInputChars;
  const proposalTotal = summary.total + props.proposalExtraChars;
  const proposalOverLimit = proposalTotal > props.maxInputChars;

  async function submit(payload: object, shownQuestion: string, turnMode: Live["mode"]) {
    setError(null);
    setLive({ mode: turnMode, question: shownQuestion, assistantMessageId: null, text: "" });
    const controller = new AbortController();
    abortRef.current = controller;
    let response: Response;
    try {
      response = await fetch(`/api/projects/${projectId}/assistant/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch {
      setLive(null);
      if (!controller.signal.aborted) setError({ code: "NETWORK", message: "Could not reach the app server. Is it still running?" });
      router.refresh();
      return;
    }
    if (!response.ok || !response.body) {
      const json = (await response.json().catch(() => null)) as { error?: ApiError } | null;
      setLive(null);
      setError(json?.error ?? { code: "HTTP", message: `The request failed (${response.status}).` });
      if (json?.error?.code === "STALE_SELECTION") router.refresh();
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
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line) as { type: string; text?: string; assistantMessageId?: string };
          if (event.type === "started") {
            setQuestion("");
            setLive((l) => (l ? { ...l, assistantMessageId: event.assistantMessageId ?? null } : l));
          } else if (event.type === "delta" && event.text) {
            const piece = event.text;
            setLive((l) => (l ? { ...l, text: l.text + piece } : l));
          }
        }
      }
    } catch {
      // Aborted or connection lost; the server stores what it received.
    }
    setLive(null);
    abortRef.current = null;
    router.refresh();
  }

  const send = (turnMode: Live["mode"]) => {
    if (!question.trim()) {
      setError({
        code: "INVALID_REQUEST",
        message: turnMode === "proposal" ? "Describe the changes to prepare first." : "Type a question first.",
      });
      return;
    }
    const manuscript = chapter
      ? {
          recordId: chapter.recordId,
          revision: chapter.revision,
          ...(mode === "passage" && passage ? { passage } : {}),
        }
      : null;
    void submit(
      {
        kind: "ask",
        mode: turnMode,
        conversationId: conversation.id,
        question,
        selection: {
          references: [
            ...selectedRefs.flatMap((id) => {
              const r = byId.get(id);
              return r ? [{ recordId: id, revision: r.currentRevision }] : [];
            }),
            ...sectionRefs.map(({ record, chosen }) => ({
              recordId: record.id,
              revision: record.currentRevision,
              sections: chosen.map((s) => s.id),
            })),
          ],
          manuscript,
          includeMessageIds: includeIds,
        },
      },
      question,
      turnMode,
    );
  };

  const retry = (m: MessageView) => {
    const asked = m.replyToId ? messageById.get(m.replyToId)?.content ?? "" : "";
    void submit({ kind: "retry", conversationId: conversation.id, messageId: m.id }, asked, m.mode);
  };

  const cancel = async () => {
    const id = live?.assistantMessageId;
    if (id) {
      await fetch(`/api/projects/${projectId}/assistant/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: id }),
      }).catch(() => abortRef.current?.abort());
    } else {
      abortRef.current?.abort();
    }
  };

  const cancelStored = async (id: string) => {
    await fetch(`/api/projects/${projectId}/assistant/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: id }),
    }).catch(() => null);
    router.refresh();
  };

  const includableIds = conversation.messages.filter(includable).map((m) => m.id);
  const chosenCount = summary.items.length + summary.earlierCount;

  return (
    <div className={`assistant-main${contextOpen ? "" : " context-hidden"}`}>
    <section className="panel assistant-chat" aria-label={conversation.title}>
      <div className="row assistant-chat-head">
        <h2 style={{ margin: 0 }}>{conversation.title}</h2>
        <DeleteConversation projectId={projectId} conversationId={conversation.id} />
      </div>
      <p className="small muted">{ASSISTANT.proposalsNote}</p>

      <ol className="transcript" aria-label="Conversation" ref={transcriptRef}>
        {conversation.messages.length === 0 && !live ? <li className="small muted">{ASSISTANT.emptyConversation}</li> : null}
        {conversation.messages.map((m) => (
          <li key={m.id} className={`message ${m.role}`}>
            <div className="row small">
              <strong>{m.role === "user" ? "You" : "Assistant"}</strong>
              {m.mode === "proposal" && m.role === "user" ? <span className="badge">{ASSISTANT.proposalRequest}</span> : null}
              {m.role === "assistant" ? (
                <span className={`badge ${m.status === "complete" ? "" : "unresolved"}`}>{statusText(m)}</span>
              ) : null}
              {m.role === "assistant" && m.basedOnOlderVersions ? <span className="badge stale">{ASSISTANT.olderVersion}</span> : null}
              <span className="muted">{new Date(m.createdAt).toLocaleString()}</span>
              {includable(m) ? (
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={includeIds.includes(m.id)}
                    disabled={busy}
                    onChange={(e) => toggleInclude(m.id, e.target.checked)}
                  />
                  {ASSISTANT.includeMessage}
                </label>
              ) : null}
            </div>
            <div className="message-text">{m.content || (m.role === "assistant" ? <em className="muted">(no text)</em> : null)}</div>
            {props.proposals[m.id] ? <ProposalCard projectId={projectId} proposal={props.proposals[m.id]} /> : null}
            {m.role === "assistant" ? <AnswerDetails m={m} /> : null}
            {m.role === "assistant" && (m.status === "failed" || m.status === "cancelled") ? (
              <div className="row">
                {m.errorMessage ? <div className={`banner ${m.status === "failed" ? "error" : ""}`}>{m.errorMessage}</div> : null}
                <button type="button" className="secondary" disabled={!props.configured || busy || streamingStored} onClick={() => retry(m)}>
                  {ASSISTANT.retry}
                </button>
              </div>
            ) : null}
            {m.role === "assistant" && m.status === "incomplete" && m.errorMessage ? <div className="banner">{m.errorMessage}</div> : null}
            {m.role === "assistant" && m.status === "streaming" && !busy ? (
              <div className="row small">
                <span>This answer is still running or was interrupted.</span>
                <button type="button" className="secondary" onClick={() => cancelStored(m.id)}>
                  {ASSISTANT.cancel}
                </button>
              </div>
            ) : null}
          </li>
        ))}
        {live ? (
          <>
            <li className="message user">
              <div className="row small">
                <strong>You</strong>
                {live.mode === "proposal" ? <span className="badge">{ASSISTANT.proposalRequest}</span> : null}
              </div>
              <div className="message-text">{live.question}</div>
            </li>
            <li className="message assistant" aria-live="polite" aria-busy="true">
              <div className="row small">
                <strong>Assistant</strong>
                <span className="badge">
                  {!live.assistantMessageId ? "sending..." : live.mode === "proposal" ? "preparing proposal..." : "answering..."}
                </span>
                <button type="button" className="secondary" onClick={cancel}>
                  {ASSISTANT.cancel}
                </button>
              </div>
              <div className="message-text">{live.text}</div>
            </li>
          </>
        ) : null}
      </ol>

      {error ? (
        <div className="banner error" role="alert">
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
        </div>
      ) : null}

      {props.configured ? (
        <div className="stack assistant-composer">
          <div className="row small composer-context">
            <span>
              {chosenCount ? ASSISTANT.composerIncluded(chosenCount) : ASSISTANT.composerNothing} {ASSISTANT.composerSize(fmt(summary.total), fmt(props.maxInputChars))}
            </span>
            <button type="button" className="secondary small-button" aria-expanded={contextOpen} aria-controls={contextId} onClick={() => setContextOpen(!contextOpen)}>
              {contextOpen ? ASSISTANT.hideContext : ASSISTANT.showContext}
            </button>
          </div>
          {overLimit ? (
            <p className="error-text small">Over the limit. Remove records or earlier messages, or use a shorter passage. Nothing is cut automatically.</p>
          ) : null}
          {passageMissing ? <p className="error-text small">Select a passage, or switch to {ASSISTANT.wholeChapter}.</p> : null}
          <label>
            <span className="sr-only">{ASSISTANT.question}</span>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={busy}
              placeholder={ASSISTANT.questionPlaceholder}
              style={{ minHeight: "5.5rem" }}
              spellCheck
            />
          </label>
          <div className="row">
            <button type="button" onClick={() => send("chat")} disabled={busy || streamingStored || overLimit || passageMissing}>
              {ASSISTANT.send}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => send("proposal")}
              disabled={busy || streamingStored || proposalOverLimit || passageMissing}
            >
              {ASSISTANT.prepare}
            </button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {ASSISTANT.sendHint} {ASSISTANT.prepareHint}
          </p>
        </div>
      ) : null}
    </section>

      {props.configured ? (
        <aside id={contextId} className="panel stack assistant-context" aria-labelledby={`${contextId}-heading`} hidden={!contextOpen}>
          <div className="row assistant-context-head">
            <h3 id={`${contextId}-heading`} style={{ margin: 0 }}>
              {ASSISTANT.contextHeading}
            </h3>
            <button type="button" className="secondary small-button" aria-controls={contextId} aria-expanded onClick={() => setContextOpen(false)}>
              {ASSISTANT.hideContext}
            </button>
          </div>
          <FindRelevantContext
            projectId={projectId}
            question={question}
            manuscript={
              chapter
                ? {
                    recordId: chapter.recordId,
                    start: mode === "passage" && passage ? passage.start : undefined,
                    end: mode === "passage" && passage ? passage.end : undefined,
                  }
                : null
            }
            draftScopeId={props.draftScopeId}
            disabled={busy}
            onApply={({ selectedRefs: refs, sectionPicks: picks }) => {
              const sectionIds = new Set(Object.keys(picks));
              setSelectedRefs((prev) => [...new Set([...prev.filter((id) => !sectionIds.has(id)), ...refs.filter((id) => !sectionIds.has(id))])]);
              setSectionPicks((prev) => {
                const next = { ...prev };
                for (const [id, sections] of Object.entries(picks)) {
                  next[id] = [...new Set([...(prev[id] ?? []), ...sections])];
                }
                return next;
              });
              setContextOpen(true);
            }}
          />
          <fieldset disabled={busy}>
            <legend>{ASSISTANT.references}</legend>
            {references.length === 0 ? <p className="small muted">No reference records in this project.</p> : null}
            <ul className="pick-list">
              {references.map((r) => (
                <li key={r.id}>
                  <label className="inline">
                    <input type="checkbox" checked={selectedRefs.includes(r.id)} onChange={(e) => toggleRef(r.id, e.target.checked)} />
                    {r.title}
                  </label>{" "}
                  <span className="small muted">{RECORD_TYPE_LABELS[r.type]}</span> <StatusBadge status={r.authorityStatus} />{" "}
                  <span className="badge">rev {r.currentRevision}</span> <span className="small muted">{fmt(r.chars)} characters</span>
                  {r.sections.length > 1 ? <SectionPicker record={r} picked={sectionPicks[r.id] ?? []} onToggle={toggleSection} /> : null}
                </li>
              ))}
            </ul>
          </fieldset>

          <fieldset disabled={busy}>
            <legend>{ASSISTANT.manuscript}</legend>
            <label>
              Chapter
              <select value={chapter?.recordId ?? ""} onChange={(e) => void chooseChapter(e.target.value)}>
                <option value="">{ASSISTANT.noManuscript}</option>
                {chapters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} (rev {r.currentRevision}, {fmt(r.chars)} characters)
                  </option>
                ))}
              </select>
            </label>
            {chapter ? (
              <div className="stack">
                <div className="row">
                  <label className="inline">
                    <input type="radio" name="manuscript-mode" checked={mode === "whole"} onChange={() => setMode("whole")} />
                    {ASSISTANT.wholeChapter}
                  </label>
                  <label className="inline">
                    <input type="radio" name="manuscript-mode" checked={mode === "passage"} onChange={() => setMode("passage")} />
                    {ASSISTANT.passageOnly}
                  </label>
                </div>
                {mode === "passage" ? (
                  <>
                    <p className="small muted">{ASSISTANT.passageHint}</p>
                    <textarea
                      ref={chapterBoxRef}
                      readOnly
                      value={chapter.body}
                      aria-label={`Text of ${chapter.title}, revision ${chapter.revision}`}
                      style={{ minHeight: "10rem" }}
                    />
                    <div className="row">
                      <button type="button" className="secondary" onClick={takePassage}>
                        {ASSISTANT.usePassage}
                      </button>
                      {passage ? (
                        <span className="small">
                          Passage: characters {fmt(passage.start + 1)} to {fmt(passage.end)} ({fmt(passage.end - passage.start)}{" "}
                          characters): &ldquo;{chapter.body.slice(passage.start, Math.min(passage.end, passage.start + 80))}
                          {passage.end - passage.start > 80 ? "..." : ""}&rdquo;
                        </span>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
            {chapterError ? <p className="small error-text">{chapterError}</p> : null}
          </fieldset>

          <fieldset disabled={busy}>
            <legend>{ASSISTANT.earlierMessages}</legend>
            <p className="small muted">
              Tick {ASSISTANT.includeMessage} on messages in the conversation. {includeIds.length} of {includableIds.length} ticked.
            </p>
            <div className="row">
              <button type="button" className="secondary" onClick={() => setIncludeIds(includableIds)} disabled={!includableIds.length}>
                {ASSISTANT.includeAll}
              </button>
              <button type="button" className="secondary" onClick={() => setIncludeIds([])} disabled={!includeIds.length}>
                {ASSISTANT.includeNone}
              </button>
            </div>
          </fieldset>

          <div className="writing-tools small" aria-live="polite">
            <strong>{ASSISTANT.summaryHeading}</strong>
            <ul>
              {summary.items.map((i) => (
                <li key={i.label}>
                  {i.label}: {fmt(i.chars)} characters
                </li>
              ))}
              {summary.earlierCount ? (
                <li>
                  {summary.earlierCount} earlier message(s): {fmt(summary.earlierChars)} characters
                </li>
              ) : null}
              <li>Your question and the fixed assistant instructions</li>
            </ul>
            <p>
              About {fmt(summary.total)} of {fmt(props.maxInputChars)} characters (about {fmt(Math.ceil(summary.total / 4))} tokens,
              estimate). A change proposal request adds fixed instructions and the proposal format: about {fmt(proposalTotal)} characters.
            </p>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function SectionPicker({
  record,
  picked,
  onToggle,
}: {
  record: SelectableRecord;
  picked: string[];
  onToggle: (recordId: string, sectionId: string, on: boolean) => void;
}) {
  const top = Math.min(...record.sections.map((s) => s.level));
  const parent = new Map(record.sections.map((s) => [s.id, s.parentId]));
  const underPicked = (id: string) => {
    for (let p = parent.get(id); p; p = parent.get(p)) if (picked.includes(p)) return true;
    return false;
  };
  return (
    <details className="section-picker">
      <summary className="small">
        {ASSISTANT.sections(record.sections.length)}
        {picked.length ? `, ${ASSISTANT.sectionsChosen(picked.length)}` : ""}
      </summary>
      <p className="small muted">{ASSISTANT.sectionsHint}</p>
      <ul className="pick-list">
        {record.sections.map((s) => {
          const inherited = underPicked(s.id);
          return (
            <li key={s.id} style={{ paddingLeft: `${(s.level - top) * 1.1}rem` }}>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={inherited || picked.includes(s.id)}
                  disabled={inherited}
                  onChange={(e) => onToggle(record.id, s.id, e.target.checked)}
                />
                {s.title}
              </label>{" "}
              {s.statusTag ? <SectionTagBadge tag={s.statusTag} /> : null}{" "}
              <span className="small muted">{inherited ? ASSISTANT.includedWithParent : `${fmt(s.chars)} characters`}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function AnswerDetails({ m }: { m: MessageView }) {
  const passageItems = m.contextItems;
  return (
    <div className="small muted answer-details">
      {passageItems.length ? (
        <p>
          Used:{" "}
          {passageItems.map((c, i) => (
            <span key={`${c.recordId}-${c.kind}-${i}`}>
              {i > 0 ? "; " : ""}
              {c.title} rev {c.revisionNumber}
              {c.kind === "section" && c.passageStart !== null && c.passageEnd !== null
                ? ` (section, ${(c.passageEnd - c.passageStart).toLocaleString("en-US")} characters)`
                : c.kind === "passage" && c.passageStart !== null && c.passageEnd !== null
                ? ` (passage, ${(c.passageEnd - c.passageStart).toLocaleString("en-US")} characters)`
                : c.kind === "manuscript"
                  ? " (whole chapter)"
                  : ""}
              {c.olderVersion ? <strong className="error-text"> (now rev {c.currentRevision})</strong> : null}
            </span>
          ))}
        </p>
      ) : (
        <p>Used: no records.</p>
      )}
      {m.includedMessageIds.length ? <p>Plus {m.includedMessageIds.length} earlier message(s).</p> : null}
      <p>
        {m.model ? `Model ${m.model}. ` : ""}
        {m.totalTokens !== null
          ? `Tokens: ${m.inputTokens?.toLocaleString("en-US")} in, ${m.outputTokens?.toLocaleString("en-US")} out${
              m.usageEstimated ? " (estimate; OpenAI reported no usage)" : " (reported by OpenAI)"
            }.`
          : "No token usage recorded."}
      </p>
    </div>
  );
}
