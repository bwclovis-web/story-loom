import Link from "next/link";
import { notFound } from "next/navigation";
import { HelpHint } from "@/components/HelpHint";
import { getDb } from "@/server/db";
import { getAssistantConfig } from "@/server/assistantConfig";
import { findProject } from "@/server/services/projectService";
import { ASSISTANT_INSTRUCTIONS, fixedChars } from "@/assistant/prompt";
import { listProposalViews, type ProposalView } from "@/server/services/assistantProposalService";
import {
  AssistantError,
  PROPOSAL_SCHEMA_CHARS,
  getConversationView,
  listConversations,
  listSelectableRecords,
  usageSummary,
  type ConversationView,
} from "@/server/services/assistantService";
import { listManuscriptDrafts } from "@/server/services/draftService";
import { resolvePinScope } from "@/server/services/readingPinService";
import { ASSISTANT } from "@/ui/labels";
import { AssistantPanel } from "./AssistantPanel";
import { NewConversationButton } from "./ConversationControls";

export const dynamic = "force-dynamic";

export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ c?: string; seed?: string }>;
}) {
  const { projectId } = await params;
  const { c, seed } = await searchParams;
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();

  const { status } = getAssistantConfig();
  const [conversations, records, usage, drafts] = await Promise.all([
    listConversations(db, projectId),
    listSelectableRecords(db, projectId),
    usageSummary(db, status.limits),
    listManuscriptDrafts(db, projectId),
  ]);
  const draftScopeId = await resolvePinScope(db, projectId, drafts.find((d) => d.kind === "author_manuscript")?.id ?? drafts[0]?.id ?? null);

  let conversation: ConversationView | null = null;
  let proposals: Record<string, ProposalView> = {};
  const conversationId = c ?? (seed && conversations[0] ? conversations[0].id : undefined);
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
            seedRecordId={seed ?? null}
          />
        ) : (
          <section className="panel">
            <p>{c ? "That conversation is not in this project." : ASSISTANT.noConversation}</p>
            {seed ? (
              <p className="small muted">
                Open or start a conversation to find relevant context for the scene you came from.
              </p>
            ) : null}
          </section>
        )}
      </div>
    </div>
  );
}
