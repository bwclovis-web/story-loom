import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceBackupV1 } from "@/backup/format.v1";
import {
  emptyCharacterDevelopment,
  readCharacterDevelopment,
  withCharacterDevelopment,
} from "@/domain/characterDevelopment";
import {
  emptyWorldProfile,
  readWorldProfile,
  withWorldProfile,
  type WorldFieldHistoryChange,
} from "@/domain/worldProfile";
import { resolveWorldFieldsAtPoint } from "@/domain/worldProfileHistory";
import { createDb } from "@/server/db";
import { fileUrl } from "@/server/dbLocation";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { listContinuityLedger, suppressContinuityIssue } from "@/server/services/continuityService";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord, getRecord } from "@/server/services/recordService";
import { createSmartCollection, getSmartCollection } from "@/server/services/smartCollectionService";
import { createStoryEvent, linkStoryEventScene } from "@/server/services/storyEventService";
import {
  listWorldContradictionChecks,
  reviewManuscriptContradictions,
} from "@/server/services/worldContradictionService";
import { withRecordTaxonomy } from "@/world/taxonomy";
import { createTestDb, createTestDbThrough, listMigrationDirs, type TestDb } from "../helpers";

const WSP = "wsp_w8b";
const BOOK1 = "prj_w8b_book1";
const BOOK2 = "prj_w8b_book2";
const SERIES = "Saltmarsh Annals";
const STATION = "rec_w8b_station";
const RIVER = "rec_w8b_river";
const DOSSIER = "rec_w8b_mara";
const CHAPTER = "rec_w8b_ch";
const SCENE_AFTER = "rec_w8b_scene_after";
const SCENE_FLASH = "rec_w8b_scene_flash";
const CAT = "wcat_w8b_transport";
const EXCLUDED = "rec_w8b_excluded";

const LAYOUT_CUTOFF = "20261122180000_smart_collections";
const PRE_W4_CUTOFF = "20261122210000_character_analysis";
const W4_MIGRATION = "20261123010000_series_relation_template_scope";
const HEAD_MIGRATION = listMigrationDirs().at(-1)!.name;

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

function resolvedValue(resolved: ReturnType<typeof resolveWorldFieldsAtPoint>, path: string) {
  const field = resolved.fields[path];
  return field?.presence === "set" ? field.value : undefined;
}

async function seedSaltmarshHead(t: TestDb) {
  await createWorkspace(t.db, { id: WSP, name: "W8B workspace" });
  await createProject(t.db, { id: BOOK1, workspaceId: WSP, title: "Book One" });
  await createProject(t.db, { id: BOOK2, workspaceId: WSP, title: "Book Two" });
  await t.db.project.update({ where: { id: BOOK1 }, data: { seriesName: SERIES, bookName: "Book One" } });
  await t.db.project.update({ where: { id: BOOK2 }, data: { seriesName: SERIES, bookName: "Book Two" } });

  await t.db.worldCategoryDefinition.create({
    data: {
      id: CAT,
      projectId: BOOK1,
      slug: "transport",
      label: "Transport",
      description: "Ways across the marsh",
      parentCategorySlug: null,
      worldScope: "series",
      updatedAt: new Date(),
    },
  });

  // Orders must keep both endpoints in the same project (backup integrity).
  // Cross-book history still uses bookProjectId on fieldHistory rows.
  const open = await createStoryEvent(t.db, BOOK2, { title: "Station opens" });
  const close = await createStoryEvent(t.db, BOOK2, { title: "Station closes" });
  const after = await createStoryEvent(t.db, BOOK2, { title: "After close" });
  const flash = await createStoryEvent(t.db, BOOK2, { title: "Flashback open" });
  const census = await createStoryEvent(t.db, BOOK2, { title: "Census" });

  for (const [earlier, later] of [
    [open.id, flash.id],
    [flash.id, close.id],
    [close.id, after.id],
    [after.id, census.id],
  ] as const) {
    await t.db.storyEventOrder.create({
      data: {
        id: `evo_${earlier}_${later}`,
        projectId: BOOK2,
        earlierEventId: earlier,
        laterEventId: later,
      },
    });
  }

  const stationProfile = {
    ...emptyWorldProfile(),
    definitionId: "category:locations",
    values: {
      access: "closed",
      populationEstimate: { amount: 0, qualifier: "exact" as const },
      length: { amount: 12, unit: "mi", qualifier: "about" as const },
    },
    fieldMeta: {
      "values.access": { approval: "approved" as const, provenance: { origin: "author" as const, note: "" } },
      "values.populationEstimate": {
        approval: "approved" as const,
        provenance: { origin: "author" as const, note: "" },
      },
      "values.length": { approval: "approved" as const, provenance: { origin: "author" as const, note: "" } },
    },
    fieldHistory: [
      historyChange({
        id: "wfh_open",
        fieldPath: "values.access",
        value: "open",
        bookProjectId: BOOK1,
        storyEventId: open.id,
        note: "Archive mentions rec_w8b_station as plain text",
      }),
      historyChange({
        id: "wfh_close",
        fieldPath: "values.access",
        value: "closed",
        bookProjectId: BOOK2,
        storyEventId: close.id,
      }),
      historyChange({
        id: "wfh_pop",
        fieldPath: "values.populationEstimate",
        value: { amount: 0, qualifier: "exact" },
        bookProjectId: BOOK2,
        storyEventId: census.id,
      }),
      historyChange({
        id: "wfh_len",
        fieldPath: "values.length",
        value: { amount: 12, unit: "mi", qualifier: "about" },
        bookProjectId: BOOK1,
        storyEventId: open.id,
      }),
    ],
    migrationHold: [
      {
        id: "hold_1",
        kind: "unclassified" as const,
        fieldPath: "body",
        heading: "Quay scrap",
        text: `Keep ${STATION} literal in archive`,
        sourceText: `${STATION} source scrap`,
        note: "",
        decision: "retained" as const,
      },
    ],
  };

  await createRecord(t.db, BOOK1, {
    recordId: STATION,
    type: "worldbuilding",
    title: "Saltmarsh Station",
    body: "The station sits on the quay.",
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

  await createRecord(t.db, BOOK1, {
    recordId: RIVER,
    type: "worldbuilding",
    title: "Tidewater Cut",
    body: "A shallow cut.",
    authorityStatus: "approved",
    worldScope: "series",
    fields: withWorldProfile(
      withRecordTaxonomy(
        { kind: "place" },
        { version: 1, primary: { category: "geography", subcategory: "waterways" } },
      ),
      {
        ...emptyWorldProfile(),
        definitionId: "category:locations",
        values: { length: { amount: 12, unit: "mi", qualifier: "about" as const } },
        fieldMeta: {
          "values.length": { approval: "approved" as const, provenance: { origin: "author" as const, note: "" } },
        },
        fieldHistory: [
          historyChange({
            id: "wfh_river",
            fieldPath: "values.length",
            value: { amount: 12, unit: "mi", qualifier: "about" },
            bookProjectId: BOOK1,
            storyEventId: open.id,
          }),
        ],
      },
    ),
  });

  const emptyChar = emptyCharacterDevelopment();
  await createRecord(t.db, BOOK1, {
    recordId: DOSSIER,
    type: "character_dossier",
    title: "Mara Venn",
    body: "Archivist.",
    authorityStatus: "approved",
    fields: withCharacterDevelopment(
      {},
      {
        ...emptyChar,
        capabilities: {
          ...emptyChar.capabilities,
          linkedRecordIds: [STATION],
          skills: `${STATION} is not a skill id`,
        },
      },
    ),
  });

  await createRecord(t.db, BOOK2, {
    recordId: CHAPTER,
    type: "manuscript_chapter",
    title: "Chapter After",
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
      parentRecordId: CHAPTER,
    });
    const event = await t.db.storyEvent.findFirstOrThrow({ where: { id: eventId } });
    await linkStoryEventScene(t.db, BOOK2, eventId, id, event.revision);
  };

  await mkScene(SCENE_AFTER, "After close", "She entered Saltmarsh Station through the east door.", after.id);
  await mkScene(SCENE_FLASH, "Flashback", "Years earlier the doors stood open at Saltmarsh Station.", flash.id);

  await createRecord(t.db, BOOK2, {
    recordId: EXCLUDED,
    type: "worldbuilding",
    title: "Excluded scrap",
    body: "Not in compile.",
    authorityStatus: "draft",
  });

  await t.db.compileProfile.create({
    data: {
      id: "cprof_w8b",
      projectId: BOOK2,
      titlePageBody: "Saltmarsh",
      copyrightPageBody: "",
      dedicationBody: "",
      acknowledgementsBody: "",
      sceneBreakGlyph: "***",
      chapterHeadingStyle: "centered",
      includeSynopses: false,
      includeMarginComments: false,
      trimSize: "5x8",
      marginInches: 0.5,
      runningHeader: "Saltmarsh",
      runningFooter: "",
      fontPreset: "serif",
      spacingPreset: "novel",
      firstParagraphNoIndent: true,
      dropCap: false,
      includeToc: true,
      backMatterBody: "End notes for Saltmarsh.",
      excludedRecordIds: JSON.stringify([EXCLUDED]),
      bookTheme: null,
    },
  });

  const collection = await createSmartCollection(t.db, BOOK2, {
    title: "Station links",
    scope: "world",
    filter: { linkedRecordId: STATION, category: "locations", query: STATION },
  });

  const review = await reviewManuscriptContradictions(t.db, BOOK2, SCENE_AFTER, { persist: true });
  expect(review.persisted.length).toBeGreaterThan(0);
  const issueKey = review.persisted[0]!.issueKey;
  await suppressContinuityIssue(t.db, BOOK2, { issueKey, reason: "intentional", note: "Keep closed later" });

  return { collectionId: collection.id };
}

describe("W8B backup deploy hardening", () => {
  const dbs: TestDb[] = [];
  afterEach(async () => {
    while (dbs.length) {
      const t = dbs.pop();
      if (t) await t.cleanup();
    }
    vi.restoreAllMocks();
  });

  it("preserves CompileProfile layout when bookTheme column is missing", async () => {
    const t = await createTestDbThrough(LAYOUT_CUTOFF);
    dbs.push(t);
    await createWorkspace(t.db, { id: WSP, name: "Partial compile" });
    await createProject(t.db, { id: BOOK1, workspaceId: WSP, title: "Book One" });
    await createRecord(t.db, BOOK1, {
      recordId: EXCLUDED,
      type: "worldbuilding",
      title: "Skip me",
      body: "x",
      authorityStatus: "draft",
    });
    await t.db.$executeRawUnsafe(
      `INSERT INTO "CompileProfile" (
        "id", "projectId", "titlePageBody", "copyrightPageBody", "dedicationBody", "acknowledgementsBody",
        "sceneBreakGlyph", "chapterHeadingStyle", "includeSynopses", "includeMarginComments",
        "trimSize", "marginInches", "runningHeader", "runningFooter", "fontPreset", "spacingPreset",
        "firstParagraphNoIndent", "dropCap", "includeToc", "backMatterBody", "excludedRecordIds",
        "createdAt", "updatedAt"
      ) VALUES (
        'cprof_partial', ?, 'Title', '', '', '', '***', 'centered', 0, 0,
        '5.5x8.5', 0.625, 'Header', 'Footer', 'sans', 'tight',
        0, 1, 0, 'Back matter kept', ?,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )`,
      BOOK1,
      JSON.stringify([EXCLUDED]),
    );

    const backup = await createWorkspaceBackup(t.db, WSP);
    const profile = backup.compileProfiles?.[0];
    expect(profile).toBeTruthy();
    expect(profile!.trimSize).toBe("5.5x8.5");
    expect(profile!.marginInches).toBe(0.625);
    expect(profile!.backMatterBody).toBe("Back matter kept");
    expect(profile!.excludedRecordIds).toEqual([EXCLUDED]);
    expect(profile!.runningHeader).toBe("Header");
    expect(profile!.fontPreset).toBe("sans");
    expect(profile!.bookTheme).toBeUndefined();
  });

  it("treats missing ContinuitySuppression / WorldContradictionCheck tables as empty and surfaces other read failures", async () => {
    const { Prisma } = await import("@/generated/prisma/client");
    const head = await createTestDb();
    dbs.push(head);
    await createWorkspace(head.db, { id: WSP, name: "Schema readers" });
    await createProject(head.db, { id: BOOK1, workspaceId: WSP, title: "Book One" });

    const missingTable = (model: string) =>
      new Prisma.PrismaClientKnownRequestError(`The table \`${model}\` does not exist in the current database.`, {
        code: "P2021",
        clientVersion: "test",
        meta: { table: model },
      });

    vi.spyOn(head.db.continuitySuppression, "findMany").mockRejectedValueOnce(missingTable("ContinuitySuppression"));
    vi.spyOn(head.db.worldContradictionCheck, "findMany").mockRejectedValueOnce(
      missingTable("WorldContradictionCheck"),
    );
    const emptyBackup = await createWorkspaceBackup(head.db, WSP);
    expect(emptyBackup.continuitySuppressions ?? []).toEqual([]);
    expect(emptyBackup.worldContradictionChecks ?? []).toEqual([]);

    const boom = new Error("disk I/O failed while reading ContinuitySuppression");
    vi.spyOn(head.db.continuitySuppression, "findMany").mockRejectedValueOnce(boom);
    await expect(createWorkspaceBackup(head.db, WSP)).rejects.toThrow(/disk I\/O failed/);
  });

  it(
    "round-trips Saltmarsh data under preserve and remap with live behavior checks",
    async () => {
      const source = await createTestDb();
      dbs.push(source);
      const seeded = await seedSaltmarshHead(source);

      const backup = await createWorkspaceBackup(source.db, WSP);
      expect(backup.app.migrations.at(-1)).toBe(HEAD_MIGRATION);
      expect(backup.worldCategoryDefinitions?.some((c) => c.slug === "transport")).toBe(true);
      expect((backup.continuitySuppressions ?? []).length).toBeGreaterThan(0);
      expect((backup.worldContradictionChecks ?? []).length).toBeGreaterThan(0);

      const preserveTarget = await createTestDb();
      dbs.push(preserveTarget);
      const preserved = await restoreWorkspaceBackup(preserveTarget.db, backup, { idStrategy: "preserve" });
      if (!preserved.ok) {
        throw new Error(`preserve restore failed: ${JSON.stringify(preserved.issues.slice(0, 20), null, 2)}`);
      }

      const remapBeside = await createTestDb();
      dbs.push(remapBeside);
      const remapped = await restoreWorkspaceBackup(remapBeside.db, backup, { idStrategy: "remap" });
      expect(remapped.ok).toBe(true);
      if (!remapped.ok) return;
      const remapBook1 = remapped.projects.find((p) => p.title === "Book One")!.id;
      const remapBook2 = remapped.projects.find((p) => p.title === "Book Two")!.id;

      async function assertLive(db: TestDb["db"], book1: string, book2: string, collectionId: string) {
        const stationRow = await db.record.findFirstOrThrow({
          where: { projectId: book1, title: "Saltmarsh Station" },
        });
        const station = await getRecord(db, book1, stationRow.id);
        const profile = readWorldProfile(station.fields).profile!;
        const edges = await db.storyEventOrder.findMany({ where: { projectId: { in: [book1, book2] } } });
        const flashEvent = await db.storyEvent.findFirstOrThrow({
          where: { projectId: book2, title: "Flashback open" },
        });
        const afterEvent = await db.storyEvent.findFirstOrThrow({
          where: { projectId: book2, title: "After close" },
        });
        const books = [
          { projectId: book1, narrativeIndex: 1 },
          { projectId: book2, narrativeIndex: 2 },
        ];
        const edgeList = edges.map((e) => ({ earlierId: e.earlierEventId, laterId: e.laterEventId }));
        expect(
          resolvedValue(
            resolveWorldFieldsAtPoint(
              profile,
              { bookProjectId: book2, storyEventId: flashEvent.id, sequence: null },
              edgeList,
              {
                books,
                viewingProjectId: book2,
                fieldPaths: ["values.access"],
              },
            ),
            "values.access",
          ),
        ).toBe("open");
        expect(
          resolvedValue(
            resolveWorldFieldsAtPoint(
              profile,
              { bookProjectId: book2, storyEventId: afterEvent.id, sequence: null },
              edgeList,
              {
                books,
                viewingProjectId: book2,
                fieldPaths: ["values.access"],
              },
            ),
            "values.access",
          ),
        ).toBe("closed");

        const collection = await getSmartCollection(db, book2, collectionId);
        expect(collection.title).toBe("Station links");
        expect(collection.filter.linkedRecordId).toBe(station.id);
        expect(collection.filter.query).toBe(STATION);

        expect(profile.fieldHistory.find((h) => h.fieldPath === "values.populationEstimate")?.value).toEqual({
          amount: 0,
          qualifier: "exact",
        });
        expect(profile.fieldHistory.find((h) => h.fieldPath === "values.length")?.value).toEqual({
          amount: 12,
          unit: "mi",
          qualifier: "about",
        });
        expect(profile.migrationHold[0]?.text).toContain(STATION);

        const dossier = await getRecord(
          db,
          book1,
          (await db.record.findFirstOrThrow({ where: { projectId: book1, title: "Mara Venn" } })).id,
        );
        const char = readCharacterDevelopment(dossier.fields).profile!;
        expect(char.capabilities.linkedRecordIds).toEqual([station.id]);
        expect(char.capabilities.skills).toBe(`${STATION} is not a skill id`);

        const ledger = await listContinuityLedger(db, book2, { includeSuppressed: true });
        expect(ledger.some((item) => item.kind === "world_contradiction")).toBe(true);
        const checks = await listWorldContradictionChecks(db, book2);
        expect(checks.length).toBeGreaterThan(0);
        expect(checks[0]!.worldRecordId).toBe(station.id);

        const compile = await db.compileProfile.findFirstOrThrow({ where: { projectId: book2 } });
        expect(compile.trimSize).toBe("5x8");
        expect(compile.marginInches).toBe(0.5);
        expect(compile.backMatterBody).toBe("End notes for Saltmarsh.");
        const excludedId = (
          await db.record.findFirstOrThrow({ where: { projectId: book2, title: "Excluded scrap" } })
        ).id;
        expect(JSON.parse(compile.excludedRecordIds)).toEqual([excludedId]);
      }

      await assertLive(preserveTarget.db, BOOK1, BOOK2, seeded.collectionId);

      const remappedCollection = await remapBeside.db.smartCollection.findFirstOrThrow({
        where: { projectId: remapBook2, title: "Station links" },
      });
      await assertLive(remapBeside.db, remapBook1, remapBook2, remappedCollection.id);

      const remappedStation = await remapBeside.db.record.findFirstOrThrow({
        where: { projectId: remapBook1, title: "Saltmarsh Station" },
      });
      expect(remappedStation.id).not.toBe(STATION);
      const remappedProfile = readWorldProfile(
        (await getRecord(remapBeside.db, remapBook1, remappedStation.id)).fields,
      ).profile!;
      expect(remappedProfile.fieldHistory[0]!.bookProjectId).toBe(remapBook1);
      expect(remappedProfile.fieldHistory[0]!.note).toContain(STATION);
    },
    60_000,
  );

  it(
    "rehearses pre-W4 → head via db:deploy entry point and restores the pre-migrate backup",
    async () => {
      const pre = await createTestDbThrough(PRE_W4_CUTOFF);
      dbs.push(pre);
      await createWorkspace(pre.db, { id: WSP, name: "Pre-W4 deploy" });
      await createProject(pre.db, { id: BOOK1, workspaceId: WSP, title: "Book One" });
      await createRecord(pre.db, BOOK1, {
        recordId: STATION,
        type: "worldbuilding",
        title: "Saltmarsh Station",
        body: "Pre-W4 station body.",
        authorityStatus: "approved",
      });
      await pre.db.compileProfile.create({
        data: {
          id: "cprof_pre_w4",
          projectId: BOOK1,
          titlePageBody: "Pre-W4",
          copyrightPageBody: "",
          dedicationBody: "",
          acknowledgementsBody: "",
          sceneBreakGlyph: "***",
          chapterHeadingStyle: "centered",
          includeSynopses: false,
          includeMarginComments: false,
          trimSize: "Letter",
          marginInches: 1,
          runningHeader: "Pre",
          runningFooter: "",
          fontPreset: "mono",
          spacingPreset: "loose",
          firstParagraphNoIndent: false,
          dropCap: true,
          includeToc: false,
          backMatterBody: "Pre-W4 back matter",
          excludedRecordIds: "[]",
          bookTheme: null,
        },
      });
      await pre.db.$disconnect();

      const staging = mkdtempSync(path.join(tmpdir(), "wordly-w8b-deploy-"));
      const dbFile = path.join(staging, "pre-w4.db");
      copyFileSync(pre.file, dbFile);

      const deploy = spawnSync("pnpm", ["db:deploy"], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: fileUrl(dbFile) },
        encoding: "utf8",
        shell: true,
      });
      expect(deploy.status, deploy.stderr || deploy.stdout).toBe(0);
      expect(deploy.stdout).toMatch(/pre-migrate/i);
      expect(deploy.stdout).toMatch(new RegExp(W4_MIGRATION));

      const backupDirs = readdirSync(path.join(process.cwd(), "backups"))
        .filter((name) => name.includes("pre-migrate"))
        .sort();
      const latest = backupDirs.at(-1);
      expect(latest).toBeTruthy();
      const backupJson = path.join(process.cwd(), "backups", latest!, `${WSP}.wordly-backup.json`);
      expect(existsSync(backupJson)).toBe(true);
      const preMigrateBackup = JSON.parse(readFileSync(backupJson, "utf8")) as WorkspaceBackupV1;
      expect(preMigrateBackup.records.some((r) => r.id === STATION && r.body === "Pre-W4 station body.")).toBe(true);
      const preProfile = preMigrateBackup.compileProfiles?.[0];
      expect(preProfile?.trimSize).toBe("Letter");
      expect(preProfile?.marginInches).toBe(1);
      expect(preProfile?.backMatterBody).toBe("Pre-W4 back matter");
      expect(preProfile?.fontPreset).toBe("mono");

      const restoreTarget = await createTestDb();
      dbs.push(restoreTarget);
      expect((await restoreWorkspaceBackup(restoreTarget.db, preMigrateBackup, { idStrategy: "preserve" })).ok).toBe(
        true,
      );
      expect((await getRecord(restoreTarget.db, BOOK1, STATION)).body).toBe("Pre-W4 station body.");
      const compile = await restoreTarget.db.compileProfile.findFirstOrThrow({ where: { projectId: BOOK1 } });
      expect(compile.trimSize).toBe("Letter");
      expect(compile.backMatterBody).toBe("Pre-W4 back matter");

      const migrated = createDb(fileUrl(dbFile));
      try {
        const rows = await migrated.$queryRawUnsafe<Array<{ migration_name: string }>>(
          `SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name`,
        );
        const names = rows.map((r) => r.migration_name);
        expect(names).toContain(W4_MIGRATION);
        expect(names).toContain(HEAD_MIGRATION);
        expect(names.at(-1)).toBe(HEAD_MIGRATION);
      } finally {
        await migrated.$disconnect();
        rmSync(staging, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
