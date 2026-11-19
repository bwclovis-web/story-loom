import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { retrievalSourceHref } from "@/assistant/sourceHref";
import { emptyRetrievalMeta } from "@/assistant/retrievalMeta";
import type { AssistantProvider, ProviderRequest, ProviderRound } from "@/assistant/provider";
import { createConversation, getConversationView, prepareTurn, runTurn, updateConversationSummary } from "@/server/services/assistantService";
import { executeAssistantTool, type RetrievalContext } from "@/server/services/assistantRetrievalService";
import { startAuthorRewrite } from "@/server/services/draftService";
import { addRecordImages } from "@/server/services/imageService";
import { createRecord, updateRecord } from "@/server/services/recordService";
import { assignSceneLocation, listSceneLocationsForManuscript } from "@/server/services/sceneLocationService";
import {
  addStoryEventEvidence,
  createStoryEvent,
  linkStoryEventLocation,
  linkStoryEventScene,
  loadStoryTimeline,
  orderStoryEvents,
} from "@/server/services/storyEventService";
import { addWorldMapPin, createWorldMap } from "@/server/services/worldMapService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";

const SCENE = "rec_test_quay_scene";
const LATER = "rec_test_later_chapter";

const limits = {
  maxInputChars: 20_000,
  maxOutputTokens: 500,
  maxRequestsPerHour: 30,
  monthlyTokenCap: 1_000_000,
  requestTimeoutSeconds: 60,
  maxToolCalls: 4,
  maxToolRounds: 1,
  maxToolResultChars: 80_000,
};

describe("assistant story timeline tools", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("answers from constraints through the existing tool loop", async () => {
    await createRecord(t.db, IDS.project, {
      recordId: SCENE,
      type: "manuscript_scene",
      title: "The quay",
      body: "They argued on the stones.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    await createRecord(t.db, IDS.project, {
      recordId: LATER,
      type: "manuscript_chapter",
      title: "Chapter 2",
      body: "The quay was already ash.",
      authorityStatus: "draft",
    });
    await createRecord(t.db, IDS.project, {
      recordId: "rec_test_ash_scene",
      type: "manuscript_scene",
      title: "The ashes",
      body: "Nothing was left of the quay.",
      authorityStatus: "draft",
      parentRecordId: LATER,
    });
    const fire = await createStoryEvent(t.db, IDS.project, { title: "The fire", planned: true });
    const quarrel = await createStoryEvent(t.db, IDS.project, { title: "The quarrel", timeLabel: "before dawn" });
    await createStoryEvent(t.db, IDS.project, { title: "The rumor" });
    let detail = await loadStoryTimeline(t.db, IDS.project, { eventId: fire.id });
    await linkStoryEventLocation(t.db, IDS.project, fire.id, IDS.world, detail.selected!.revision);
    detail = await loadStoryTimeline(t.db, IDS.project, { eventId: fire.id });
    await linkStoryEventScene(t.db, IDS.project, fire.id, LATER, detail.selected!.revision);
    detail = await loadStoryTimeline(t.db, IDS.project, { eventId: fire.id });
    await linkStoryEventScene(t.db, IDS.project, fire.id, "rec_test_ash_scene", detail.selected!.revision);
    detail = await loadStoryTimeline(t.db, IDS.project, { eventId: quarrel.id });
    await linkStoryEventScene(t.db, IDS.project, quarrel.id, IDS.chapter, detail.selected!.revision);
    detail = await loadStoryTimeline(t.db, IDS.project, { eventId: fire.id });
    await orderStoryEvents(t.db, IDS.project, {
      eventId: fire.id,
      otherEventId: quarrel.id,
      direction: "before",
      expectedRevision: detail.selected!.revision,
    });
    const chapter = await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter } });
    const start = chapter.body.indexOf("Mara");
    detail = await loadStoryTimeline(t.db, IDS.project, { eventId: fire.id });
    await addStoryEventEvidence(t.db, IDS.project, fire.id, {
      sourceRecordId: IDS.chapter,
      passageStart: start,
      passageEnd: start + "Mara".length,
      expectedRevision: detail.selected!.revision,
    });
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.chapter,
      expectedRevision: chapter.currentRevision,
      body: `${chapter.body} The ink ran.`,
      unlockProtected: true,
    });
    const set = await listSceneLocationsForManuscript(t.db, IDS.project, SCENE);
    await assignSceneLocation(t.db, IDS.project, SCENE, IDS.world, { isPrimary: true, expectedFingerprint: set.fingerprint });
    const [image] = await addRecordImages(t.db, IDS.project, IDS.world, [{ filename: "quay.png", bytes: makePng(12, 12) }], { confirmProtected: false });
    const chart = await createWorldMap(t.db, IDS.project, { title: "Quay chart", imageId: image.id });
    const harbour = await createWorldMap(t.db, IDS.project, { title: "Harbour chart", imageId: image.id });
    const pin = await addWorldMapPin(t.db, IDS.project, chart.id, { recordId: IDS.world, xNorm: 0.42, yNorm: 0.55 });
    await addWorldMapPin(t.db, IDS.project, harbour.id, { recordId: IDS.world, xNorm: 0.2, yNorm: 0.3 });

    const conv = await createConversation(t.db, IDS.project);
    await updateConversationSummary(t.db, IDS.project, conv.id, "Remember the quay argument.");
    const requests: ProviderRequest[] = [];
    const provider: AssistantProvider = {
      stream() {
        throw new Error("discussion with tools uses complete");
      },
      async structured() {
        throw new Error("not a proposal");
      },
      async complete(request): Promise<ProviderRound> {
        requests.push(request);
        if (request.toolChoice === "none") {
          return {
            kind: "message",
            text: "The fire is earlier than the quarrel. Its time is unknown. The reader learns it later. That does not mean every character knows it.",
            status: "complete",
            usage: { inputTokens: 20, outputTokens: 20, totalTokens: 40 },
          };
        }
        return {
          kind: "tool_calls",
          calls: [
            { callId: "place", name: "events_at_place", arguments: JSON.stringify({ locationRecordId: IDS.world }) },
            { callId: "reveals", name: "event_reveals", arguments: JSON.stringify({ eventId: fire.id }) },
            { callId: "before", name: "events_before_scene", arguments: JSON.stringify({ manuscriptRecordId: IDS.chapter }) },
            { callId: "sequence", name: "chapter_event_sequence", arguments: JSON.stringify({ manuscriptRecordId: LATER }) },
          ],
        };
      },
    };
    const turn = await prepareTurn(t.db, { configured: true, model: "test-model", limits }, {
      kind: "ask",
      projectId: IDS.project,
      conversationId: conv.id,
      question: "What happened at the Salt Guild, and does chapter 2 conflict with the event sequence?",
      selection: { references: [], manuscript: null, includeMessageIds: [] },
      retrievalScope: "book",
    });
    expect(turn.request.tools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["events_at_place", "event_reveals", "events_before_scene", "chapter_event_sequence"]),
    );
    expect(turn.request.input.some((message) => message.content.includes("Remember the quay argument."))).toBe(true);
    const proposalConversation = await createConversation(t.db, IDS.project);
    const proposal = await prepareTurn(t.db, { configured: true, model: "test-model", limits }, {
      kind: "ask",
      projectId: IDS.project,
      conversationId: proposalConversation.id,
      question: "Propose a note.",
      selection: { references: [], manuscript: null, includeMessageIds: [] },
      mode: "proposal",
    });
    expect(proposal.request.tools).toBeUndefined();

    await runTurn(t.db, provider, turn, new AbortController().signal);
    expect(requests[1]?.toolChoice).toBe("none");
    const outputs = (requests[1]?.toolItems ?? []).flatMap((item) => (item.type === "function_call_output" ? [JSON.parse(item.output) as Record<string, unknown>] : []));
    const atPlace = outputs[0]!;
    expect(atPlace.unknownTime).toEqual(["The fire"]);
    expect(JSON.stringify(atPlace.events)).toContain("\"planned\":true");
    expect(JSON.stringify(atPlace.events)).toContain("Zero-draft evidence");
    expect(JSON.stringify(atPlace.sceneLocations)).toContain("The quay");
    expect(atPlace.maps).toEqual([
      expect.objectContaining({ title: "Harbour chart" }),
      expect.objectContaining({ title: "Quay chart", pinId: pin.id }),
    ]);
    const reveals = outputs[1]!;
    expect(JSON.stringify(reveals.event)).toContain("The ashes");
    expect(JSON.stringify(reveals.event)).toContain("Chapter 2");
    expect(JSON.stringify(reveals.notes)).toContain("does not mean every character");
    const before = outputs[2]!;
    expect(JSON.stringify(before.occurringBefore)).toContain("The fire");
    expect(JSON.stringify(before.occurringBefore)).not.toContain("The rumor");
    expect(before.unresolved).toContain("The rumor");
    expect(before.unknownTime).toContain("The fire");
    const sequence = outputs[3]!;
    expect(sequence.conflictsWithRecordedSequence).toBe(false);
    expect(sequence.constraintCycle).toBe(false);
    expect(JSON.stringify(sequence.readerOrderDifferences)).toContain("The fire");
    expect(JSON.stringify(sequence.readerOrderDifferences)).toContain("The quarrel");
    expect(JSON.stringify(sequence)).toContain("needsRecheck\":true");

    const view = await getConversationView(t.db, IDS.project, conv.id, limits);
    const answer = view.messages.find((message) => message.role === "assistant");
    expect(answer?.retrieval?.toolCallCount).toBe(4);
    expect(answer?.retrieval?.toolRoundCount).toBe(1);
    const sources = answer?.retrieval?.sources ?? [];
    const eventSource = sources.find((source) => source.eventId === fire.id);
    const mapSource = sources.find((source) => source.mapId === chart.id);
    const sceneSource = sources.find((source) => source.recordId === LATER);
    const stale = sources.find((source) => source.stale);
    expect(eventSource && retrievalSourceHref(IDS.project, eventSource)).toBe(
      `/projects/${IDS.project}/world/events?event=${fire.id}`,
    );
    expect(mapSource && retrievalSourceHref(IDS.project, mapSource)).toBe(
      `/projects/${IDS.project}/world/maps/${chart.id}?pin=${pin.id}`,
    );
    expect(sceneSource && retrievalSourceHref(IDS.project, sceneSource)).toBe(`/projects/${IDS.project}/records/${LATER}`);
    expect(stale?.passageStart).toBe(start);
    expect(stale?.evidenceLabel).toMatch(/Zero-draft|Author-rewrite|Planned/);
    const chapterAfter = await t.db.record.findUniqueOrThrow({ where: { id: IDS.chapter }, select: { body: true } });
    expect(chapterAfter.body).toBe(`${chapter.body} The ink ran.`);
  });

  it("hides another draft, refuses an excluded place, and leaves unresolved order unresolved", async () => {
    const rewrite = await startAuthorRewrite(t.db, IDS.project);
    const shared = await createStoryEvent(t.db, IDS.project, { title: "Shared" });
    const zeroOnly = await createStoryEvent(t.db, IDS.project, { title: "Zero only", draftScope: rewrite.zeroDraft.id });
    const loose = await createStoryEvent(t.db, IDS.project, { title: "Loose" });
    let detail = await loadStoryTimeline(t.db, IDS.project, { eventId: shared.id });
    await linkStoryEventLocation(t.db, IDS.project, shared.id, IDS.world, detail.selected!.revision);
    detail = await loadStoryTimeline(t.db, IDS.project, { eventId: zeroOnly.id });
    await linkStoryEventLocation(t.db, IDS.project, zeroOnly.id, IDS.world, detail.selected!.revision);
    detail = await loadStoryTimeline(t.db, IDS.project, { eventId: loose.id });
    await linkStoryEventLocation(t.db, IDS.project, loose.id, IDS.world, detail.selected!.revision);

    const author = context(rewrite.authorDraft.id);
    const authorResult = JSON.parse((await executeAssistantTool(t.db, author, "events_at_place", JSON.stringify({ locationRecordId: IDS.world }))).output) as {
      events: Array<{ title: string }>;
      unresolvedPairs: unknown[];
    };
    expect(authorResult.events.map((event) => event.title)).toEqual(expect.arrayContaining(["Shared"]));
    expect(authorResult.events.map((event) => event.title)).not.toContain("Zero only");
    expect(authorResult.unresolvedPairs.length).toBeGreaterThan(0);

    const excluded = context(null);
    excluded.excludeRecordIds = new Set([IDS.world]);
    const hidden = JSON.parse((await executeAssistantTool(t.db, excluded, "events_at_place", JSON.stringify({ locationRecordId: IDS.world }))).output) as { error?: string };
    expect(hidden.error).toBe("excluded");
    expect(excluded.meta.omissions.some((item) => item.recordId === IDS.world)).toBe(true);
  });
});

function context(draftId: string | null): RetrievalContext {
  return {
    projectId: IDS.project,
    scope: "book",
    focusRecordId: IDS.chapter,
    draftId,
    excludeRecordIds: new Set(),
    maxResultChars: 80_000,
    meta: emptyRetrievalMeta("book"),
  };
}
