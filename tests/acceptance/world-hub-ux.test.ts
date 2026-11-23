import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MutationRejectedError } from "@/server/services/errors";
import {
  applyBulkTaxonomy,
  previewBulkTaxonomy,
} from "@/server/services/taxonomyOrganizeService";
import {
  createRecord,
  getRecord,
  listWorldIndex,
  setProtection,
  updateRecord,
} from "@/server/services/recordService";
import { acceptEstablishedFact, proposeExtractedFacts } from "@/server/services/establishedFactService";
import {
  discoverWorldHubRecords,
  parseWorldHubQuery,
  projectWorldHubRecord,
} from "@/world/hubDiscovery";
import { TAXONOMY_FIELD_KEY, withoutRecordTaxonomy } from "@/world/taxonomy";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("World Hub navigation and creation UX", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("creates with category, subcategory, secondary, tags, and initial worldScope", async () => {
    const created = await createRecord(t.db, IDS.project, {
      type: "worldbuilding",
      title: "Harbor Watch",
      body: "Guards the tide wall.",
      fields: {
        kind: "organization",
        [TAXONOMY_FIELD_KEY]: {
          version: 1,
          primary: { category: "organizations", subcategory: "guilds" },
          secondary: [{ category: "geography", subcategory: "cities_and_settlements" }],
          tags: ["harbor"],
        },
      },
      authorityStatus: "draft",
      worldScope: "series",
      recordId: "rec_harbor_watch",
    });
    const row = await getRecord(t.db, IDS.project, created.outcomes[0]!.recordId);
    expect(row.worldScope).toBe("series");
    expect(row.fields.kind).toBe("organization");
    expect(row.fields[TAXONOMY_FIELD_KEY]).toMatchObject({
      primary: { category: "organizations", subcategory: "guilds" },
      secondary: [{ category: "geography", subcategory: "cities_and_settlements" }],
      tags: ["harbor"],
    });

    await expect(
      createRecord(t.db, IDS.project, {
        type: "manuscript_chapter",
        title: "Chapter with scope",
        body: "Nope.",
        fields: {},
        authorityStatus: "draft",
        worldScope: "book",
        recordId: "rec_bad_scope",
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
  });

  it("edits and clears explicit taxonomy with expectedRevision and protection", async () => {
    const before = await getRecord(t.db, IDS.project, IDS.world);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: before.currentRevision,
      fields: {
        ...before.fields,
        kind: "organization",
        [TAXONOMY_FIELD_KEY]: {
          version: 1,
          primary: { category: "organizations", subcategory: "guilds" },
          tags: ["salt"],
        },
      },
    });
    let row = await getRecord(t.db, IDS.project, IDS.world);
    expect(row.fields[TAXONOMY_FIELD_KEY]).toMatchObject({ primary: { category: "organizations" } });

    await setProtection(t.db, IDS.project, IDS.world, true);
    await expect(
      updateRecord(t.db, IDS.project, {
        recordId: IDS.world,
        expectedRevision: row.currentRevision,
        fields: withoutRecordTaxonomy({ ...row.fields }),
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: row.currentRevision,
      fields: withoutRecordTaxonomy({ ...row.fields }),
      unlockProtected: true,
    });
    row = await getRecord(t.db, IDS.project, IDS.world);
    expect(row.fields[TAXONOMY_FIELD_KEY]).toBeUndefined();
    expect(row.fields.kind).toBe("organization");
    expect(row.title).toBe("The Salt Guild");
  });

  it("bulk previews conflicts and applies with protected confirmation without touching needsRecheck", async () => {
    const [fact] = await proposeExtractedFacts(t.db, IDS.project, {
      subjectRecordId: IDS.dossier,
      evidenceKind: "zero_draft",
      statements: ["The Salt Guild preserves records in salt."],
    });
    await acceptEstablishedFact(t.db, IDS.project, fact.id);
    const world = await getRecord(t.db, IDS.project, IDS.world);
    // Kind first (not taxonomy-only), then attach evidence, then classify with taxonomy only.
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: world.currentRevision,
      fields: { ...world.fields, kind: "organization" },
    });
    const withKind = await getRecord(t.db, IDS.project, IDS.world);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: withKind.currentRevision,
      fields: {
        ...withKind.fields,
        [TAXONOMY_FIELD_KEY]: { version: 1, primary: { category: "history" } },
      },
    });
    const classified = await getRecord(t.db, IDS.project, IDS.world);
    await t.db.factEvidence.create({
      data: {
        id: "fev_hub_ux",
        factId: fact.id,
        projectId: IDS.project,
        sourceRecordId: IDS.world,
        revisionNumber: classified.currentRevision,
        passageStart: 0,
        passageEnd: Math.min(12, classified.body.length),
        passageExcerpt: classified.body.slice(0, Math.min(12, classified.body.length)),
        contentHash: "hash_hub_ux",
        evidenceKind: "zero_draft",
        needsRecheck: false,
      },
    });
    await setProtection(t.db, IDS.project, IDS.world, true);
    const protectedRow = await getRecord(t.db, IDS.project, IDS.world);

    const preview = await previewBulkTaxonomy(t.db, IDS.project, {
      recordIds: [IDS.world],
      operation: { setPrimary: { category: "organizations", subcategory: "guilds" }, addTags: ["salt"] },
    });
    expect(preview.items[0]!.protected).toBe(true);
    expect(preview.conflicts.some((c) => c.kind === "overwrite_primary" || c.kind === "legacy_kind")).toBe(true);
    expect(preview.canApply).toBe(false);

    const applied = await applyBulkTaxonomy(t.db, IDS.project, {
      recordIds: [IDS.world],
      operation: { setPrimary: { category: "organizations", subcategory: "guilds" }, addTags: ["salt"] },
      expectedRevisions: { [IDS.world]: protectedRow.currentRevision },
      unlockProtected: true,
    });
    expect(applied.updatedCount).toBe(1);
    const after = await getRecord(t.db, IDS.project, IDS.world);
    expect(after.fields[TAXONOMY_FIELD_KEY]).toMatchObject({
      primary: { category: "organizations", subcategory: "guilds" },
      tags: ["salt"],
    });
    expect(after.body).toBe(classified.body);
    expect(after.fields.kind).toBe("organization");
    const evidence = await t.db.factEvidence.findUnique({ where: { id: "fev_hub_ux" } });
    expect(evidence?.needsRecheck).toBe(false);
  });

  it("surfaces series-shared discovery badges from the world index", async () => {
    await createRecord(t.db, IDS.project, {
      type: "worldbuilding",
      title: "Shared Rite",
      body: "Series lore.",
      fields: { [TAXONOMY_FIELD_KEY]: { version: 1, primary: { category: "religion" } } },
      authorityStatus: "approved",
      worldScope: "series",
      recordId: "rec_shared_rite",
    });
    const index = await listWorldIndex(t.db, IDS.project);
    const hub = index.map(({ record, home }) =>
      projectWorldHubRecord({
        id: record.id,
        title: record.title,
        type: record.type,
        authorityStatus: record.authorityStatus,
        protected: record.protected,
        currentRevision: record.currentRevision,
        worldScope: record.worldScope,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        fields: record.fields,
        home,
      }),
    );
    const religion = discoverWorldHubRecords(hub, parseWorldHubQuery({ category: "religion" }));
    expect(religion.some((r) => r.id === "rec_shared_rite" && r.worldScope === "series")).toBe(true);
  });
});
