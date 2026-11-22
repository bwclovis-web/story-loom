import { notFound } from "next/navigation";
import { LandingHeader } from "@/components/library/LandingHeader";
import { DraftScopeChip, type DraftOption } from "@/components/drafts/DraftControls";
import { ProjectOnboarding } from "@/components/shell/ProjectOnboarding";
import { getDb } from "@/server/db";
import { getAssistantConfig } from "@/server/assistantConfig";
import { readWriteDraftCookie, resolveWriteDraftId } from "@/server/draftSelection";
import { listProjectCoverHashes } from "@/server/services/coverService";
import { findProject } from "@/server/services/projectService";
import { fixedChars } from "@/assistant/prompt";
import { ASSISTANT_INSTRUCTIONS } from "@/assistant/prompt";
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
import { listPromptPresets } from "@/server/services/promptPresetService";
import { ASSISTANT } from "@/ui/labels";
import { PromptPresetsPanel } from "./PromptPresetsPanel";
import { manuscriptEyebrow } from "@/ui/library";
import { AssistantWorkspace } from "./AssistantWorkspace";

export const dynamic = "force-dynamic";

export default async function AssistantPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ c?: string; seed?: string; board?: string; handoff?: string }>;
}) {
  const { projectId } = await params;
  const { c, seed, board, handoff } = await searchParams;
  const db = getDb();
  const { status } = getAssistantConfig();
  const [project, conversations, records, usage, drafts, settings, coverHashes, promptPresets] = await Promise.all([
    findProject(db, projectId),
    listConversations(db, projectId),
    listSelectableRecords(db, projectId),
    usageSummary(db, status.limits),
    listManuscriptDrafts(db, projectId),
    getAssistantSettings(db, projectId),
    listProjectCoverHashes(db, [projectId]),
    listPromptPresets(db, projectId),
  ]);
  const chatPresets = promptPresets.filter((p) => p.surface === "chat");
  if (!project) notFound();
  const coverHash = coverHashes.get(projectId) ?? null;
  const base = `/projects/${encodeURIComponent(projectId)}`;
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
  const autoOpen = (seed || boardPreview || handoff === "1") && !c;
  const conversationId = c ?? (autoOpen && conversations[0] ? conversations[0].id : undefined);
  if (conversationId) {
    try {
      conversation = await getConversationView(db, projectId, conversationId, status.limits);
      proposals = await listProposalViews(db, projectId, conversation.id);
    } catch (error) {
      if (!(error instanceof AssistantError)) throw error;
    }
  }

  const boardHint = board && !boardPreview
    ? "That board was not found in this project."
    : boardPreview && !conversation
      ? `Open or start a conversation to ask about the board "${boardPreview.boardTitle}". Proposed updates still go through Review and Apply.`
      : null;

  return (
    <div className="stack assistant-page">
      <LandingHeader
        projectId={projectId}
        title={project.title}
        eyebrow={manuscriptEyebrow(project.seriesName, project.workspace.name)}
        coverSrc={coverHash ? `${base}/cover?v=${coverHash}` : null}
        description={ASSISTANT.landingLead}
        gettingStarted={<ProjectOnboarding projectId={projectId} quiet marked />}
      />
      <DraftScopeChip drafts={draftOptions} activeDraftId={activeDraftId} />

      {!status.configured ? (
        <section className="panel">
          <h2>{ASSISTANT.notConfigured}</h2>
          <ul>
            {status.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {status.configured ? <PromptPresetsPanel projectId={projectId} presets={promptPresets} /> : null}

      <AssistantWorkspace
        projectId={projectId}
        configured={status.configured}
        chatPresets={chatPresets}
        maxInputChars={status.limits.maxInputChars}
        proposalExtraChars={fixedChars("proposal", PROPOSAL_SCHEMA_CHARS) - ASSISTANT_INSTRUCTIONS.length}
        conversation={conversation}
        conversations={conversations}
        records={records}
        proposals={proposals}
        draftScopeId={draftScopeId === "" ? null : draftScopeId}
        drafts={draftOptions}
        activeDraftId={activeDraftId}
        settings={settings}
        usage={usage}
        modelName={status.configured ? status.model : null}
        seedRecordId={seed ?? null}
        consumeWriteHandoff={handoff === "1"}
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
        invalidConversationId={!!c && !conversation}
        seedHint={!!seed && !conversation}
        boardHint={boardHint}
      />
    </div>
  );
}