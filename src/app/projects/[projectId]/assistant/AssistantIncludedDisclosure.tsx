"use client";

import { HelpHint } from "@/components/HelpHint";
import { ASSISTANT } from "@/ui/labels";

export function AssistantIncludedDisclosure() {
  return (
    <details className="assistant-included-disclosure small">
      <summary>
        {ASSISTANT.includedDisclosureLead} <span className="linkish">{ASSISTANT.whatIsIncluded}</span>
      </summary>
      <p style={{ margin: "0.5rem 0 0" }}>{ASSISTANT.privacyNote}</p>
      <HelpHint anchor="assistant" topic="the assistant">
        {ASSISTANT.readOnlyNote} Answers do not use your ChatGPT account, memory, conversations or Projects.
      </HelpHint>
      <p className="muted" style={{ margin: "0.5rem 0 0" }}>
        {ASSISTANT.toolsNote}
      </p>
    </details>
  );
}