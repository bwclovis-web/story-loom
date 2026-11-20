"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { SectionTagBadge, StatusBadge } from "@/components/Badges";
import type { DraftOption } from "@/components/drafts/DraftControls";
import { ContextRail, ContextRailToggle, useContextRail } from "@/components/shell/ContextRail";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { ASSISTANT_INSTRUCTIONS } from "@/assistant/prompt";
import type { RetrievalScope } from "@/assistant/tools";
import { takeWriteHandoff } from "@/assistant/writeHandoff";
import { AssistantAnswer } from "@/components/assistant/AssistantAnswer";
import {
  clearComposerState,
  loadComposerState,
  saveComposerState,
  type StoredComposerState,
} from "@/components/assistant/assistantComposerState";
import { loadAssistantDraft, saveAssistantDraft } from "@/components/assistant/assistantDraft";
import { extraRetrievalSources, SourcePills } from "@/components/assistant/SourcePills";
import { budgetRecentMessageIds } from "@/assistant/recentBudget";
import { retrievalSourceHref, retrievalSourceLabel } from "@/assistant/sourceHref";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import type { ProposalView } from "@/server/services/assistantProposalService";
import type {
  AssistantSettingsView,
  ConversationView,
  MessageView,
  SelectableRecord,
  SelectableSection,
} from "@/server/services/assistantService";
import { ASSISTANT, DRAFT } from "@/ui/labels";
import { loadManuscriptAction, newConversationForRailAction } from "./actions";
import { useRegisterAssistantComposer } from "./AssistantComposerBridge";
import { ConversationSummaryEditor, DeleteConversation } from "./ConversationControls";
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
  conversation: ConversationView | null;
  records: SelectableRecord[];
  proposals: Record<string, ProposalView>;
  /** Extra fixed characters a proposal request sends (its instructions and output format). */
  proposalExtraChars: number;
  /** Active Write draft for pin/discovery scope; null when the project has no drafts. */
  draftScopeId?: string | null;
  drafts?: DraftOption[];
  settings: AssistantSettingsView;
  /** Manuscript record id from Write “Find relevant context” deep link. */
  seedRecordId?: string | null;
  /** When set, consume a Write sessionStorage handoff (question, unsaved prose, scope). */
  consumeWriteHandoff?: boolean;
  /** World board deep link: preselect linked records/sections and suggest a prompt. */
  boardSeed?: {
    boardId: string;
    boardTitle: string;
    suggestedPrompt: string;
    selectedRefs: string[];
    sectionPicks: Record<string, string[]>;
  } | null;
  layout?: "home" | "workbench";
  onOpenSettings?: () => void;
}) {
  const { projectId, records } = props;
  const conversation = props.conversation;
  const isHome = props.layout === "home" || !conversation;
  const isWorkbench = props.layout === "workbench" && !!conversation;
  const router = useRouter();
  const references = records.filter((r) => r.contentClass === "reference");
  const chapters = records.filter((r) => r.contentClass === "manuscript");
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const messages = conversation?.messages ?? [];
  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);

  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [chapter, setChapter] = useState<LoadedChapter | null>(null);
  const [chapterError, setChapterError] = useState("");
  const [passage, setPassage] = useState<{ start: number; end: number } | null>(null);
  const [mode, setMode] = useState<"whole" | "passage">("whole");
  const [includeIds, setIncludeIds] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [retrievalScope, setRetrievalScope] = useState<RetrievalScope>("book");
  const [enableTools, setEnableTools] = useState(true);
  const [writeHandoff, setWriteHandoff] = useState<{
    includeUnsavedProse: boolean;
    unsavedBody: string | null;
    draftId: string | null;
    recordId: string;
  } | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chapterBoxRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLOListElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const manuscriptFieldRef = useRef<HTMLFieldSetElement>(null);
  const contextId = useId();
  const contextTitleId = `${contextId}-heading`;
  const rail = useContextRail();
  const budgetAppliedRef = useRef<string | null>(null);
  const [budgetedIds, setBudgetedIds] = useState<string[]>([]);
  const handoffConsumed = useRef(false);

  // Keep the newest message in view unless the author has scrolled up to read.
  const messageCount = messages.length;
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
  const streamingStored = messages.some((m) => m.status === "streaming");

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
    if (!rail.visible) rail.toggle();
    // Intentionally once per seed id when the panel mounts / seed changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.seedRecordId]);

  useEffect(() => {
    if (!props.consumeWriteHandoff || handoffConsumed.current) return;
    handoffConsumed.current = true;
    const payload = takeWriteHandoff(projectId);
    if (!payload) return;
    setQuestion(payload.question);
    setRetrievalScope(payload.scope);
    if (payload.passage) {
      setMode("passage");
      setPassage(payload.passage);
    }
    setWriteHandoff({
      includeUnsavedProse: payload.includeUnsavedProse,
      unsavedBody: payload.unsavedBody,
      draftId: payload.draftId,
      recordId: payload.recordId,
    });
  }, [props.consumeWriteHandoff, projectId]);

  useEffect(() => {
    const draft = loadAssistantDraft(projectId);
    if (!draft) return;
    if (draft.question) setQuestion((q) => q || draft.question);
    if (draft.scope) setRetrievalScope(draft.scope);
  }, [projectId]);

  useEffect(() => {
    if (!conversation) return;
    saveAssistantDraft(projectId, {
      conversationId: conversation.id,
      question,
      scope: retrievalScope,
    });
  }, [projectId, conversation, question, retrievalScope]);

  useEffect(() => {
    if (!props.boardSeed) return;
    setSelectedRefs(props.boardSeed.selectedRefs);
    setSectionPicks(props.boardSeed.sectionPicks);
    setQuestion(props.boardSeed.suggestedPrompt);
    if (!rail.visible) rail.toggle();
    // Intentionally once per board seed when the panel mounts / board changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.boardSeed?.boardId]);

  useEffect(() => {
    if (!conversation) return;
    if (!props.settings.autoIncludeRecent) {
      setBudgetedIds([]);
      budgetAppliedRef.current = null;
      return;
    }
    const key = `${conversation.id}:${props.settings.recentContextBudgetChars}`;
    const next = budgetRecentMessageIds(conversation.messages, props.settings.recentContextBudgetChars);
    setBudgetedIds(next);
    if (budgetAppliedRef.current === key) return;
    budgetAppliedRef.current = key;
    setIncludeIds((prev) => [...new Set([...prev, ...next])]);
  }, [conversation, props.settings.autoIncludeRecent, props.settings.recentContextBudgetChars]);

  const snapshotComposerState = useCallback(
    (pendingAction?: StoredComposerState["pendingAction"]): StoredComposerState => ({
      question,
      selectedRefs,
      sectionPicks,
      excludedIds,
      chapterRecordId: chapter?.recordId ?? null,
      passage,
      mode,
      includeIds,
      retrievalScope,
      enableTools,
      pendingAction,
    }),
    [question, selectedRefs, sectionPicks, excludedIds, chapter, passage, mode, includeIds, retrievalScope, enableTools],
  );

  const applyComposerState = useCallback(
    (stored: StoredComposerState) => {
      if (stored.question) setQuestion((q) => q || stored.question);
      setSelectedRefs(stored.selectedRefs);
      setSectionPicks(stored.sectionPicks);
      setExcludedIds(stored.excludedIds);
      setPassage(stored.passage);
      setMode(stored.mode);
      setIncludeIds(stored.includeIds);
      setRetrievalScope(stored.retrievalScope);
      setEnableTools(stored.enableTools);
      if (stored.chapterRecordId) void chooseChapter(stored.chapterRecordId);
    },
    // chooseChapter is stable enough for restore
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId],
  );

  const pendingHomeSendRef = useRef<StoredComposerState | null>(null);

  useEffect(() => {
    if (!conversation) return;
    const stored = loadComposerState(projectId, conversation.id);
    if (!stored) return;
    applyComposerState(stored);
    clearComposerState(projectId, conversation.id);
    if (stored.pendingAction && stored.question.trim()) pendingHomeSendRef.current = stored;
    // Run once when the workbench conversation loads after home redirect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id]);

  const composerActions = useMemo(
    () => ({
      focusQuestion: () => questionRef.current?.focus(),
      openContextForPassage: () => {
        if (!rail.visible) rail.toggle();
        manuscriptFieldRef.current?.scrollIntoView({ block: "nearest" });
        manuscriptFieldRef.current?.focus({ preventScroll: true });
      },
      openContextForProposal: () => {
        if (!rail.visible) rail.toggle();
        questionRef.current?.focus();
      },
    }),
    [rail],
  );
  useRegisterAssistantComposer(isHome ? composerActions : null);

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
    const summaryChars = (conversation?.summary ?? "").trim().length;
    if (summaryChars) items.push({ label: ASSISTANT.conversationSummary, chars: summaryChars });
    const total =
      ASSISTANT_INSTRUCTIONS.length +
      items.reduce((n, i) => n + i.chars + SOURCE_OVERHEAD, 0) +
      earlierChars +
      question.length +
      100;
    return { items, earlierCount: earlier.length, earlierChars, total };
  }, [selectedRefs, sectionPicks, byId, chapter, mode, passage, includeIds, messageById, question, conversation?.summary]);

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

  const buildAskPayload = (turnMode: Live["mode"], conversationId: string) => {
    const manuscript = chapter
      ? {
          recordId: chapter.recordId,
          revision: chapter.revision,
          ...(mode === "passage" && passage ? { passage } : {}),
        }
      : null;
    return {
      kind: "ask" as const,
      mode: turnMode,
      conversationId,
      question,
      retrievalScope,
      enableTools: turnMode === "chat" ? enableTools : false,
      write: writeHandoff
        ? {
            recordId: writeHandoff.recordId,
            draftId: writeHandoff.draftId,
            passage: mode === "passage" && passage ? passage : undefined,
            includeUnsavedProse: writeHandoff.includeUnsavedProse,
            unsavedBody: writeHandoff.unsavedBody,
          }
        : chapter
          ? {
              recordId: chapter.recordId,
              draftId: props.draftScopeId ?? null,
              passage: mode === "passage" && passage ? passage : undefined,
              includeUnsavedProse: false,
              unsavedBody: null,
            }
          : null,
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
        excludeRecordIds: excludedIds,
      },
    };
  };

  const buildAskPayloadFromStored = (stored: StoredComposerState, turnMode: Live["mode"], conversationId: string) => {
    const sectionRefsFromStored = references.flatMap((r) => {
      const picked = stored.sectionPicks[r.id] ?? [];
      if (!picked.length) return [];
      const parent = new Map(r.sections.map((s) => [s.id, s.parentId]));
      const insidePicked = (id: string) => {
        for (let p = parent.get(id); p; p = parent.get(p)) if (picked.includes(p)) return true;
        return false;
      };
      const chosen = r.sections.filter((s) => picked.includes(s.id) && !insidePicked(s.id));
      return chosen.length ? [{ record: r, chosen }] : [];
    });
    const refs = [
      ...stored.selectedRefs.flatMap((id) => {
        const r = byId.get(id);
        return r ? [{ recordId: id, revision: r.currentRevision }] : [];
      }),
      ...sectionRefsFromStored.map(({ record, chosen }) => ({
        recordId: record.id,
        revision: record.currentRevision,
        sections: chosen.map((s) => s.id),
      })),
    ];
    const manuscript =
      stored.chapterRecordId && chapter?.recordId === stored.chapterRecordId
        ? {
            recordId: chapter.recordId,
            revision: chapter.revision,
            ...(stored.mode === "passage" && stored.passage ? { passage: stored.passage } : {}),
          }
        : !stored.chapterRecordId
          ? null
          : null;
    return {
      kind: "ask" as const,
      mode: turnMode,
      conversationId,
      question: stored.question,
      retrievalScope: stored.retrievalScope,
      enableTools: turnMode === "chat" ? stored.enableTools : false,
      write: null,
      selection: {
        references: refs,
        manuscript,
        includeMessageIds: stored.includeIds,
        excludeRecordIds: stored.excludedIds,
      },
    };
  };

  useEffect(() => {
    const stored = pendingHomeSendRef.current;
    if (!conversation || !stored?.pendingAction) return;
    if (stored.chapterRecordId && (!chapter || chapter.recordId !== stored.chapterRecordId)) return;
    const turnMode = stored.pendingAction;
    pendingHomeSendRef.current = null;
    void submit(buildAskPayloadFromStored(stored, turnMode, conversation.id), stored.question, turnMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation, chapter, byId]);

  const send = (turnMode: Live["mode"]) => {
    if (!question.trim()) {
      setError({
        code: "INVALID_REQUEST",
        message: turnMode === "proposal" ? "Describe the changes to prepare first." : "Type a question first.",
      });
      return;
    }
    if (isHome) {
      void (async () => {
        const created = await newConversationForRailAction(projectId);
        if (!created.ok) {
          setError({ code: "BUSY", message: created.message });
          return;
        }
        saveComposerState(projectId, created.id, snapshotComposerState(turnMode));
        router.push(`/projects/${projectId}/assistant?c=${encodeURIComponent(created.id)}`);
      })();
      return;
    }
    if (!conversation) return;
    void submit(buildAskPayload(turnMode, conversation.id), question, turnMode);
  };

  const retry = (m: MessageView) => {
    if (!conversation) return;
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

  const includableIds = messages.filter(includable).map((m) => m.id);
  const chosenCount = summary.items.length + summary.earlierCount;
  const draftLabel =
    props.drafts?.find((d) => d.id === props.draftScopeId)?.label ??
    (props.drafts?.length ? DRAFT.selectDraft : ASSISTANT.draftScopeNone);
  const chaptersByDraft = useMemo(() => {
    const groups = new Map<string, SelectableRecord[]>();
    for (const r of chapters) {
      const key = r.draftId ?? "";
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    return groups;
  }, [chapters]);
  const budgetUsed = budgetedIds.reduce((n, id) => n + (messageById.get(id)?.content.length ?? 0), 0);

  const contextHeading = isWorkbench ? ASSISTANT.thisQuestionHeading : ASSISTANT.contextHeading;

  return (
    <div
      className={`assistant-main${isWorkbench ? " assistant-main-workbench" : " assistant-main-home"}${rail.visible ? "" : " context-hidden"}`}
    >
      <section
        className="panel assistant-chat"
        aria-label={conversation?.title ?? ASSISTANT.heading}
      >
        {isWorkbench && conversation ? (
          <div className="row assistant-chat-head">
            <ContextRailToggle
              rail={rail}
              controls={contextId}
              showLabel={ASSISTANT.attachContext}
              hideLabel={ASSISTANT.hideContext}
            />
            <DeleteConversation projectId={projectId} conversationId={conversation.id} />
          </div>
        ) : null}
        {!isHome && <p className="small muted">{ASSISTANT.proposalsNote}</p>}

        {!isHome ? (
          <ol className="transcript" aria-label="Conversation" ref={transcriptRef}>
            {messages.length === 0 && !live ? <li className="small muted">{ASSISTANT.emptyConversation}</li> : null}
            {messages.map((m) => (
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
            <div className="message-text">
              {m.role === "assistant" ? (
                <AssistantAnswer text={m.content} />
              ) : (
                m.content || null
              )}
            </div>
            {props.proposals[m.id] ? <ProposalCard projectId={projectId} proposal={props.proposals[m.id]} /> : null}
            {m.role === "assistant" ? <SourcePills projectId={projectId} items={m.contextItems} sources={m.retrieval?.sources} /> : null}
            {m.role === "assistant" ? <AnswerDetails projectId={projectId} m={m} /> : null}
            {m.role === "assistant" && (m.status === "failed" || m.status === "cancelled") ? (
              <div className="row">
                {m.errorMessage ? (
                  <Banner tone={m.status === "failed" ? "error" : "info"}>{m.errorMessage}</Banner>
                ) : null}
                <Button type="button" variant="secondary" disabled={!props.configured || busy || streamingStored} onClick={() => retry(m)}>
                  {ASSISTANT.retry}
                </Button>
              </div>
            ) : null}
            {m.role === "assistant" && m.status === "incomplete" && m.errorMessage ? (
              <Banner tone="info">{m.errorMessage}</Banner>
            ) : null}
            {m.role === "assistant" && m.status === "streaming" && !busy ? (
              <div className="row small">
                <span>This answer is still running or was interrupted.</span>
                <Button type="button" variant="secondary" onClick={() => cancelStored(m.id)}>
                  {ASSISTANT.cancel}
                </Button>
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
                <Button type="button" variant="secondary" onClick={cancel}>
                  {ASSISTANT.cancel}
                </Button>
              </div>
              <div className="message-text">
                <AssistantAnswer text={live.text} />
              </div>
            </li>
          </>
        ) : null}
          </ol>
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

      {props.configured ? (
        <div className="stack assistant-composer">
          <div className="row small composer-context">
            <span>
              {chosenCount ? ASSISTANT.composerIncluded(chosenCount) : ASSISTANT.composerNothing} {ASSISTANT.composerSize(fmt(summary.total), fmt(props.maxInputChars))}
            </span>
            <Button type="button" variant="secondary" onClick={() => rail.toggle()}>
              {ASSISTANT.attachContext}
            </Button>
            <ContextRailToggle
              rail={rail}
              controls={contextId}
              showLabel={ASSISTANT.attachContext}
              hideLabel={ASSISTANT.hideContext}
            />
          </div>
          {overLimit ? (
            <p className="error-text small">Over the limit. Remove records or earlier messages, or use a shorter passage. Nothing is cut automatically.</p>
          ) : null}
          {passageMissing ? <p className="error-text small">Select a passage, or switch to {ASSISTANT.wholeChapter}.</p> : null}
          <label>
            <span className="sr-only">{ASSISTANT.question}</span>
            <textarea
              ref={questionRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={busy}
              placeholder={ASSISTANT.composerPlaceholder}
              style={{ minHeight: "5.5rem" }}
              spellCheck
            />
          </label>
          <div className="row">
            <Button type="button" onClick={() => send("chat")} disabled={busy || streamingStored || overLimit || passageMissing}>
              {ASSISTANT.send}
            </Button>
            <Button
              type="button"
             
              onClick={() => send("proposal")}
              disabled={busy || streamingStored || proposalOverLimit || passageMissing}
             variant="secondary">
              {ASSISTANT.prepare}
            </Button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {ASSISTANT.sendHint} {ASSISTANT.prepareHint}
          </p>
        </div>
      ) : null}
    </section>

      {props.configured ? (
        <ContextRail id={contextId} labelledBy={contextTitleId} rail={rail} className="assistant-context" focusOnOverlayOpen>
          <div className="stack">
            <div className="row assistant-context-head">
              <h3 id={contextTitleId} style={{ margin: 0 }}>
                {contextHeading}
              </h3>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {ASSISTANT.draftScope}: {draftLabel}
            </p>
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
                if (!rail.visible) rail.toggle();
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

            <fieldset disabled={busy} ref={manuscriptFieldRef}>
              <legend>{ASSISTANT.manuscript}</legend>
              <label>
                Chapter
                <select value={chapter?.recordId ?? ""} onChange={(e) => void chooseChapter(e.target.value)}>
                  <option value="">{ASSISTANT.noManuscript}</option>
                  {props.drafts && props.drafts.length > 0
                    ? props.drafts.map((d) => (
                        <optgroup key={d.id} label={`${d.label}${d.kind === "zero_draft" ? ` (${DRAFT.zeroDraft})` : d.kind === "author_manuscript" ? ` (${DRAFT.authorManuscript})` : ""}`}>
                          {(chaptersByDraft.get(d.id) ?? []).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.title} (rev {r.currentRevision}, {fmt(r.chars)} characters)
                            </option>
                          ))}
                        </optgroup>
                      ))
                    : chapters.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title} (rev {r.currentRevision}, {fmt(r.chars)} characters)
                        </option>
                      ))}
                  {(chaptersByDraft.get("") ?? []).map((r) => (
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
                        <Button type="button" onClick={takePassage} variant="secondary">
                          {ASSISTANT.usePassage}
                        </Button>
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
              {props.settings.autoIncludeRecent ? (
                <p className="small muted">
                  {ASSISTANT.budgetedRecent}: {budgetedIds.length} message
                  {budgetedIds.length === 1 ? "" : "s"}, {fmt(budgetUsed)} of {fmt(props.settings.recentContextBudgetChars)} characters.
                  You can still untick before sending.
                </p>
              ) : null}
              <div className="row">
                <Button type="button" onClick={() => setIncludeIds(includableIds)} disabled={!includableIds.length} variant="secondary">
                  {ASSISTANT.includeAll}
                </Button>
                <Button type="button" onClick={() => setIncludeIds([])} disabled={!includeIds.length} variant="secondary">
                  {ASSISTANT.includeNone}
                </Button>
              </div>
            </fieldset>

            {isWorkbench && conversation ? (
              <details className="assistant-summary-details">
                <summary>{ASSISTANT.conversationSummary}</summary>
                <ConversationSummaryEditor
                  projectId={projectId}
                  conversationId={conversation.id}
                  initialSummary={conversation.summary}
                  disabled={busy}
                />
              </details>
            ) : null}

            {props.onOpenSettings ? (
              <button type="button" className="linkish assistant-settings-link" onClick={props.onOpenSettings}>
                {ASSISTANT.modelUsageSettings}
              </button>
            ) : null}

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
          </div>
        </ContextRail>
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

function AnswerDetails({ projectId, m }: { projectId: string; m: MessageView }) {
  const passageItems = m.contextItems;
  const retrieval = m.retrieval;
  const originOf = (recordId: string) => retrieval?.sources.find((s) => s.recordId === recordId)?.origin;
  const extras = extraRetrievalSources(passageItems, retrieval?.sources);
  return (
    <div className="small muted answer-details">
      {passageItems.length ? (
        <p>
          {ASSISTANT.sourcesUsed}:{" "}
          {passageItems.map((c, i) => (
            <span key={`${c.recordId}-${c.kind}-${i}`}>
              {i > 0 ? "; " : ""}
              <Link href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(c.recordId)}`}>
                {c.title} rev {c.revisionNumber}
              </Link>
              {originOf(c.recordId) === "tool"
                ? " (tool)"
                : originOf(c.recordId) === "unsaved"
                  ? " (unsaved)"
                  : ""}
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
      ) : extras.length ? null : (
        <p>
          {ASSISTANT.sourcesUsed}: {ASSISTANT.sourcesNone}
        </p>
      )}
      {extras.length ? (
        <p>
          {passageItems.length ? null : <>{ASSISTANT.sourcesUsed}: </>}
          {extras.map((source, i) => {
            const href = retrievalSourceHref(projectId, source);
            const label = retrievalSourceLabel(source);
            return (
              <span key={`${source.eventId ?? source.mapId ?? source.recordId}-${i}`}>
                {i > 0 ? "; " : ""}
                {href ? <Link href={href}>{label}</Link> : label}
              </span>
            );
          })}
        </p>
      ) : null}
      {retrieval?.omissions.length ? (
        <p>
          {ASSISTANT.omissions}:{" "}
          {retrieval.omissions.map((o, i) => (
            <span key={`${o.label}-${i}`}>
              {i > 0 ? "; " : ""}
              {o.label} — {o.reason}
            </span>
          ))}
        </p>
      ) : null}
      {retrieval?.ambiguousNames.length ? (
        <p>
          {ASSISTANT.ambiguousName}: {retrieval.ambiguousNames.join(", ")}
        </p>
      ) : null}
      {retrieval?.insufficientEvidence ? <p className="error-text">{ASSISTANT.insufficientEvidence}</p> : null}
      {retrieval && retrieval.toolCallCount > 0 ? (
        <p>
          {ASSISTANT.toolCalls}: {retrieval.toolCallCount} ({retrieval.toolRoundCount} round
          {retrieval.toolRoundCount === 1 ? "" : "s"}, {retrieval.elapsedMs} ms). Scope: {retrieval.scope}.
        </p>
      ) : null}
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
