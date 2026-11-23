import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptyWorldProfile,
  withWorldProfile,
  type WorldFieldHistoryChange,
} from "@/domain/worldProfile";
import { listContinuityLedger, suppressContinuityIssue } from "@/server/services/continuityService";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord, updateRecord } from "@/server/services/recordService";
import { createStoryEvent, linkStoryEventScene } from "@/server/services/storyEventService";
import {
  reviewManuscriptContradictions,
  listWorldContradictionChecks,
} from "@/server/services/worldContradictionService";
import { withRecordTaxonomy } from "@/world/taxonomy";
import { createTestDb, type TestDb } from "../helpers";

const WSP = "wsp_w7b";
const BOOK1 = "prj_w7b_book1";
const BOOK2 = "prj_w7b_book2";
const SERIES = "Saltmarsh Annals";
const STATION = "rec_w7b_station";
const TOWN = "rec_w7b_town";
const RIVER = "rec_w7b_river";
const SIBLING_LOCAL = "rec_w7b_sibling_local";

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

let t: TestDb;
let evOpen: string;
let evBefore: string;
let evClose: string;
let evAfter: string;
let evCensus: string;
let sceneAfter: string;
let sceneFlashback: string;
let sceneCensus: string;
let sceneRiver: string;
let sceneScope: string;

async function seed() {
  await createWorkspace(t.db, { id: WSP, name: "W7B workspace" });
  await createProject(t.db, { id: BOOK1, workspaceId: WSP, title: "Book One" });
  await createProject(t.db, { id: BOOK2, workspaceId: WSP, title: "Book Two" });
  await t.db.project.update({ where: { id: BOOK1 }, data: { seriesName: SERIES, bookName: "Book One" } });
  await t.db.project.update({ where: { id: BOOK2 }, data: { seriesName: SERIES, bookName: "Book Two" } });

  const open = await createStoryEvent(t.db, BOOK1, { title: "Station opens" });
  const before = await createStoryEvent(t.db, BOOK2, { title: "Before close" });
  const close = await createStoryEvent(t.db, BOOK2, { title: "Station closes" });
  const after = await createStoryEvent(t.db, BOOK2, { title: "After close" });
  const census = await createStoryEvent(t.db, BOOK2, { title: "Census dated" });
  const flash = await createStoryEvent(t.db, BOOK2, { title: "Flashback open" });
  evOpen = open.id;
  evBefore = before.id;
  evClose = close.id;
  evAfter = after.id;
  evCensus = census.id;

  for (const [earlier, later, projectId] of [
    [evOpen, evBefore, BOOK1],
    [evBefore, evClose, BOOK2],
    [evClose, evAfter, BOOK2],
    [evAfter, evCensus, BOOK2],
    [evOpen, flash.id, BOOK1],
    [flash.id, evClose, BOOK2],
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

  const stationProfile = {
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
        id: "wfh_reopen_planned",
        fieldPath: "values.access",
        value: "reopened",
        bookProjectId: BOOK2,
        storyEventId: evClose,
        planned: true,
        approval: "proposed",
      }),
    ],
  };

  await createRecord(t.db, BOOK1, {
    recordId: STATION,
    type: "worldbuilding",
    title: "Saltmarsh Station",
    body: "Quiet docks.",
    authorityStatus: "approved",
    worldScope: "series",
    fields: withWorldProfile(
      withRecordTaxonomy(
        { kind: "place" },
        { version: 1, primary: { category: "geography", subcategory: "cities_and_settlements" } },
      ),
      stationProfile,
    ),
  });

  const townProfile = {
    ...emptyWorldProfile(),
    definitionId: "category:locations",
    values: {
      populationEstimate: { amount: 0, qualifier: "exact" as const },
    },
    fieldHistory: [
      historyChange({
        id: "wfh_pop_zero",
        fieldPath: "values.populationEstimate",
        value: { amount: 0, qualifier: "exact" },
        bookProjectId: BOOK2,
        storyEventId: evCensus,
      }),
    ],
  };

  await createRecord(t.db, BOOK1, {
    recordId: TOWN,
    type: "worldbuilding",
    title: "Saltmarsh",
    body: "Harbor town.",
    authorityStatus: "approved",
    worldScope: "series",
    fields: withWorldProfile(
      withRecordTaxonomy(
        { kind: "place" },
        { version: 1, primary: { category: "geography", subcategory: "cities_and_settlements" } },
      ),
      townProfile,
    ),
  });

  const riverProfile = {
    ...emptyWorldProfile(),
    definitionId: "category:locations",
    values: {
      length: { amount: 90, unit: "miles", qualifier: "about" as const },
    },
    fieldHistory: [
      historyChange({
        id: "wfh_river_len",
        fieldPath: "values.length",
        value: { amount: 90, unit: "miles", qualifier: "about" },
        bookProjectId: BOOK1,
        storyEventId: evOpen,
      }),
    ],
  };

  await createRecord(t.db, BOOK1, {
    recordId: RIVER,
    type: "worldbuilding",
    title: "Grayflood",
    body: "A long river.",
    authorityStatus: "approved",
    worldScope: "series",
    fields: withWorldProfile(
      withRecordTaxonomy(
        { kind: "place" },
        { version: 1, primary: { category: "geography", subcategory: "waterways" } },
      ),
      riverProfile,
    ),
  });

  await createRecord(t.db, BOOK1, {
    recordId: SIBLING_LOCAL,
    type: "worldbuilding",
    title: "Book One Quay",
    body: "Local only.",
    authorityStatus: "approved",
    worldScope: "book",
    fields: withWorldProfile(
      withRecordTaxonomy(
        { kind: "place" },
        { version: 1, primary: { category: "geography", subcategory: "cities_and_settlements" } },
      ),
      {
        ...emptyWorldProfile(),
        definitionId: "category:locations",
        values: { access: "open" },
        fieldHistory: [
          historyChange({
            id: "wfh_local",
            fieldPath: "values.access",
            value: "open",
            bookProjectId: BOOK1,
            storyEventId: evOpen,
            worldScope: "book",
          }),
        ],
      },
    ),
  });

  await createRecord(t.db, BOOK2, {
    recordId: "rec_w7b_ch",
    type: "manuscript_chapter",
    title: "Chapter",
    body: "Chapter shell.",
    authorityStatus: "draft",
  });

  const mkScene = async (id: string, title: string, body: string, eventId: string) => {
    await createRecord(t.db, BOOK2, {
      recordId: id,
      type: "manuscript_scene",
      title,
      body,
      authorityStatus: "draft",
      parentRecordId: "rec_w7b_ch",
    });
    const event = await t.db.storyEvent.findFirstOrThrow({ where: { id: eventId } });
    await linkStoryEventScene(t.db, BOOK2, eventId, id, event.revision);
    return id;
  };

  sceneAfter = await mkScene(
    "rec_w7b_after",
    "After closure",
    "She entered Saltmarsh Station through the east door. She hoped the east door was open.",
    evAfter,
  );
  sceneFlashback = await mkScene(
    "rec_w7b_flash",
    "Flashback open",
    "She entered Saltmarsh Station through the east door.",
    flash.id,
  );
  sceneCensus = await mkScene(
    "rec_w7b_census",
    "Census scene",
    "Saltmarsh still had forty permanent residents.",
    evCensus,
  );
  sceneRiver = await mkScene(
    "rec_w7b_river_scene",
    "River scene",
    "The Grayflood ran roughly 145 km. The navigable stretch of the Grayflood ran roughly 12 miles.",
    evAfter,
  );
  sceneScope = await mkScene(
    "rec_w7b_scope",
    "Scope scene",
    "She entered Saltmarsh Station. Book One Quay stayed open.",
    evAfter,
  );

  // Series-shared world records live in Book One; Book Two scenes discover them by title mention
  // via listAvailableReferences (same path as Write pins / W7A), not same-project RecordLink rows.
}

beforeEach(async () => {
  t = await createTestDb();
  await seed();
}, 15_000);

afterEach(async () => {
  await t.cleanup();
});

describe("W7B world contradiction review", () => {
  it("Saltmarsh: post-closure conflict, flashback clean, hope clean", async () => {
    const after = await reviewManuscriptContradictions(t.db, BOOK2, sceneAfter, { persist: true });
    const conflicts = after.persisted.filter((row) => row.verdict === "conflict");
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    expect(conflicts.some((row) => row.passageExcerpt.includes("entered"))).toBe(true);
    expect(after.persisted.some((row) => row.passageExcerpt.toLowerCase().includes("hoped"))).toBe(false);

    const ledger = await listContinuityLedger(t.db, BOOK2, { recordId: sceneAfter });
    const worldItems = ledger.filter((item) => item.kind === "world_contradiction");
    expect(worldItems.length).toBeGreaterThanOrEqual(1);
    expect(worldItems[0]?.href).toContain(sceneAfter);
    expect(worldItems[0]?.worldHref).toContain(STATION);

    const flash = await reviewManuscriptContradictions(t.db, BOOK2, sceneFlashback, { persist: true });
    expect(flash.persisted).toHaveLength(0);
  });

  it("Population: dated zero vs forty conflicts; blank census stays clean", async () => {
    const conflicted = await reviewManuscriptContradictions(t.db, BOOK2, sceneCensus, { persist: true });
    expect(conflicted.persisted.some((row) => row.fieldPath.includes("populationEstimate"))).toBe(true);

    const town = await t.db.record.findFirstOrThrow({ where: { id: TOWN } });
    await updateRecord(t.db, BOOK1, {
      recordId: TOWN,
      expectedRevision: town.currentRevision,
      fields: withWorldProfile(
        withRecordTaxonomy(
          { kind: "place" },
          { version: 1, primary: { category: "geography", subcategory: "cities_and_settlements" } },
        ),
        {
          ...emptyWorldProfile(),
          definitionId: "category:locations",
          values: {},
          fieldHistory: [],
        },
      ),
    });

    const blank = await reviewManuscriptContradictions(t.db, BOOK2, sceneCensus, { persist: true });
    expect(blank.persisted.some((row) => row.fieldPath.includes("populationEstimate"))).toBe(false);
  });

  it("Waterway: about 90 miles ≈ 145 km compatible; stretch is scoped out", async () => {
    const result = await reviewManuscriptContradictions(t.db, BOOK2, sceneRiver, { persist: true });
    expect(result.evaluations.some((e) => e.passage.text.includes("145") && e.verdict === "compatible")).toBe(true);
    expect(result.evaluations.some((e) => e.passage.text.includes("navigable") && e.verdict === "scope_mismatch")).toBe(
      true,
    );
    expect(result.persisted.some((row) => row.passageExcerpt.includes("navigable"))).toBe(false);
  });

  it("Scope: planned reopen and sibling book-local stay out of payload and findings", async () => {
    const result = await reviewManuscriptContradictions(t.db, BOOK2, sceneScope, { persist: true });
    expect(result.evaluations.some((e) => e.worldFact.formatted.includes("reopened"))).toBe(false);
    expect(result.evaluations.some((e) => e.worldFact.worldRecordId === SIBLING_LOCAL)).toBe(false);
    expect(result.persisted.some((row) => row.worldRecordId === SIBLING_LOCAL)).toBe(false);
  });

  it("dedupes repeat review, marks needsRecheck on revision bump, and suppresses without editing prose", async () => {
    const first = await reviewManuscriptContradictions(t.db, BOOK2, sceneAfter, { persist: true });
    expect(first.persisted.length).toBeGreaterThanOrEqual(1);
    const second = await reviewManuscriptContradictions(t.db, BOOK2, sceneAfter, { persist: true });
    expect(second.persisted.length).toBe(first.persisted.length);
    const rows = await listWorldContradictionChecks(t.db, BOOK2, { manuscriptRecordId: sceneAfter });
    expect(rows).toHaveLength(first.persisted.length);

    const beforeBody = await t.db.record.findFirstOrThrow({ where: { id: sceneAfter } });
    await updateRecord(t.db, BOOK2, {
      recordId: sceneAfter,
      expectedRevision: beforeBody.currentRevision,
      body: `${beforeBody.body} A new sentence.`,
      unlockProtected: true,
    });
    const recheck = await listWorldContradictionChecks(t.db, BOOK2, { manuscriptRecordId: sceneAfter });
    expect(recheck.every((row) => row.needsRecheck)).toBe(true);

    const issueKey = first.persisted[0]!.issueKey;
    await suppressContinuityIssue(t.db, BOOK2, { issueKey, reason: "intentional" });
    await suppressContinuityIssue(t.db, BOOK2, { issueKey, reason: "resolved" });
    await suppressContinuityIssue(t.db, BOOK2, { issueKey, reason: "ignored" });
    const open = await listContinuityLedger(t.db, BOOK2, { recordId: sceneAfter });
    expect(open.some((item) => item.key === issueKey)).toBe(false);
    const afterBody = await t.db.record.findFirstOrThrow({ where: { id: sceneAfter } });
    expect(afterBody.body).toContain("A new sentence.");
    const station = await t.db.record.findFirstOrThrow({ where: { id: STATION } });
    expect(station.body).toBe("Quiet docks.");
  });
});
