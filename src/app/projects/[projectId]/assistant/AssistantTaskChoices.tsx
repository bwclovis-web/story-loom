"use client";

import { AssistantIcon } from "@/components/shell/icons";
import { ASSISTANT } from "@/ui/labels";
import { useAssistantComposerActions } from "./AssistantComposerBridge";

export function AssistantTaskChoices() {
  const actions = useAssistantComposerActions();

  return (
    <ul className="assistant-task-choices">
      <li>
        <button type="button" className="assistant-task-card" disabled={!actions} onClick={() => actions?.focusQuestion()}>
          <span className="assistant-task-icon" aria-hidden="true">
            <AssistantIcon />
          </span>
          <span className="assistant-task-text">
            <strong>{ASSISTANT.taskDiscussTitle}</strong>
            <span className="small muted">{ASSISTANT.taskDiscussHint}</span>
          </span>
        </button>
      </li>
      <li>
        <button
          type="button"
          className="assistant-task-card"
          disabled={!actions}
          onClick={() => actions?.openContextForPassage()}
        >
          <span className="assistant-task-icon" aria-hidden="true">
            <SearchPassageIcon />
          </span>
          <span className="assistant-task-text">
            <strong>{ASSISTANT.taskReviewTitle}</strong>
            <span className="small muted">{ASSISTANT.taskReviewHint}</span>
          </span>
        </button>
      </li>
      <li>
        <button
          type="button"
          className="assistant-task-card"
          disabled={!actions}
          onClick={() => actions?.openContextForProposal()}
        >
          <span className="assistant-task-icon" aria-hidden="true">
            <SwapIcon />
          </span>
          <span className="assistant-task-text">
            <strong>{ASSISTANT.taskPrepareTitle}</strong>
            <span className="small muted">{ASSISTANT.taskPrepareHint}</span>
          </span>
        </button>
      </li>
    </ul>
  );
}

function SearchPassageIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M14 4l4 4M9 13h6M9 17h4" />
      <circle cx="17" cy="17" r="3" />
      <path d="m19.5 19.5 1.5 1.5" />
    </svg>
  );
}

function SwapIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <path d="M7 7h11M7 7l3-3M7 7l3 3" />
      <path d="M17 17H6M17 17l-3 3M17 17l-3-3" />
    </svg>
  );
}