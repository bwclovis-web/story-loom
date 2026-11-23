"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
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
    <Button disabled={pending} onClick={() => startTransition(() => newConversationAction(projectId))}>
      {ASSISTANT.newConversation}
    </Button>
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
      <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} label={ASSISTANT.confirmDelete} />{" "}
      <Button type="button" variant="secondary" disabled={!confirmed || pending} onClick={remove}>
        {ASSISTANT.deleteConversation}
      </Button>
      {message ? <Banner tone="error">{message}</Banner> : null}
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
      <Button
        type="button"
        variant="secondary" size="sm"
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
      </Button>
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
      <Checkbox
        className="small"
        checked={autoIncludeRecent}
        disabled={pending}
        onChange={(e) => setAutoIncludeRecent(e.target.checked)}
        label={ASSISTANT.autoIncludeRecent}
      />
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
      <Button
        type="button"
        variant="secondary" size="sm"
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
      </Button>
      {message ? <p className="error-text small">{message}</p> : null}
      {savedNote ? <p className="small muted">{savedNote}</p> : null}
    </details>
  );
}
