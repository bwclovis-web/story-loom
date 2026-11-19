"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { AssistantAnswer } from "@/components/assistant/AssistantAnswer";
import { loadAssistantDraft, saveAssistantDraft } from "@/components/assistant/assistantDraft";
import { ProposalSummaryCard } from "@/components/assistant/ProposalSummaryCard";
import { SourcePills } from "@/components/assistant/SourcePills";
import {
  AttachIcon,
  BranchIcon,
  CloseIcon,
  ExpandCornersIcon,
  ListRowsIcon,
  MemoryIcon,
  SearchIcon,
  SendIcon,
  SparkleIcon,
} from "@/components/shell/icons";
import { ActionChip } from "@/components/ui/ActionChip";
import { Button } from "@/components/ui/Button";
import { IconButton, iconButtonVariants } from "@/components/ui/IconButton";
import { cn } from "@/ui/cn";
import { PillLabel, PillSelect } from "@/components/ui/Pill";
import type { RetrievalScope } from "@/assistant/tools";
import type { ProposalView } from "@/server/services/assistantProposalService";
import type { ConversationView, MessageView } from "@/server/services/assistantService";
import { ASSISTANT } from "@/ui/labels";
import {
  loadAssistantRailAction,
  loadManuscriptAction,
  newConversationForRailAction,
  saveConversationSummaryAction,
} from "@/app/projects/[projectId]/assistant/actions";

type Live = { mode: "chat" | "proposal"; question: string; assistantMessageId: string | null; text: string };

const CONTINUITY = "Check continuity: does anything in the earlier manuscript or references conflict with what is on this page?";
const EXPLORE = "Explore options: what plausible directions could this scene take, given the included sources? List proposals separately from canon.";

export function WriteAssistantRail({
  projectId,
  recordId,
  recordTitle,
  draftScopeId,
  draftLabel,
  editorText,
  editorDirty,
  editorSelection,
  configured,
  configProblems,
  onClose,
  onOpenInclude,
}: {
  projectId: string;
  recordId: string;
  recordTitle: string;
  draftScopeId: string | null;
  draftLabel: string;
  editorText: string;
  editorDirty: boolean;
  editorSelection: { start: number; end: number };
  configured: boolean;
  configProblems: string[];
  onClose: () => void;
  /** Opens the Include / references surface on the expanded page or local include. */
  onOpenInclude?: () => void;
}) {
  const router = useRouter();
  const reactId = useId();
  const [pending, startTransition] = useTransition();
  const [conversations, setConversations] = useState<Array<{ id: string; title: string }>>([]);
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [proposals, setProposals] = useState<Record<string, ProposalView>>({});
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<RetrievalScope>("book");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [coverageOpen, setCoverageOpen] = useState<string | null>(null);
  const [includeUnsaved, setIncludeUnsaved] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  const contextSummary = useMemo(() => {
    const title = recordTitle || "This page";
    const passage = editorSelection.end > editorSelection.start;
    const lastAssistant = [...(conversation?.messages ?? [])].reverse().find((m) => m.role === "assistant");
    const refs = lastAssistant?.contextItems.length ?? 0;
    if (refs > 0) {
      return `${title} + ${refs} reference${refs === 1 ? "" : "s"}`;
    }
    const bits = [title];
    if (passage) bits.push("passage");
    if (includeUnsaved && editorDirty) bits.push("unsaved");
    return bits.join(" · ");
  }, [recordTitle, editorSelection, includeUnsaved, editorDirty, conversation?.messages]);

  const persistDraft = useCallback(
    (next: { conversationId: string | null; question: string; scope: RetrievalScope }) => {
      saveAssistantDraft(projectId, next);
    },
    [projectId],
  );

  const loadConversation = useCallback(
    (conversationId: string | null) => {
      startTransition(async () => {
        const result = await loadAssistantRailAction(projectId, conversationId);
        if (!result.ok) {
          setLoadError(result.message);
          return;
        }
        setLoadError(null);
        setConversations(result.conversations);
        setConversation(result.conversation);
        setProposals(result.proposals);
        setSummary(result.conversation?.summary ?? "");
        if (result.conversation) {
          persistDraft({ conversationId: result.conversation.id, question, scope });
        }
      });
    },
    [projectId, persistDraft, question, scope],
  );

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const draft = loadAssistantDraft(projectId);
    if (draft) {
      setQuestion(draft.question);
      setScope(draft.scope);
    }
    loadConversation(draft?.conversationId ?? null);
  }, [projectId, loadConversation]);

  useEffect(() => {
    persistDraft({ conversationId: conversation?.id ?? null, question, scope });
  }, [conversation?.id, question, scope, persistDraft]);

  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [conversation?.messages.length, live?.text]);

  const ensureConversation = async (): Promise<string | null> => {
    if (conversation) return conversation.id;
    const created = await newConversationForRailAction(projectId);
    if (!created.ok) {
      setError(created.message);
      return null;
    }
    setConversations((prev) => [{ id: created.id, title: created.title }, ...prev]);
    const loadedConv = await loadAssistantRailAction(projectId, created.id);
    if (loadedConv.ok) {
      setConversation(loadedConv.conversation);
      setProposals(loadedConv.proposals);
      setSummary(loadedConv.conversation?.summary ?? "");
    }
    return created.id;
  };

  const submit = async (mode: "chat" | "proposal", text: string) => {
    if (!configured) {
      setError(ASSISTANT.notConfigured);
      return;
    }
    const q = text.trim();
    if (!q) return;
    setError(null);
    const conversationId = await ensureConversation();
    if (!conversationId) return;

    const passage =
      editorSelection.end > editorSelection.start
        ? { start: editorSelection.start, end: editorSelection.end }
        : undefined;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLive({ mode, question: q, assistantMessageId: null, text: "" });

    try {
      const ms = await loadManuscriptAction(projectId, recordId);
      const manuscript =
        ms.ok && !includeUnsaved
          ? {
              recordId: ms.recordId,
              revision: ms.revision,
              ...(passage && !editorDirty ? { passage } : {}),
            }
          : null;

      const response = await fetch(`/api/projects/${projectId}/assistant/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          kind: "ask",
          mode,
          conversationId,
          question: q,
          retrievalScope: scope,
          enableTools: mode === "chat",
          write: {
            recordId,
            draftId: draftScopeId,
            passage,
            includeUnsavedProse: includeUnsaved && editorDirty,
            unsavedBody: includeUnsaved && editorDirty ? editorText : null,
          },
          selection: {
            references: [],
            manuscript,
            includeMessageIds: [],
          },
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(body?.error?.message ?? "The request failed.");
        setLive(null);
        return;
      }
      await consumeStream(response);
      setQuestion("");
      loadConversation(conversationId);
    } catch {
      if (!ac.signal.aborted) setError("The connection was lost.");
    } finally {
      setLive(null);
      abortRef.current = null;
    }
  };

  async function consumeStream(response: Response) {
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line) as { type: string; text?: string; assistantMessageId?: string };
        if (event.type === "started") {
          setLive((l) => (l ? { ...l, assistantMessageId: event.assistantMessageId ?? null } : l));
        } else if (event.type === "delta" && event.text) {
          const piece = event.text;
          setLive((l) => (l ? { ...l, text: l.text + piece } : l));
        }
      }
    }
  }

  const cancel = async () => {
    const id = live?.assistantMessageId;
    if (id) {
      await fetch(`/api/projects/${projectId}/assistant/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: id }),
      }).catch(() => abortRef.current?.abort());
    } else abortRef.current?.abort();
  };

  const expandHref = conversation
    ? `/projects/${encodeURIComponent(projectId)}/assistant?c=${encodeURIComponent(conversation.id)}&seed=${encodeURIComponent(recordId)}`
    : `/projects/${encodeURIComponent(projectId)}/assistant?seed=${encodeURIComponent(recordId)}`;

  const saveMemory = () => {
    if (!conversation) return;
    startTransition(async () => {
      const result = await saveConversationSummaryAction(projectId, conversation.id, summary);
      if (!result.ok) setError(result.message);
      else setMemoryOpen(false);
    });
  };

  const messages = conversation?.messages ?? [];

  return (
    <div className="assistant-rail">
      <header className="assistant-rail-head">
        <div className="assistant-rail-title">
          <SparkleIcon />
          <h2 id={`${reactId}-title`}>{ASSISTANT.heading}</h2>
        </div>
        <div className="assistant-rail-actions">
          <IconButton
            tip="end"
            aria-expanded={memoryOpen}
            aria-label={ASSISTANT.memory}
            disabled={!conversation}
            onClick={() => setMemoryOpen((o) => !o)}
          >
            <MemoryIcon />
          </IconButton>
          <Link
            className={cn(iconButtonVariants({ tip: "end" }))}
            href={expandHref}
            aria-label={ASSISTANT.expand}
            data-tooltip={ASSISTANT.expand}
            onClick={() => persistDraft({ conversationId: conversation?.id ?? null, question, scope })}
          >
            <ExpandCornersIcon />
          </Link>
          <IconButton tip="end" aria-label={ASSISTANT.closeRail} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
      </header>

      <div className="assistant-rail-toolbar">
        <label className="assistant-rail-select">
          <span className="visually-hidden">{ASSISTANT.conversations}</span>
          <select
            value={conversation?.id ?? ""}
            disabled={pending || live !== null}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return;
              loadConversation(id);
            }}
          >
            {!conversation ? <option value="">{ASSISTANT.noConversation}</option> : null}
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          size="sm"
          disabled={pending || live !== null}
          onClick={() => {
            startTransition(async () => {
              const created = await newConversationForRailAction(projectId);
              if (!created.ok) {
                setError(created.message);
                return;
              }
              loadConversation(created.id);
            });
          }}
        >
          {ASSISTANT.newConversation}
        </Button>
      </div>

      <div className="assistant-scope-row">
        <PillSelect
          label={ASSISTANT.retrievalScope}
          value={scope}
          onChange={(e) => setScope(e.target.value as RetrievalScope)}
          disabled={live !== null}
        >
          <option value="chapter">{ASSISTANT.scopeChapter}</option>
          <option value="book">{ASSISTANT.scopeBook}</option>
          <option value="series">{ASSISTANT.scopeSeries}</option>
        </PillSelect>
        <PillLabel title={draftLabel}>
          {recordTitle} · {draftLabel}
        </PillLabel>
      </div>

      {memoryOpen && conversation ? (
        <div className="assistant-memory panel stack">
          <p className="small muted">{ASSISTANT.conversationSummaryHint}</p>
          <textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} aria-label={ASSISTANT.conversationSummary} />
          <div className="row">
            <Button type="button" size="sm" disabled={pending} onClick={saveMemory}>
              {ASSISTANT.saveSummary}
            </Button>
            <Button type="button" size="sm" onClick={() => setMemoryOpen(false)}>
              {ASSISTANT.cancel}
            </Button>
          </div>
        </div>
      ) : null}

      {!configured ? (
        <div className="assistant-rail-empty">
          <p>{ASSISTANT.notConfigured}</p>
          <ul className="small">
            {configProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {loadError ? <p className="error-text small">{loadError}</p> : null}

      <div className="assistant-rail-stream" ref={streamRef} tabIndex={0} aria-label={ASSISTANT.heading}>
        {!messages.length && !live ? (
          <p className="small muted assistant-rail-empty">{ASSISTANT.emptyConversation}</p>
        ) : null}
        {messages.map((m) => (
          <RailMessage
            key={m.id}
            projectId={projectId}
            conversationId={conversation!.id}
            message={m}
            proposal={proposals[m.id]}
            coverageOpen={coverageOpen === m.id}
            onToggleCoverage={() => setCoverageOpen((id) => (id === m.id ? null : m.id))}
          />
        ))}
        {live ? (
          <div className="assistant-msg assistant-msg-assistant" aria-live="polite">
            <p className="assistant-msg-user-echo small">{live.question}</p>
            <AssistantAnswer text={live.text || "…"} />
          </div>
        ) : null}
      </div>

      <div className="assistant-rail-suggestions" role="group" aria-label={ASSISTANT.suggestions}>
        <ActionChip disabled={!!live || !configured} onClick={() => void submit("chat", CONTINUITY)}>
          <SearchIcon /> {ASSISTANT.checkContinuity}
        </ActionChip>
        <ActionChip disabled={!!live || !configured} onClick={() => void submit("chat", EXPLORE)}>
          <BranchIcon /> {ASSISTANT.exploreOptions}
        </ActionChip>
        <ActionChip
          disabled={!!live || !configured}
          onClick={() => void submit("proposal", question.trim() || ASSISTANT.prepareHint)}
        >
          <ListRowsIcon /> {ASSISTANT.prepareChanges}
        </ActionChip>
      </div>

      <div className="assistant-rail-composer">
        {editorDirty ? (
          <label className="check-row small">
            <input type="checkbox" checked={includeUnsaved} onChange={(e) => setIncludeUnsaved(e.target.checked)} disabled={!!live} />
            <span>{ASSISTANT.includeUnsavedProse}</span>
          </label>
        ) : null}
        <textarea
          rows={3}
          value={question}
          placeholder={ASSISTANT.composerPlaceholder}
          disabled={!!live || !configured}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit("chat", question);
            }
          }}
          aria-label={ASSISTANT.question}
        />
        <div className="assistant-composer-bar">
          <button type="button" className="assistant-context-summary" onClick={() => (onOpenInclude ? onOpenInclude() : router.push(expandHref))}>
            {contextSummary}
          </button>
          <div className="assistant-composer-actions">
            <Button
              variant="ghost"
              size="icon"
              className="tip tip-end"
              aria-label={ASSISTANT.attachContext}
              data-tooltip={ASSISTANT.attachContext}
              disabled={!!live}
              onClick={() => (onOpenInclude ? onOpenInclude() : router.push(expandHref))}
            >
              <AttachIcon />
            </Button>
            {live ? (
              <Button variant="primary" size="sm" onClick={() => void cancel()} aria-label={ASSISTANT.stop}>
                {ASSISTANT.stop}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="icon"
                disabled={!configured || !question.trim()}
                onClick={() => void submit("chat", question)}
                aria-label={ASSISTANT.send}
              >
                <SendIcon />
              </Button>
            )}
          </div>
        </div>
        {error ? <p className="error-text small">{error}</p> : null}
      </div>
    </div>
  );
}

function RailMessage({
  projectId,
  conversationId,
  message: m,
  proposal,
  coverageOpen,
  onToggleCoverage,
}: {
  projectId: string;
  conversationId: string;
  message: MessageView;
  proposal?: ProposalView;
  coverageOpen: boolean;
  onToggleCoverage: () => void;
}) {
  if (m.role === "user") {
    return (
      <div className="assistant-msg assistant-msg-user">
        <p>{m.content}</p>
      </div>
    );
  }
  const expandCoverageHref = `/projects/${encodeURIComponent(projectId)}/assistant?c=${encodeURIComponent(conversationId)}`;
  return (
    <div className="assistant-msg assistant-msg-assistant">
      {m.basedOnOlderVersions ? <p className="badge warn">{ASSISTANT.olderVersion}</p> : null}
      <AssistantAnswer text={m.content} />
      <SourcePills projectId={projectId} items={m.contextItems} />
      <div className="assistant-coverage-row">
        <button type="button" className="assistant-coverage-toggle" aria-expanded={coverageOpen} onClick={onToggleCoverage}>
          ▾ {ASSISTANT.sourcesUsed} · {m.contextItems.length} {m.contextItems.length === 1 ? "record" : "records"}
        </button>
        {m.contextItems.length ? (
          <button type="button" className="assistant-coverage-toggle" onClick={onToggleCoverage}>
            {ASSISTANT.viewCoverage}
          </button>
        ) : (
          <Link className="small" href={expandCoverageHref}>
            {ASSISTANT.expand}
          </Link>
        )}
      </div>
      {coverageOpen ? (
        <ul className="assistant-coverage-list small">
          {m.contextItems.map((c, i) => (
            <li key={`${c.recordId}-cov-${i}`}>
              <Link href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(c.recordId)}`}>
                {c.title} rev {c.revisionNumber}
                {c.passageStart != null && c.passageEnd != null ? ` (${c.passageEnd - c.passageStart} characters)` : ""}
                {c.olderVersion ? ` — now rev ${c.currentRevision}` : ""}
              </Link>
            </li>
          ))}
          {m.retrieval?.omissions.map((o, i) => (
            <li key={`om-${i}`} className="muted">
              {ASSISTANT.omissions}: {o.label} — {o.reason}
            </li>
          ))}
        </ul>
      ) : null}
      {proposal ? <ProposalSummaryCard projectId={projectId} proposal={proposal} /> : null}
      {m.status === "failed" || m.status === "cancelled" ? (
        <p className="error-text small">{m.errorMessage ?? m.status}</p>
      ) : null}
    </div>
  );
}
