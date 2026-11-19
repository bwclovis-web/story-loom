import Link from "next/link";
import { notFound } from "next/navigation";
import { DraftScopeChip, type DraftOption } from "@/components/drafts/DraftControls";
import { HelpHint } from "@/components/HelpHint";
import { getDb } from "@/server/db";
import { getAssistantConfig } from "@/server/assistantConfig";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { findProject } from "@/server/services/projectService";
import { ASSISTANT_INSTRUCTIONS, fixedChars } from "@/assistant/prompt";
import { listProposalViews, type ProposalView } from "@/server/services/assistantProposalService";
import {
  AssistantError,
  PROPOSAL_SCHEMA_CHARS,
  getAssistantSettings,
  getConversationView,
  listConversations,
  listSelectableRecords,
  usageSummary,
  type ConversationView,
} from "@/server/services/assistantService";
import { previewBoardAskContext, type BoardAskPreview } from "@/server/services/establishedFactService";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { resolvePinScope } from "@/server/services/readingPinService";
import { ASSISTANT } from "@/ui/labels";
import { AssistantPanel } from "./AssistantPanel";
import { AssistantSettingsPanel, NewConversationButton } from "./ConversationControls";

export const dynamic = "force-dynamic";

export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ c?: string; seed?: string; board?: string }>;
}) {
  const { projectId } = await params;
  const { c, seed, board } = await searchParams;
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();

  const { status } = getAssistantConfig();
  const [conversations, records, usage, drafts, settings] = await Promise.all([
    listConversations(db, projectId),
    listSelectableRecords(db, projectId),
    usageSummary(db, status.limits),
    listManuscriptDrafts(db, projectId),
    getAssistantSettings(db, projectId),
  ]);
  const writeDraftCookie = await readWriteDraftCookie();
  const activeDraftId = resolveWriteDraftId(drafts, writeDraftCookie);
  const draftScopeId = await resolvePinScope(db, projectId, activeDraftId);
  const draftOptions: DraftOption[] = drafts.map((d) => ({
    id: d.id,
    kind: d.kind,
    label: d.label,
    completedAt: d.completedAt?.toISOString() ?? null,
  }));

  let boardPreview: BoardAskPreview | null = null;
  if (board) {
    try {
      boardPreview = await previewBoardAskContext(db, projectId, board);
    } catch {
      boardPreview = null;
    }
  }

  let conversation: ConversationView | null = null;
  let proposals: Record<string, ProposalView> = {};
  const conversationId =
    c ?? ((seed || boardPreview) && conversations[0] ? conversations[0].id : undefined);
  if (conversationId) {
    try {
      conversation = await getConversationView(db, projectId, conversationId, status.limits);
      proposals = await listProposalViews(db, projectId, conversation.id);
    } catch (error) {
      if (!(error instanceof AssistantError)) throw error;
    }
  }

  return (
    <div className="stack assistant-page">
      <h1>{ASSISTANT.heading}</h1>
      <DraftScopeChip drafts={draftOptions} activeDraftId={activeDraftId} />
      <p className="assistant-notice small">{ASSISTANT.privacyNote}</p>
      <HelpHint anchor="assistant" topic="the assistant">
        {ASSISTANT.readOnlyNote} Answers do not use your ChatGPT account, memory, conversations or Projects.
      </HelpHint>

      {!status.configured ? (
        <section className="panel">
          <h2>{ASSISTANT.notConfigured}</h2>
          <ul>
            {status.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <HelpHint anchor="assistant-setup" topic="assistant setup">
            Setup uses server settings in your <code>.env</code> file, not this page.
          </HelpHint>
        </section>
      ) : null}

      <div className="assistant-layout">
        <aside className="panel stack assistant-conversations">
          <h2>{ASSISTANT.conversations}</h2>
          <NewConversationButton projectId={projectId} />
          {conversations.length === 0 ? <p className="small muted">None yet.</p> : null}
          <ul className="conversation-list">
            {conversations.map((conv) => (
              <li key={conv.id}>
                <Link href={`/projects/${projectId}/assistant?c=${conv.id}`} aria-current={conv.id === conversation?.id ? "page" : undefined}>
                  {conv.title}
                </Link>{" "}
                <span className="small muted">({conv.messageCount})</span>
              </li>
            ))}
          </ul>
          <AssistantSettingsPanel projectId={projectId} initial={settings} />
          <div className="small">
            {status.configured ? (
              <p>
                Model: <code>{status.model}</code>. Up to {status.limits.maxInputChars.toLocaleString("en-US")} characters
                per question and {status.limits.maxOutputTokens.toLocaleString("en-US")} output tokens per answer.
              </p>
            ) : null}
            <strong>{ASSISTANT.usageHeading}</strong>
            <p>
              {usage.monthTokens.toLocaleString("en-US")} of {usage.monthlyTokenCap.toLocaleString("en-US")} tokens (this
              app&apos;s cap, counted from {usage.monthStart.slice(0, 10)} UTC)
              {usage.monthEstimatedTokens > 0
                ? `, including about ${usage.monthEstimatedTokens.toLocaleString("en-US")} estimated for cancelled or unreported requests`
                : ""}
              .
            </p>
            <p>
              {usage.requestsLastHour} of {usage.maxRequestsPerHour} requests in the last hour. Answers, change proposals and
              proofreading all count.
            </p>
            <p className="muted">These are this app&apos;s own counts, not your OpenAI bill.</p>
          </div>
        </aside>

        {conversation ? (
          <AssistantPanel
            key={conversation.id}
            projectId={projectId}
            configured={status.configured}
            maxInputChars={status.limits.maxInputChars}
            conversation={conversation}
            records={records}
            proposals={proposals}
            proposalExtraChars={fixedChars("proposal", PROPOSAL_SCHEMA_CHARS) - ASSISTANT_INSTRUCTIONS.length}
            draftScopeId={draftScopeId === "" ? null : draftScopeId}
            drafts={draftOptions}
            settings={settings}
            seedRecordId={seed ?? null}
            boardSeed={
              boardPreview
                ? {
                    boardId: boardPreview.boardId,
                    boardTitle: boardPreview.boardTitle,
                    suggestedPrompt: boardPreview.suggestedPrompt,
                    selectedRefs: boardPreview.records.map((r) => r.recordId),
                    sectionPicks: {},
                  }
                : null
            }
          />
        ) : (
          <section className="panel stack">
            <h2 style={{ marginTop: 0 }}>{ASSISTANT.getStarted}</h2>
            <p>{c ? "That conversation is not in this project." : ASSISTANT.noConversation}</p>
            <p className="small muted">{ASSISTANT.getStartedHint}</p>
            <NewConversationButton projectId={projectId} />
            {seed ? (
              <p className="small muted">
                Open or start a conversation to find relevant context for the scene you came from.
              </p>
            ) : null}
            {board && !boardPreview ? (
              <p className="small muted">That board was not found in this project.</p>
            ) : null}
            {boardPreview ? (
              <p className="small muted">
                Open or start a conversation to ask about the board &quot;{boardPreview.boardTitle}&quot;. Proposed
                updates still go through Review and Apply.
              </p>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}
