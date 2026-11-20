"use client";

import { useId } from "react";
import { Drawer } from "@/components/shell/Drawer";
import type { AssistantSettingsView } from "@/server/services/assistantService";
import { ASSISTANT } from "@/ui/labels";
import { AssistantSettingsPanel } from "./ConversationControls";

export function AssistantSettingsDialog({
  projectId,
  open,
  onClose,
  initial,
  configured,
  modelName,
  usage,
  maxInputChars,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  initial: AssistantSettingsView;
  configured: boolean;
  modelName: string | null;
  usage: {
    monthTokens: number;
    monthlyTokenCap: number;
    monthStart: string;
    monthEstimatedTokens: number;
    requestsLastHour: number;
    maxRequestsPerHour: number;
  };
  maxInputChars: number;
}) {
  const id = useId().replace(/:/g, "");
  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <Drawer id={`assistant-settings-${id}`} label={ASSISTANT.modelUsageSettings} closeLabel="Close" open={open} onClose={onClose}>
      <div className="stack assistant-settings-dialog">
        <h2 style={{ marginTop: 0 }}>{ASSISTANT.modelUsageSettings}</h2>
        <AssistantSettingsPanel projectId={projectId} initial={initial} />
        {configured ? (
          <div className="small stack">
            <p style={{ margin: 0 }}>
              Model: <code>{modelName}</code>. Up to {fmt(maxInputChars)} characters per question.
            </p>
            <strong>{ASSISTANT.usageHeading}</strong>
            <p>
              {fmt(usage.monthTokens)} of {fmt(usage.monthlyTokenCap)} tokens (this app&apos;s cap, counted from{" "}
              {usage.monthStart.slice(0, 10)} UTC)
              {usage.monthEstimatedTokens > 0
                ? `, including about ${fmt(usage.monthEstimatedTokens)} estimated for cancelled or unreported requests`
                : ""}
              .
            </p>
            <p>
              {usage.requestsLastHour} of {usage.maxRequestsPerHour} requests in the last hour. Answers, change proposals
              and proofreading all count.
            </p>
            <p className="muted">These are this app&apos;s own counts, not your OpenAI bill.</p>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}