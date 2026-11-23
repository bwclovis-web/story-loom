import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AssistantProvider, OutputSchema, ProviderRequest, StructuredResult } from "@/assistant/provider";
import {
  emptyWorldProfile,
  withWorldProfile,
  type WorldFieldHistoryChange,
} from "@/domain/worldProfile";
import { WORLD_MARKDOWN_ARCHIVE_KEY } from "@/domain/worldProfileUpgrade";
import {
  AssistantError,
  createConversation,
  loadAuthorReferenceDocuments,
  prepareTurn,
  runTurn,
  type AssistantRuntime,
  type TurnInput,
} from "@/server/services/assistantService";
import { prepareBeatDraft, runBeatDraft } from "@/server/services/beatDraftAssistService";
import { exportContextBundle } from "@/server/services/contextExportService";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { addReadingPin, PROJECT_PIN_SCOPE } from "@/server/services/readingPinService";
import { createRecord, setProtection } from "@/server/services/recordService";
import { resolveAvailableReference } from "@/server/services/seriesBibleService";
import { prepareSelectionAssist, runSelectionAssist } from "@/server/services/selectionAssistService";
import { createStoryEvent, linkStoryEventScene } from "@/server/services/storyEventService";
import { addWeaveBeat, createWeaveGrid } from "@/server/services/weaveService";
import { withRecordTaxonomy } from "@/world/taxonomy";
import { createTestDb, type TestDb } from "../helpers";

const REOPEN_PHRASE = "REOPEN_PHRASE_DISTINCTIVE_W7A";
const STATION = "rec_station_w7a";
const BOOK1 = "prj_w7a_book1";
const BOOK2 = "prj_w7a_book2";
const UNRELATED = "prj_w7a_unrelated";
const WSP = "wsp_w7a";
const SERIES = "Saltmarsh Annals";

const runtime: AssistantRuntime = {
  configured: true,
  model: "test-model",
  limits: {
    maxInputChars: 80_000,
    maxOutputTokens: 2_000,
    maxRequestsPerHour: 100,
    monthlyTokenCap: 10_000_000,
    requestTimeoutSeconds: 60,
    maxToolCalls: 12,
    maxToolRounds: 4,
    maxToolResultChars: 80_000,
  },
};

function historyChange(
  partial: Partial<WorldFieldHistoryChange> & Pick<WorldFieldHistoryChange, "id" | "fieldPath" | "value">,
): WorldFieldHistoryChange {
  return {
    definitionId: "category:locations",
    storage: "profile",
    presence: "set",
    approval: "approved",
    planned: false,
    provenance: { origin: "author", note: "" },
    bookProjectId: BOOK1,
    storyEventId: null,
    chapterRecordId: null,
    sceneRecordId: null,
    sequence: null,
    worldScope: "series",
    note: "",
    supersedesId: null,
    correctionNote: "",
    correctedAt: null,
    ...partial,
  };
}

function dumpRequests(requests: ProviderRequest[]): string {
  return JSON.stringify(
    requests.map((r) => ({
      instructions: r.instructions,
      input: r.input,
      tools: r.tools,
    })),
  );
}

function scriptedStructured(reply: StructuredResult) {
  const calls: { request: ProviderRequest; schema: OutputSchema }[] = [];
  const provider: AssistantProvider = {
    async *stream() {
      throw new Error("not used");
    },
    async structured(request, schema) {
      calls.push({ request, schema });
      return reply;
    },
  };
  return { provider, calls };
}

function scriptedStream(text = "ok") {
  const requests: ProviderRequest[] = [];
  const provider: AssistantProvider = {
    async *stream(request) {
      requests.push(request);
      yield { type: "delta", text };
      yield {
        type: "done",
        status: "complete",
        responseId: "resp_w7a",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
    },
    async structured() {
      throw new Error("not used");
    },
  };
  return { provider, requests };
}

let t: TestDb;
let evOpen: string;
let evBefore: string;
let evClose: string;
let evAfter: string;
let evFlashback: string;
let sceneBefore: string;
let sceneFlashback: string;
let sceneClose: string;
let sceneAfter: string;
let sceneUnlinked: string;

async function seedFixture() {
  await createWorkspace(t.db, { id: WSP, name: "W7A workspace" });
  await createProject(t.db, { id: BOOK1, workspaceId: WSP, title: "Book One" });
  await createProject(t.db, { id: BOOK2, workspaceId: WSP, title: "Book Two" });
  await createProject(t.db, { id: UNRELATED, workspaceId: WSP, title: "Unrelated" });
  await t.db.project.update({ where: { id: BOOK1 }, data: { seriesName: SERIES, bookName: "Book One" } });
  await t.db.project.update({ where: { id: BOOK2 }, data: { seriesName: SERIES, bookName: "Book Two" } });

  const open = await createStoryEvent(t.db, BOOK1, { title: "Station opens" });
  const before = await createStoryEvent(t.db, BOOK2, { title: "Before close" });
  const close = await createStoryEvent(t.db, BOOK2, { title: "Station closes" });
  const after = await createStoryEvent(t.db, BOOK2, { title: "After close" });
  const flash = await createStoryEvent(t.db, BOOK2, { title: "Flashback open" });
  evOpen = open.id;
  evBefore = before.id;
  evClose = close.id;
  evAfter = after.id;
  evFlashback = flash.id;

  for (const [earlier, later, projectId] of [
    [evOpen, evBefore, BOOK1],
    [evBefore, evClose, BOOK2],
    [evClose, evAfter, BOOK2],
    [evOpen, evFlashback, BOOK1],
    [evFlashback, evClose, BOOK2],
  ] as const) {
    await t.db.storyEventOrder.create({
      data: {
        id: `evo_${earlier}_${later}`,
        projectId,
        earlierEventId: earlier,
        laterEventId: later,
      },
    });
  }

  const profile = {
    ...emptyWorldProfile(),
    definitionId: "category:locations",
    values: { access: "closed" },
    fieldMeta: {
      "values.access": { approval: "approved" as const, provenance: { origin: "author" as const, note: "" } },
    },
    fieldHistory: [
      historyChange({
        id: "wfh_open",
        fieldPath: "values.access",
        value: "open",
        bookProjectId: BOOK1,
        storyEventId: evOpen,
      }),
      historyChange({
        id: "wfh_close",
        fieldPath: "values.access",
        value: "closed",
        bookProjectId: BOOK2,
        storyEventId: evClose,
      }),
      historyChange({
        id: "wfh_reopen",
        fieldPath: "values.access",
        value: "reopened",
        bookProjectId: BOOK2,
        storyEventId: evClose,
        planned: true,
        approval: "proposed",
      }),
      historyChange({
        id: "wfh_book1_local",
        fieldPath: "values.access",
        value: "book1_local_override",
        bookProjectId: BOOK1,
        storyEventId: evOpen,
        worldScope: "book",
      }),
    ],
  };

  await createRecord(t.db, BOOK1, {
    recordId: STATION,
    type: "worldbuilding",
    title: "Saltmarsh Station",
    body: `## Access [PROPOSED]\n${REOPEN_PHRASE}\n\n## Notes\nQuiet docks.`,
    authorityStatus: "approved",
    worldScope: "series",
    fields: withWorldProfile(
      withRecordTaxonomy(
        {
          kind: "place",
          climate: "coastal fog",
          [WORLD_MARKDOWN_ARCHIVE_KEY]: {
            version: 1,
            entries: [
              {
                id: "wma_reopen",
                body: REOPEN_PHRASE,
                bodyHash: "hash",
                sourceRevision: 1,
                archivedAt: new Date(0).toISOString(),
                migrationFingerprint: "",
              },
            ],
            appliedFingerprints: [],
          },
        },
        { version: 1, primary: { category: "locations" } },
      ),
      profile,
    ),
  });

  await createRecord(t.db, BOOK2, {
    recordId: "rec_w7a_ch5",
    type: "manuscript_chapter",
    title: "Chapter 5",
    body: "Chapter shell.",
    authorityStatus: "draft",
  });

  const mkScene = async (id: string, title: string, eventId: string) => {
    await createRecord(t.db, BOOK2, {
      recordId: id,
      type: "manuscript_scene",
      title,
      body: `${title} prose about the quay.`,
      authorityStatus: "draft",
      parentRecordId: "rec_w7a_ch5",
    });
    const event = await t.db.storyEvent.findFirstOrThrow({ where: { id: eventId } });
    await linkStoryEventScene(t.db, BOOK2, eventId, id, event.revision);
    return id;
  };

  sceneBefore = await mkScene("rec_w7a_before", "Before closure", evBefore);
  sceneFlashback = await mkScene("rec_w7a_flash", "Flashback open", evFlashback);
  sceneClose = await mkScene("rec_w7a_close", "At closure", evClose);
  sceneAfter = await mkScene("rec_w7a_after", "After closure", evAfter);

  await createRecord(t.db, BOOK2, {
    recordId: "rec_w7a_unlinked",
    type: "manuscript_scene",
    title: "Unlinked scene",
    body: "No event link.",
    authorityStatus: "draft",
    parentRecordId: "rec_w7a_ch5",
  });
  sceneUnlinked = "rec_w7a_unlinked";

  await createRecord(t.db, UNRELATED, {
    recordId: "rec_w7a_other_ch",
    type: "manuscript_chapter",
    title: "Other chapter",
    body: "Unrelated prose.",
    authorityStatus: "draft",
  });
}

beforeEach(async () => {
  t = await createTestDb();
  await seedFixture();
});

afterEach(async () => {
  await t.cleanup();
});

describe("W7A world writing context", () => {
  it("series visibility: Book Two can pin Station; unrelated project cannot", async () => {
    const available = await resolveAvailableReference(t.db, BOOK2, STATION);
    expect(available?.record.id).toBe(STATION);
    expect(available?.home?.projectId).toBe(BOOK1);

    const pin = await addReadingPin(t.db, BOOK2, PROJECT_PIN_SCOPE, STATION);
    expect(pin.recordId).toBe(STATION);
    expect(pin.seriesHome?.projectId).toBe(BOOK1);

    expect(await resolveAvailableReference(t.db, UNRELATED, STATION)).toBeNull();
    await expect(addReadingPin(t.db, UNRELATED, PROJECT_PIN_SCOPE, STATION)).rejects.toBeTruthy();
  });

  it("drafting reference slice: flashback open, closure closed, never REOPEN_PHRASE", async () => {
    const station = await t.db.record.findFirstOrThrow({ where: { id: STATION } });

    const flashDocs = await loadAuthorReferenceDocuments(
      t.db,
      BOOK2,
      [{ recordId: STATION, revision: station.currentRevision }],
      { mode: "drafting", focusRecordId: sceneFlashback },
    );
    const flashText = flashDocs.map((d) => d.text).join("\n");
    expect(flashText).toContain("open");
    expect(flashText).not.toContain(REOPEN_PHRASE);
    expect(flashText).not.toMatch(/access: closed/i);
    expect(flashText).toContain("objective setting state");

    const closeDocs = await loadAuthorReferenceDocuments(
      t.db,
      BOOK2,
      [{ recordId: STATION, revision: station.currentRevision }],
      { mode: "drafting", focusRecordId: sceneClose },
    );
    const closeText = closeDocs.map((d) => d.text).join("\n");
    expect(closeText).toContain("closed");
    expect(closeText).not.toContain(REOPEN_PHRASE);

    const unlinkedDocs = await loadAuthorReferenceDocuments(
      t.db,
      BOOK2,
      [{ recordId: STATION, revision: station.currentRevision }],
      { mode: "drafting", focusRecordId: sceneUnlinked },
    );
    const unlinkedText = unlinkedDocs.map((d) => d.text).join("\n");
    expect(unlinkedText).not.toContain(REOPEN_PHRASE);
    expect(unlinkedText).toContain("open");
  });

  it("selection assist provider payload omits REOPEN_PHRASE at flashback and after", async () => {
    await addReadingPin(t.db, BOOK2, PROJECT_PIN_SCOPE, STATION);
    for (const sceneId of [sceneFlashback, sceneAfter]) {
      const scene = await t.db.record.findFirstOrThrow({ where: { id: sceneId } });
      const prep = await prepareSelectionAssist(t.db, runtime, {
        projectId: BOOK2,
        recordId: sceneId,
        revision: scene.currentRevision,
        range: { start: 0, end: Math.min(12, scene.body.length) },
        action: "rewrite",
        scopeDraftId: PROJECT_PIN_SCOPE,
      });
      const { provider, calls } = scriptedStructured({
        status: "complete",
        text: JSON.stringify({ replacement: "quay", note: "ok" }),
        responseId: "resp_sa",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
      await runSelectionAssist(t.db, provider, prep, [STATION], new AbortController().signal);
      const blob = dumpRequests(calls.map((c) => c.request));
      expect(blob).not.toContain(REOPEN_PHRASE);
      if (sceneId === sceneFlashback) expect(blob).toContain("open");
      if (sceneId === sceneAfter) expect(blob).toContain("closed");
    }
  });

  it("beat draft provider payload uses point-scoped station facts", async () => {
    await addReadingPin(t.db, BOOK2, PROJECT_PIN_SCOPE, STATION);
    await setProtection(t.db, BOOK2, sceneBefore, false);
    const grid = await createWeaveGrid(t.db, BOOK2, { title: "Plan", viewKind: "original" });
    const beat = await addWeaveBeat(t.db, BOOK2, grid.id, {
      title: "Arrive at station",
      body: "Describe the east entrance.",
      manuscriptRecordId: sceneBefore,
      x: 0,
      y: 0,
    });
    const scene = await t.db.record.findFirstOrThrow({ where: { id: sceneBefore } });
    const prep = await prepareBeatDraft(t.db, runtime, {
      projectId: BOOK2,
      recordId: sceneBefore,
      revision: scene.currentRevision,
      beatId: beat.id,
      scopeDraftId: PROJECT_PIN_SCOPE,
    });
    const { provider, requests } = scriptedStream("The east entrance stood open.");
    await runBeatDraft(t.db, provider, prep, new AbortController().signal);
    const blob = dumpRequests(requests);
    expect(blob).toContain("open");
    expect(blob).not.toContain(REOPEN_PHRASE);
    expect(blob).not.toContain("book1_local_override");
  });

  it("assistant turn with station reference never leaks REOPEN_PHRASE", async () => {
    const conv = await createConversation(t.db, BOOK2);
    const station = await t.db.record.findFirstOrThrow({ where: { id: STATION } });
    const scene = await t.db.record.findFirstOrThrow({ where: { id: sceneClose } });
    const input: TurnInput = {
      kind: "ask",
      projectId: BOOK2,
      conversationId: conv.id,
      question: "What is the station access right now?",
      selection: {
        references: [{ recordId: STATION, revision: station.currentRevision }],
        manuscript: { recordId: sceneClose, revision: scene.currentRevision },
        includeMessageIds: [],
      },
      retrievalScope: "chapter",
    };
    const prepared = await prepareTurn(t.db, runtime, input);
    const { provider, requests } = scriptedStream("Closed.");
    await runTurn(t.db, provider, prepared, new AbortController().signal);
    const blob = dumpRequests(requests);
    expect(blob).toContain("closed");
    expect(blob).not.toContain(REOPEN_PHRASE);
  });

  it("context bundle drafting redaction strips archive and planned reopen", async () => {
    const bundle = await exportContextBundle(t.db, BOOK2, {
      recordIds: [STATION],
      focusRecordId: sceneBefore,
      characterMode: "drafting",
      redactCharacterSpoilers: true,
    });
    const record = bundle.records.find((r) => r.id === STATION);
    expect(record).toBeTruthy();
    const fieldsJson = JSON.stringify(record?.fields ?? {});
    expect(fieldsJson).not.toContain(REOPEN_PHRASE);
    expect(fieldsJson).not.toContain("worldMarkdownArchive");
    expect(fieldsJson).not.toContain("wfh_reopen");
    expect(fieldsJson).toContain("wfh_open");
    expect(fieldsJson).not.toContain("wfh_close");
  });

  it("unrelated project cannot load station into drafting context", async () => {
    await expect(
      loadAuthorReferenceDocuments(t.db, UNRELATED, [{ recordId: STATION, revision: 1 }], {
        mode: "drafting",
        focusRecordId: "rec_w7a_other_ch",
      }),
    ).rejects.toBeInstanceOf(AssistantError);

    const bundle = await exportContextBundle(t.db, UNRELATED, {
      recordIds: [STATION],
      characterMode: "drafting",
      redactCharacterSpoilers: true,
    });
    expect(bundle.records.some((r) => r.id === STATION)).toBe(false);
  });
});
