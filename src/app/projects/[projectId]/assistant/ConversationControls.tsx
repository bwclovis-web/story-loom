"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ASSISTANT } from "@/ui/labels";
import { deleteConversationAction, newConversationAction } from "./actions";

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
