"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ASSISTANT } from "@/ui/labels";
import {
  deleteConversationAction,
  newConversationAction,
  saveAssistantSettingsAction,
  saveConversationSummaryAction,
} from "./actions";

export function NewConversationButton({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => startTransition(() => newConversationAction(projectId))}>
      {ASSISTANT.newConversation}
    </button>
  );
}

export function DeleteConversation({ projectId, conversationId }: { projectId: string; conversationId: string }) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const remove = () =>
    startTransition(async () => {
      const result = await deleteConversationAction(projectId, conversationId);
      if (!result.ok) {
        setMessage(result.message ?? "Could not delete.");
        return;
      }
      router.push(`/projects/${projectId}/assistant`);
    });

  return (
    <details className="small">
      <summary>{ASSISTANT.deleteConversation}</summary>
      <p>Deletes the questions and answers stored in this app. Records are not affected. It cannot be undone.</p>
      <label className="inline">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        {ASSISTANT.confirmDelete}
      </label>{" "}
      <button type="button" className="secondary" disabled={!confirmed || pending} onClick={remove}>
        {ASSISTANT.deleteConversation}
      </button>
      {message ? <div className="banner error">{message}</div> : null}
    </details>
  );
}

export function ConversationSummaryEditor({
  projectId,
  conversationId,
  initialSummary,
  disabled,
}: {
  projectId: string;
  conversationId: string;
  initialSummary: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(initialSummary);
  const [saved, setSaved] = useState(initialSummary);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="stack">
      <label className="small">
        {ASSISTANT.conversationSummary}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled || pending}
          rows={3}
          spellCheck
        />
      </label>
      <p className="small muted" style={{ margin: 0 }}>
        {ASSISTANT.conversationSummaryHint}
      </p>
      <button
        type="button"
        className="secondary small-button"
        disabled={disabled || pending || text === saved}
        onClick={() =>
          startTransition(async () => {
            const result = await saveConversationSummaryAction(projectId, conversationId, text);
            if (!result.ok) {
              setMessage(result.message);
              return;
            }
            setMessage("");
            setText(result.summary);
            setSaved(result.summary);
          })
        }
      >
        {ASSISTANT.saveSummary}
      </button>
      {message ? <p className="error-text small">{message}</p> : null}
    </div>
  );
}

export function AssistantSettingsPanel({
  projectId,
  initial,
}: {
  projectId: string;
  initial: { autoIncludeRecent: boolean; recentContextBudgetChars: number };
}) {
  const [autoIncludeRecent, setAutoIncludeRecent] = useState(initial.autoIncludeRecent);
  const [budget, setBudget] = useState(String(initial.recentContextBudgetChars));
  const [message, setMessage] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <details className="stack">
      <summary>{ASSISTANT.assistantSettings}</summary>
      <p className="small muted">{ASSISTANT.assistantSettingsHint}</p>
      <label className="inline small">
        <input
          type="checkbox"
          checked={autoIncludeRecent}
          disabled={pending}
          onChange={(e) => setAutoIncludeRecent(e.target.checked)}
        />
        {ASSISTANT.autoIncludeRecent}
      </label>
      <p className="small muted" style={{ margin: 0 }}>
        {ASSISTANT.autoIncludeRecentHint}
      </p>
      <label className="small">
        {ASSISTANT.recentContextBudget}
        <input
          type="number"
          min={2000}
          max={50000}
          step={500}
          value={budget}
          disabled={pending}
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="secondary small-button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await saveAssistantSettingsAction(projectId, {
              autoIncludeRecent,
              recentContextBudgetChars: Number(budget) || 8000,
            });
            if (!result.ok) {
              setMessage(result.message);
              setSavedNote("");
              return;
            }
            setMessage("");
            setAutoIncludeRecent(result.settings.autoIncludeRecent);
            setBudget(String(result.settings.recentContextBudgetChars));
            setSavedNote("Saved.");
          })
        }
      >
        {ASSISTANT.saveSettings}
      </button>
      {message ? <p className="error-text small">{message}</p> : null}
      {savedNote ? <p className="small muted">{savedNote}</p> : null}
    </details>
  );
}
