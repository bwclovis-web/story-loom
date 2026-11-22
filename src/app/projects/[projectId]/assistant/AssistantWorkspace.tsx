"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DraftOption } from "@/components/drafts/DraftControls";
import type { ProposalView } from "@/server/services/assistantProposalService";
import type {
  AssistantSettingsView,
  ConversationListItem,
  ConversationView,
  SelectableRecord,
} from "@/server/services/assistantService";
import type { PromptPresetView } from "@/server/services/promptPresetService";
import { ASSISTANT } from "@/ui/labels";
import { AssistantComposerProvider } from "./AssistantComposerBridge";
import { AssistantPanel } from "./AssistantPanel";
import { AssistantConversationToolbar } from "./AssistantConversationToolbar";
import { AssistantIncludedDisclosure } from "./AssistantIncludedDisclosure";
import { AssistantSettingsDialog } from "./AssistantSettingsDialog";
import { AssistantTaskChoices } from "./AssistantTaskChoices";
import { NewConversationButton } from "./ConversationControls";

export function AssistantWorkspace({
  projectId,
  configured,
  maxInputChars,
  proposalExtraChars,
  conversation,
  conversations,
  records,
  proposals,
  draftScopeId,
  drafts,
  activeDraftId,
  settings,
  usage,
  modelName,
  seedRecordId,
  consumeWriteHandoff,
  boardSeed,
  invalidConversationId,
  seedHint,
  boardHint,
  chatPresets = [],
}: {
  projectId: string;
  configured: boolean;
  chatPresets?: PromptPresetView[];
  maxInputChars: number;
  proposalExtraChars: number;
  conversation: ConversationView | null;
  conversations: ConversationListItem[];
  records: SelectableRecord[];
  proposals: Record<string, ProposalView>;
  draftScopeId: string | null;
  drafts: DraftOption[];
  activeDraftId: string | null;
  settings: AssistantSettingsView;
  usage: {
    monthTokens: number;
    monthlyTokenCap: number;
    monthStart: string;
    monthEstimatedTokens: number;
    requestsLastHour: number;
    maxRequestsPerHour: number;
  };
  modelName: string | null;
  seedRecordId: string | null;
  consumeWriteHandoff: boolean;
  boardSeed: React.ComponentProps<typeof AssistantPanel>["boardSeed"];
  invalidConversationId: boolean;
  seedHint: boolean;
  boardHint: string | null;
}) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const workbench = !!conversation;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((c) => c.title.toLowerCase().includes(needle));
  }, [conversations, search]);

  return (
    <div className={`assistant-workspace${workbench ? " assistant-workbench" : " assistant-home"}`}>
      <p className="assistant-discussion-note">{ASSISTANT.discussionNote}</p>
      <AssistantIncludedDisclosure />

      {!configured ? null : (
        <div className="assistant-settings-row">
          <button type="button" className="linkish assistant-settings-link" onClick={() => setSettingsOpen(true)}>
            {ASSISTANT.modelUsageSettings}
          </button>
        </div>
      )}

      <AssistantSettingsDialog
        projectId={projectId}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initial={settings}
        configured={configured}
        modelName={modelName}
        usage={usage}
        maxInputChars={maxInputChars}
      />

      {workbench ? (
        <AssistantConversationToolbar
          projectId={projectId}
          conversations={conversations}
          activeId={conversation.id}
          search={search}
          onSearch={setSearch}
          filtered={filtered}
          homeHref={base}
        />
      ) : (
        <h2 className="assistant-work-prompt">{ASSISTANT.workPrompt}</h2>
      )}

      {invalidConversationId ? (
        <p className="small muted" role="status">
          {ASSISTANT.invalidConversation}
        </p>
      ) : null}
      {seedHint ? (
        <p className="small muted">
          Open or start a conversation to find relevant context for the scene you came from.
        </p>
      ) : null}
      {boardHint ? <p className="small muted">{boardHint}</p> : null}

      {configured ? (
        <AssistantComposerProvider>
          {!workbench ? <AssistantTaskChoices /> : null}
          <AssistantPanel
            projectId={projectId}
            configured={configured}
            maxInputChars={maxInputChars}
            conversation={conversation}
            records={records}
            proposals={proposals}
            proposalExtraChars={proposalExtraChars}
            draftScopeId={draftScopeId}
            drafts={drafts}
            settings={settings}
            seedRecordId={seedRecordId}
            consumeWriteHandoff={consumeWriteHandoff}
            boardSeed={boardSeed}
            layout={workbench ? "workbench" : "home"}
            onOpenSettings={() => setSettingsOpen(true)}
            chatPresets={chatPresets}
          />
        </AssistantComposerProvider>
      ) : null}

      {!workbench ? (
        <section className="assistant-conversations-block" aria-labelledby="assistant-conversations-heading">
          <div className="assistant-conversations-head">
            <h2 id="assistant-conversations-heading">{ASSISTANT.yourConversations}</h2>
            <NewConversationButton projectId={projectId} />
          </div>
          <label className="assistant-conversation-search">
            <span className="sr-only">{ASSISTANT.searchConversations}</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={ASSISTANT.searchConversations}
              autoComplete="off"
            />
          </label>
          {conversations.length === 0 ? (
            <p className="small muted">{ASSISTANT.noConversationsYet}</p>
          ) : filtered.length === 0 ? (
            <p className="small muted">{ASSISTANT.noConversationMatches}</p>
          ) : (
            <ul className="assistant-conversation-cards">
              {filtered.map((c) => (
                <li key={c.id}>
                  <Link href={`${base}/assistant?c=${encodeURIComponent(c.id)}`} className="assistant-conversation-card">
                    <span className="assistant-conversation-card-title">{c.title}</span>
                    <span className="small muted">{ASSISTANT.conversationMeta(c.messageCount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}