import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { listContinuityTriage } from "@/server/services/continuityService";
import { exportContextBundle } from "@/server/services/contextExportService";
import { NotFoundError } from "@/server/services/errors";
import { createProject } from "@/server/services/projectService";
import { createRecord, getRecord, listWorldIndex } from "@/server/services/recordService";
import {
  requireSeriesSharedFromSibling,
  seriesRecordOwningProjectId,
  updateSeriesSharedFromSibling,
} from "@/server/services/seriesBibleService";
import { searchProjectRecords } from "@/server/services/searchService";
import { listWorldKindTemplates, saveWorldKindTemplate } from "@/server/services/worldKindTemplateService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

const BOOK_TWO = "prj_test_book_two";
const OTHER_SERIES = "prj_test_other_series";

describe("series bible and kind templates", () => {
  let source: TestDb;
  let target: TestDb;

  beforeEach(async () => {
    source = await createTestDb();
    target = await createTestDb();
    await seedProject(source.db);
    await source.db.project.update({
      where: { id: IDS.project },
      data: { seriesName: "The Salt Cycle", bookName: "Book One" },
    });
    await createProject(source.db, { workspaceId: IDS.workspace, title: "Book Two", id: BOOK_TWO });
    await source.db.project.update({
      where: { id: BOOK_TWO },
      data: { seriesName: "The Salt Cycle", bookName: "Book Two" },
    });
    await createProject(source.db, { workspaceId: IDS.workspace, title: "Other series", id: OTHER_SERIES });
    await source.db.project.update({
      where: { id: OTHER_SERIES },
      data: { seriesName: "Somewhere else", bookName: "Only book" },
    });
  });

  afterEach(async () => {
    await source.cleanup();
    await target.cleanup();
  });

  it("shows series-scoped rules and research notes in a sibling book", async () => {
    await createRecord(source.db, IDS.project, {
      type: "rules_glossary",
      title: "Shared tide rules",
      body: "Never sail at the third bell.",
      fields: {},
      authorityStatus: "approved",
      recordId: "rec_test_shared_rules",
    });
    await createRecord(source.db, IDS.project, {
      type: "research_note",
      title: "Shared quay research",
      body: "Harbour depth notes.",
      fields: {},
      authorityStatus: "draft",
      recordId: "rec_test_shared_research",
    });
    await source.db.record.update({ where: { id: "rec_test_shared_rules" }, data: { worldScope: "series" } });
    await source.db.record.update({ where: { id: "rec_test_shared_research" }, data: { worldScope: "series" } });

    const fromSibling = await listWorldIndex(source.db, BOOK_TWO);
    expect(fromSibling.find((row) => row.record.id === "rec_test_shared_rules")?.home?.projectId).toBe(IDS.project);
    expect(fromSibling.find((row) => row.record.id === "rec_test_shared_research")?.home?.bookName).toBe("Book One");

    const rulesHits = await searchProjectRecords(source.db, {
      projectId: BOOK_TWO,
      query: "third bell",
      includeManuscript: false,
      includeSeriesBible: true,
    });
    expect(rulesHits.find((hit) => hit.id === "rec_test_shared_rules")?.seriesHome?.projectId).toBe(IDS.project);

    const bundle = await exportContextBundle(source.db, BOOK_TWO, {
      types: ["rules_glossary", "research_note"],
    });
    expect(bundle.records.find((record) => record.id === "rec_test_shared_rules")?.seriesHome?.bookName).toBe("Book One");
    expect(bundle.records.find((record) => record.id === "rec_test_shared_research")?.title).toBe("Shared quay research");

    const siblingRules = await requireSeriesSharedFromSibling(source.db, BOOK_TWO, "rec_test_shared_rules");
    expect(seriesRecordOwningProjectId(siblingRules)).toBe(IDS.project);
  });

  it("shows a series-scoped reference as read-only in a sibling book", async () => {
    await createRecord(source.db, IDS.project, {
      type: "character_dossier",
      title: "Shared Mara",
      body: "Keeper of the quay.",
      fields: { name: "Mara", aliases: ["Mar"] },
      authorityStatus: "approved",
      recordId: "rec_test_shared_mara",
    });
    await source.db.record.update({ where: { id: "rec_test_shared_mara" }, data: { worldScope: "series" } });
    await source.db.record.update({ where: { id: IDS.world }, data: { worldScope: "book" } });

    const fromSibling = await listWorldIndex(source.db, BOOK_TWO);
    const shared = fromSibling.find((row) => row.record.id === "rec_test_shared_mara");
    expect(shared?.home).toMatchObject({ projectId: IDS.project, bookName: "Book One" });
    expect(fromSibling.some((row) => row.record.id === IDS.world)).toBe(false);

    await expect(getRecord(source.db, BOOK_TWO, "rec_test_shared_mara")).rejects.toBeInstanceOf(NotFoundError);
    const home = await getRecord(source.db, IDS.project, "rec_test_shared_mara");
    expect(home.title).toBe("Shared Mara");

    const siblingView = await requireSeriesSharedFromSibling(source.db, BOOK_TWO, "rec_test_shared_mara");
    expect(seriesRecordOwningProjectId(siblingView)).toBe(IDS.project);
    await updateSeriesSharedFromSibling(source.db, BOOK_TWO, {
      recordId: "rec_test_shared_mara",
      expectedRevision: home.currentRevision,
      body: "Keeper of the quay. Revised from Book Two.",
    });
    const afterHome = await getRecord(source.db, IDS.project, "rec_test_shared_mara");
    expect(afterHome.body).toContain("Revised from Book Two");
    expect(afterHome.currentRevision).toBe(home.currentRevision + 1);
    await expect(
      updateSeriesSharedFromSibling(source.db, IDS.project, {
        recordId: "rec_test_shared_mara",
        expectedRevision: afterHome.currentRevision,
        body: "Wrong book.",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    const hits = await searchProjectRecords(source.db, {
      projectId: BOOK_TWO,
      query: "Shared Mara",
      includeManuscript: false,
      includeSeriesBible: true,
    });
    expect(hits.find((hit) => hit.id === "rec_test_shared_mara")?.seriesHome?.projectId).toBe(IDS.project);

    const bundle = await exportContextBundle(source.db, BOOK_TWO, { types: ["character_dossier"] });
    expect(bundle.records.find((record) => record.id === "rec_test_shared_mara")?.seriesHome?.bookName).toBe("Book One");

    await createRecord(source.db, OTHER_SERIES, {
      type: "character_dossier",
      title: "Not in this series",
      authorityStatus: "draft",
      recordId: "rec_test_other_series",
    });
    await source.db.record.update({ where: { id: "rec_test_other_series" }, data: { worldScope: "series" } });
    const still = await listWorldIndex(source.db, BOOK_TWO);
    expect(still.some((row) => row.record.id === "rec_test_other_series")).toBe(false);
  });

  it("round-trips a custom kind template and lists unresolved records", async () => {
    const saved = await saveWorldKindTemplate(source.db, {
      projectId: IDS.project,
      kind: "River trade pact",
      fields: [
        { key: "riverToll", label: "River toll", multiline: false },
        { key: "terms", label: "Terms", multiline: true },
      ],
    });
    expect(saved.fields.map((field) => field.key)).toEqual(["riverToll", "terms"]);

    const backup = await createWorkspaceBackup(source.db, IDS.workspace);
    expect(backup.worldKindTemplates?.some((template) => template.kind === "River trade pact")).toBe(true);
    const outcome = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "preserve" });
    expect(outcome.ok).toBe(true);
    const restored = await listWorldKindTemplates(target.db, IDS.project);
    expect(restored.find((template) => template.kind === "River trade pact")?.fields).toEqual([
      { key: "riverToll", label: "River toll", multiline: false },
      { key: "terms", label: "Terms", multiline: true },
    ]);

    await source.db.record.update({ where: { id: IDS.decision }, data: { authorityStatus: "unresolved" } });
    await source.db.record.update({
      where: { id: IDS.world },
      data: { body: "## Open questions\n\nWho keeps the second key?\n" },
    });
    const triage = await listContinuityTriage(source.db, IDS.project);
    expect(triage.some((item) => item.kind === "unresolved" && item.href.includes(IDS.decision))).toBe(true);
    expect(triage.some((item) => item.kind === "open_question" && item.detail.includes("second key"))).toBe(true);
  });
});
