import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JsonObject } from "@/domain/json";
import {
  emptyWorldProfile,
  readWorldProfile,
  WORLD_PROFILE_KEY,
  withWorldProfile,
  type WorldFieldHistoryChange,
} from "@/domain/worldProfile";
import { resolveWorldFieldsAtPoint, supersedeWorldFieldChange } from "@/domain/worldProfileHistory";
import { applyChangePackage } from "@/server/services/changePackageService";
import { exportContextBundle } from "@/server/services/contextExportService";
import { MutationRejectedError } from "@/server/services/errors";
import { createProject } from "@/server/services/projectService";
import {
  createRecord,
  getRecord,
  restoreRecordFromRevision,
  setProtection,
  updateRecord,
} from "@/server/services/recordService";
import { createStoryEvent } from "@/server/services/storyEventService";
import { withRecordTaxonomy } from "@/world/taxonomy";
import { createTestDb, IDS, makePackage, seedProject, type TestDb } from "../helpers";

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
    bookProjectId: IDS.project,
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

describe("W5C living world profile history", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(() => t.cleanup());

  it("station chronology: unknown without dates, open then closed, sticky + supersede restore", async () => {
    const book2 = "prj_station_book2";
    await createProject(t.db, {
      id: book2,
      workspaceId: IDS.workspace,
      title: "Book Two",
    });
    await t.db.project.update({
      where: { id: IDS.project },
      data: { seriesName: "Station Series", bookName: "Book One" },
    });
    await t.db.project.update({
      where: { id: book2 },
      data: { seriesName: "Station Series", bookName: "Book Two" },
    });

    const evOpen = await createStoryEvent(t.db, IDS.project, { title: "Station opens" });
    const evClose = await createStoryEvent(t.db, book2, { title: "Station closes" });
    await t.db.storyEventOrder.create({
      data: {
        id: `evo_${evOpen.id}_${evClose.id}`,
        projectId: IDS.project,
        earlierEventId: evOpen.id,
        laterEventId: evClose.id,
      },
    });

    const fields = withRecordTaxonomy(
      { kind: "place", climate: "coastal fog" },
      { version: 1, primary: { category: "locations" } },
    );
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: 1,
      fields: withWorldProfile(fields, {
        ...emptyWorldProfile(),
        definitionId: "category:locations",
        values: { access: "east entrance closed" },
        fieldMeta: {
          "values.access": { approval: "draft", provenance: { origin: "author", note: "" } },
        },
        fieldHistory: [],
      }),
    });

    let saved = await getRecord(t.db, IDS.project, IDS.world);
    let profile = readWorldProfile(saved.fields).profile;
    expect(profile.values.access).toBe("east entrance closed");
    const books = [
      { projectId: IDS.project, narrativeIndex: 0 },
      { projectId: book2, narrativeIndex: 1 },
    ];
    expect(
      resolveWorldFieldsAtPoint(
        profile,
        { bookProjectId: IDS.project, storyEventId: evOpen.id, sequence: null, boundary: "at_point" },
        [],
        { books, fieldPaths: ["values.access"] },
      ).fields["values.access"]?.presence,
    ).toBe("unknown");

    const withHistory = {
      ...profile,
      fieldHistory: [
        historyChange({
          id: "wfh_open",
          fieldPath: "values.access",
          value: "open",
          bookProjectId: IDS.project,
          storyEventId: evOpen.id,
        }),
        historyChange({
          id: "wfh_close",
          fieldPath: "values.access",
          value: "closed",
          bookProjectId: book2,
          storyEventId: evClose.id,
        }),
        historyChange({
          id: "wfh_reopen",
          fieldPath: "values.access",
          value: "reopened",
          bookProjectId: book2,
          storyEventId: evClose.id,
          planned: true,
          approval: "proposed",
        }),
        historyChange({
          id: "wfh_climate",
          fieldPath: "fields.climate",
          storage: "flat",
          value: "arid after quake",
          bookProjectId: IDS.project,
          storyEventId: evOpen.id,
        }),
      ],
    };
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: saved.currentRevision,
      fields: withWorldProfile(saved.fields, withHistory),
    });

    saved = await getRecord(t.db, IDS.project, IDS.world);
    profile = readWorldProfile(saved.fields).profile;
    expect(saved.fields.climate).toBe("coastal fog");
    expect(profile.fieldHistory).toHaveLength(4);

    const edges = [{ earlierId: evOpen.id, laterId: evClose.id }];
    expect(
      resolveWorldFieldsAtPoint(
        profile,
        { bookProjectId: IDS.project, storyEventId: evOpen.id, sequence: null, boundary: "at_point" },
        edges,
        { books, fieldPaths: ["values.access"] },
      ).fields["values.access"],
    ).toMatchObject({ formatted: "open", changeId: "wfh_open" });
    expect(
      resolveWorldFieldsAtPoint(
        profile,
        { bookProjectId: book2, storyEventId: evClose.id, sequence: null, boundary: "at_point" },
        edges,
        { books, fieldPaths: ["values.access"] },
      ).fields["values.access"],
    ).toMatchObject({ formatted: "closed", changeId: "wfh_close" });

    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: saved.currentRevision,
      fields: withRecordTaxonomy(saved.fields, {
        version: 1,
        primary: { category: "locations" },
        secondary: [{ category: "geography" }],
        tags: ["station"],
      }),
    });
    saved = await getRecord(t.db, IDS.project, IDS.world);
    profile = readWorldProfile(saved.fields).profile;
    expect(profile.definitionId).toBe("category:locations");
    expect(profile.fieldHistory).toHaveLength(4);

    const revisionBeforeCorrect = saved.currentRevision;
    const corrected = supersedeWorldFieldChange(
      profile,
      "wfh_close",
      {
        ...historyChange({
          id: "wfh_sealed",
          fieldPath: "values.access",
          value: "sealed",
          bookProjectId: book2,
          storyEventId: evClose.id,
        }),
        correctionNote: "Stronger closure",
      },
      () => "wfh_sealed",
    );
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: saved.currentRevision,
      fields: withWorldProfile(saved.fields, corrected.profile),
    });
    const afterCorrect = await getRecord(t.db, IDS.project, IDS.world);
    await restoreRecordFromRevision(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: afterCorrect.currentRevision,
      fromRevisionNumber: revisionBeforeCorrect,
      includeFields: true,
    });
    const restored = await getRecord(t.db, IDS.project, IDS.world);
    const restoredProfile = readWorldProfile(restored.fields).profile;
    expect(restoredProfile.fieldHistory.some((c) => c.id === "wfh_close" && c.approval === "approved")).toBe(true);
    expect(restoredProfile.fieldHistory.some((c) => c.id === "wfh_sealed")).toBe(false);
  });

  it("protects, refuses stale revision, applies history via package, redacts export", async () => {
    const ev = await createStoryEvent(t.db, IDS.project, { title: "Gate opens" });
    const profile = {
      ...emptyWorldProfile(),
      definitionId: "category:locations",
      values: { access: "closed" },
      fieldHistory: [
        historyChange({
          id: "wfh_open",
          fieldPath: "values.access",
          value: "open",
          storyEventId: ev.id,
        }),
        historyChange({
          id: "wfh_later",
          fieldPath: "values.access",
          value: "maybe",
          approval: "draft",
          storyEventId: ev.id,
        }),
      ],
    };
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: 1,
      fields: withWorldProfile({ kind: "place" }, profile),
    });
    await setProtection(t.db, IDS.project, IDS.world, true);
    const locked = await getRecord(t.db, IDS.project, IDS.world);
    await expect(
      updateRecord(t.db, IDS.project, {
        recordId: IDS.world,
        expectedRevision: locked.currentRevision,
        fields: withWorldProfile(locked.fields, { ...profile, summary: "blocked" }),
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: locked.currentRevision,
      unlockProtected: true,
      fields: withWorldProfile(locked.fields, { ...profile, summary: "unlocked" }),
    });
    const unlocked = await getRecord(t.db, IDS.project, IDS.world);
    await expect(
      updateRecord(t.db, IDS.project, {
        recordId: IDS.world,
        expectedRevision: unlocked.currentRevision - 1,
        unlockProtected: true,
        fields: withWorldProfile(unlocked.fields, { ...profile, summary: "stale" }),
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    const pkg = makePackage({
      summary: "Add station history",
      operations: [
        {
          op: "update_record",
          recordId: IDS.world,
          expectedRevision: unlocked.currentRevision,
          changes: {
            fields: {
              set: {
                [WORLD_PROFILE_KEY]: JSON.parse(
                  JSON.stringify({
                    ...emptyWorldProfile(),
                    definitionId: "category:locations",
                    values: { access: "closed" },
                    summary: "from package",
                    fieldHistory: [
                      historyChange({
                        id: "wfh_pkg",
                        fieldPath: "values.access",
                        value: "open via package",
                        storyEventId: ev.id,
                      }),
                    ],
                  }),
                ) as JsonObject,
              },
            },
          },
        },
      ],
      protectedOverrides: [IDS.world],
    });
    const applied = await applyChangePackage(t.db, pkg, { projectId: IDS.project }, { confirmProtected: true });
    expect(applied.status).toBe("applied");

    const afterPkg = await getRecord(t.db, IDS.project, IDS.world);
    expect(readWorldProfile(afterPkg.fields).profile.fieldHistory.some((c) => c.id === "wfh_pkg")).toBe(true);

    await createRecord(t.db, IDS.project, {
      recordId: "rec_station_scene",
      type: "manuscript_scene",
      title: "At the gate",
      body: "They walked in.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    await t.db.storyEventScene.create({
      data: {
        id: `ses_${ev.id}_rec_station_scene`,
        projectId: IDS.project,
        eventId: ev.id,
        manuscriptRecordId: "rec_station_scene",
      },
    });

    const bundle = await exportContextBundle(t.db, IDS.project, {
      recordIds: [IDS.world],
      focusRecordId: "rec_station_scene",
    });
    const exported = bundle.records.find((r) => r.id === IDS.world);
    expect(exported).toBeTruthy();
    const exportedProfile = readWorldProfile(exported!.fields).profile;
    expect(exportedProfile.fieldHistory.every((c) => c.approval === "approved" && !c.planned)).toBe(true);
    expect(exportedProfile.fieldHistory.some((c) => c.id === "wfh_later")).toBe(false);
    expect(bundle.readingInstructions.some((line) => line.includes("fieldHistory"))).toBe(true);
  });

  it("sibling cannot write series-home world profile history", async () => {
    const sibling = "prj_hist_sibling";
    await createProject(t.db, {
      id: sibling,
      workspaceId: IDS.workspace,
      title: "Sibling",
    });
    await t.db.project.update({
      where: { id: IDS.project },
      data: { seriesName: "Shared World", bookName: "Home" },
    });
    await t.db.project.update({
      where: { id: sibling },
      data: { seriesName: "Shared World", bookName: "Away" },
    });
    await t.db.record.update({ where: { id: IDS.world }, data: { worldScope: "series" } });
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: 1,
      fields: withWorldProfile(
        { kind: "place" },
        {
          ...emptyWorldProfile(),
          definitionId: "category:locations",
          fieldHistory: [
            historyChange({
              id: "wfh_home",
              fieldPath: "values.access",
              value: "open",
            }),
          ],
        },
      ),
    });

    await expect(
      updateRecord(t.db, sibling, {
        recordId: IDS.world,
        expectedRevision: 1,
        fields: withWorldProfile(
          { kind: "place" },
          {
            ...emptyWorldProfile(),
            fieldHistory: [
              historyChange({
                id: "wfh_intruder",
                fieldPath: "values.access",
                value: "hijacked",
              }),
            ],
          },
        ),
      }),
    ).rejects.toThrow();
  });
});
