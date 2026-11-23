import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePackage, createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { applyChangePackage, previewChangePackage } from "@/server/services/changePackageService";
import { acceptEstablishedFact, proposeExtractedFacts } from "@/server/services/establishedFactService";
import { MutationRejectedError } from "@/server/services/errors";
import {
  createRecord,
  getRecord,
  listRecordNav,
  restoreRecordFromRevision,
  setProtection,
  updateRecord,
} from "@/server/services/recordService";
import { TAXONOMY_FIELD_KEY } from "@/world/taxonomy";

describe("World Hub taxonomy foundations", () => {
  let t: TestDb;
  let target: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    target = await createTestDb();
    await seedProject(t.db);
  });

  afterEach(async () => {
    await t.cleanup();
    await target.cleanup();
  });

  it("stores taxonomy on World types without changing type, kind, prose, or canon", async () => {
    const world = await getRecord(t.db, IDS.project, IDS.world);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: world.currentRevision,
      fields: {
        ...world.fields,
        kind: "organization",
        [TAXONOMY_FIELD_KEY]: {
          version: 1,
          primary: { category: "organizations", subcategory: "guilds" },
          secondary: [{ category: "economy", subcategory: "trade" }],
          tags: ["salt"],
        },
      },
    });
    const after = await getRecord(t.db, IDS.project, IDS.world);
    expect(after.type).toBe("worldbuilding");
    expect(after.body).toBe(world.body);
    expect(after.authorityStatus).toBe("approved");
    expect(after.fields.kind).toBe("organization");
    expect(after.fields[TAXONOMY_FIELD_KEY]).toMatchObject({
      version: 1,
      primary: { category: "organizations", subcategory: "guilds" },
    });
    expect(after.currentRevision).toBe(world.currentRevision + 1);

    for (const type of [
      "character_dossier",
      "rules_glossary",
      "research_note",
      "canon_decision",
      "continuity_note",
      "reference_note",
    ] as const) {
      const created = await createRecord(t.db, IDS.project, {
        type,
        title: `Taxonomy ${type}`,
        body: "Note body.",
        fields: {
          [TAXONOMY_FIELD_KEY]: { version: 1, primary: { category: type === "character_dossier" ? "characters" : "magic" } },
        },
        authorityStatus: "draft",
        recordId: `rec_tax_${type}`,
      });
      const row = await getRecord(t.db, IDS.project, created.outcomes[0]!.recordId);
      expect(row.type).toBe(type);
      expect(row.fields[TAXONOMY_FIELD_KEY]).toMatchObject({ version: 1 });
    }

    const nav = await listRecordNav(t.db, IDS.project);
    const guild = nav.find((row) => row.id === IDS.world);
    expect(guild?.taxonomy?.primaryCategory).toBe("organizations");
    expect(guild?.taxonomy?.secondaryCategories).toContain("economy");
  });

  it("rejects invalid taxonomy and taxonomy on manuscript records; respects protection", async () => {
    await expect(
      updateRecord(t.db, IDS.project, {
        recordId: IDS.world,
        expectedRevision: 1,
        fields: { [TAXONOMY_FIELD_KEY]: { version: 2, primary: { category: "magic" } } },
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    await expect(
      updateRecord(t.db, IDS.project, {
        recordId: IDS.chapter,
        expectedRevision: 1,
        fields: { [TAXONOMY_FIELD_KEY]: { version: 1, primary: { category: "history" } } },
        unlockProtected: true,
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    await setProtection(t.db, IDS.project, IDS.world, true);
    await expect(
      updateRecord(t.db, IDS.project, {
        recordId: IDS.world,
        expectedRevision: 1,
        fields: { [TAXONOMY_FIELD_KEY]: { version: 1, primary: { category: "organizations" } } },
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: 1,
      fields: { [TAXONOMY_FIELD_KEY]: { version: 1, primary: { category: "organizations" } } },
      unlockProtected: true,
    });
    const unlocked = await getRecord(t.db, IDS.project, IDS.world);
    expect(unlocked.fields[TAXONOMY_FIELD_KEY]).toMatchObject({ primary: { category: "organizations" } });
  });

  it("skips passage rechecks for taxonomy-only edits and still rechecks prose edits", async () => {
    const [fact] = await proposeExtractedFacts(t.db, IDS.project, {
      subjectRecordId: IDS.dossier,
      evidenceKind: "zero_draft",
      statements: ["The Salt Guild preserves records in salt."],
    });
    await acceptEstablishedFact(t.db, IDS.project, fact.id);
    const world = await getRecord(t.db, IDS.project, IDS.world);
    // Cite the worldbuilding record directly: addFactEvidence only allows manuscript/plan sources.
    await t.db.factEvidence.create({
      data: {
        id: "fev_test_taxonomy",
        factId: fact.id,
        projectId: IDS.project,
        sourceRecordId: IDS.world,
        revisionNumber: world.currentRevision,
        passageStart: 0,
        passageEnd: Math.min(12, world.body.length),
        passageExcerpt: world.body.slice(0, Math.min(12, world.body.length)),
        contentHash: "hash_taxonomy_test",
        evidenceKind: "zero_draft",
        needsRecheck: false,
      },
    });

    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: world.currentRevision,
      fields: {
        ...world.fields,
        [TAXONOMY_FIELD_KEY]: { version: 1, primary: { category: "organizations", subcategory: "guilds" } },
      },
    });
    let evidence = await t.db.factEvidence.findUnique({ where: { id: "fev_test_taxonomy" } });
    expect(evidence?.needsRecheck).toBe(false);

    const afterTaxonomy = await getRecord(t.db, IDS.project, IDS.world);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: afterTaxonomy.currentRevision,
      body: `${afterTaxonomy.body} Expanded.`,
      fields: afterTaxonomy.fields,
    });
    evidence = await t.db.factEvidence.findUnique({ where: { id: "fev_test_taxonomy" } });
    expect(evidence?.needsRecheck).toBe(true);
  });
  it("applies taxonomy through change packages and restores it with includeFields", async () => {
    const before = await getRecord(t.db, IDS.project, IDS.world);
    const pkg = makePackage({
      summary: "Classify the Salt Guild",
      operations: [
        {
          op: "update_record",
          recordId: IDS.world,
          expectedRevision: before.currentRevision,
          changes: {
            fields: {
              set: {
                [TAXONOMY_FIELD_KEY]: {
                  version: 1,
                  primary: { category: "organizations", subcategory: "guilds" },
                  tags: ["salt"],
                },
              },
            },
          },
        },
      ],
    });
    const preview = await previewChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(preview.status).toBe("valid");
    expect(preview.canApply).toBe(true);
    const applied = await applyChangePackage(t.db, pkg, { projectId: IDS.project });
    expect(applied.status).toBe("applied");
    const classified = await getRecord(t.db, IDS.project, IDS.world);
    expect(classified.fields[TAXONOMY_FIELD_KEY]).toMatchObject({
      primary: { category: "organizations", subcategory: "guilds" },
    });

    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: classified.currentRevision,
      fields: { ...classified.fields, [TAXONOMY_FIELD_KEY]: { version: 1, primary: { category: "law" } } },
    });
    const changed = await getRecord(t.db, IDS.project, IDS.world);
    await restoreRecordFromRevision(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: changed.currentRevision,
      fromRevisionNumber: classified.currentRevision,
      includeFields: true,
    });
    const restored = await getRecord(t.db, IDS.project, IDS.world);
    expect(restored.fields[TAXONOMY_FIELD_KEY]).toMatchObject({
      primary: { category: "organizations", subcategory: "guilds" },
    });
  });

  it("round-trips taxonomy through workspace backup restore", async () => {
    const world = await getRecord(t.db, IDS.project, IDS.world);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: world.currentRevision,
      fields: {
        ...world.fields,
        kind: "organization",
        [TAXONOMY_FIELD_KEY]: {
          version: 1,
          primary: { category: "organizations" },
          secondary: [{ category: "history", subcategory: "eras" }],
        },
      },
    });
    await t.db.record.update({ where: { id: IDS.world }, data: { worldScope: "series" } });

    const backup = await createWorkspaceBackup(t.db, IDS.workspace);
    const outcome = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "preserve" });
    expect(outcome.ok).toBe(true);
    const restored = await getRecord(target.db, IDS.project, IDS.world);
    expect(restored.fields.kind).toBe("organization");
    expect(restored.fields[TAXONOMY_FIELD_KEY]).toMatchObject({
      primary: { category: "organizations" },
      secondary: [{ category: "history", subcategory: "eras" }],
    });
    const scopeRow = await target.db.record.findUnique({ where: { id: IDS.world }, select: { worldScope: true } });
    expect(scopeRow?.worldScope).toBe("series");
  });
});
