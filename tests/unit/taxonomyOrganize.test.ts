import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MutationRejectedError } from "@/server/services/errors";
import { getRecord, setProtection } from "@/server/services/recordService";
import {
  applyBulkTaxonomy,
  applyTaxonomyOperation,
  previewBulkTaxonomy,
} from "@/server/services/taxonomyOrganizeService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
  await seedProject(t.db);
});

afterEach(async () => {
  await t.cleanup();
});

describe("applyTaxonomyOperation", () => {
  it("sets primary, secondary and tags without touching other fields", () => {
    const { fields, problems } = applyTaxonomyOperation(
      { kind: "place", note: "keep" },
      {
        setPrimary: { category: "geography", subcategory: "regions" },
        addSecondary: [{ category: "history" }],
        addTags: ["Salt", "salt", "coast"],
      },
    );
    expect(problems).toEqual([]);
    expect(fields.kind).toBe("place");
    expect(fields.note).toBe("keep");
    expect(fields.taxonomy).toEqual({
      version: 1,
      primary: { category: "geography", subcategory: "regions" },
      secondary: [{ category: "history" }],
      tags: ["Salt", "coast"],
    });
  });

  it("removes the whole classification and keeps unknown taxonomy keys when emptied", () => {
    const cleared = applyTaxonomyOperation({ taxonomy: { version: 1, primary: { category: "law" } } }, { clearTaxonomy: true });
    expect("taxonomy" in cleared.fields).toBe(false);
    const emptied = applyTaxonomyOperation(
      { taxonomy: { version: 1, primary: { category: "law" }, custom: "x" } },
      { setPrimary: null },
    );
    expect(emptied.fields.taxonomy).toEqual({ version: 1, custom: "x" });
  });

  it("refuses an unreadable saved classification", () => {
    const result = applyTaxonomyOperation({ taxonomy: "nope" }, { addTags: ["a"] });
    expect(result.unreadable).toBe(true);
    expect(result.problems.length).toBeGreaterThan(0);
  });
});

describe("bulk taxonomy preview and apply", () => {
  it("previews without writing, then applies one revision per changed record", async () => {
    const operation = { setPrimary: { category: "organizations", subcategory: "guilds" }, addTags: ["salt"] };
    const preview = await previewBulkTaxonomy(t.db, IDS.project, { recordIds: [IDS.world], operation });
    expect(preview.canApply).toBe(true);
    expect(preview.items[0]!.changed).toBe(true);
    expect((await getRecord(t.db, IDS.project, IDS.world)).currentRevision).toBe(1);

    const result = await applyBulkTaxonomy(t.db, IDS.project, {
      recordIds: [IDS.world],
      operation,
      expectedRevisions: preview.revisions,
    });
    expect(result.updatedCount).toBe(1);
    const after = await getRecord(t.db, IDS.project, IDS.world);
    expect(after.currentRevision).toBe(2);
    expect(after.title).toBe("The Salt Guild");
    expect(after.fields.taxonomy).toMatchObject({ primary: { category: "organizations", subcategory: "guilds" }, tags: ["salt"] });

    const audit = await t.db.auditEntry.findFirst({ where: { action: "record.taxonomy_organize" } });
    expect(audit).not.toBeNull();
  });

  it("refuses non-World records and stale previews", async () => {
    const preview = await previewBulkTaxonomy(t.db, IDS.project, {
      recordIds: [IDS.world, IDS.chapter],
      operation: { addTags: ["x"] },
    });
    expect(preview.ineligible.map((item) => item.recordId)).toEqual([IDS.chapter]);
    expect(preview.canApply).toBe(false);
    await expect(
      applyBulkTaxonomy(t.db, IDS.project, { recordIds: [IDS.world, IDS.chapter], operation: { addTags: ["x"] } }),
    ).rejects.toBeInstanceOf(MutationRejectedError);

    await expect(
      applyBulkTaxonomy(t.db, IDS.project, {
        recordIds: [IDS.world],
        operation: { addTags: ["x"] },
        expectedRevisions: { [IDS.world]: 9 },
      }),
    ).rejects.toBeInstanceOf(MutationRejectedError);
  });

  it("needs the unlock confirmation for protected records", async () => {
    await setProtection(t.db, IDS.project, IDS.dossier, true);
    const operation = { setPrimary: { category: "characters", subcategory: "protagonists" } };
    const preview = await previewBulkTaxonomy(t.db, IDS.project, { recordIds: [IDS.dossier], operation });
    expect(preview.protectedRecordIds).toEqual([IDS.dossier]);
    expect(preview.canApply).toBe(false);
    await expect(applyBulkTaxonomy(t.db, IDS.project, { recordIds: [IDS.dossier], operation })).rejects.toBeInstanceOf(
      MutationRejectedError,
    );
    const result = await applyBulkTaxonomy(t.db, IDS.project, {
      recordIds: [IDS.dossier],
      operation,
      unlockProtected: true,
    });
    expect(result.updatedCount).toBe(1);
  });

  it("notes an overwritten primary and a kind mismatch", async () => {
    await applyBulkTaxonomy(t.db, IDS.project, {
      recordIds: [IDS.world],
      operation: { setPrimary: { category: "geography" } },
    });
    const live = await getRecord(t.db, IDS.project, IDS.world);
    expect(live.currentRevision).toBe(2);
    const preview = await previewBulkTaxonomy(t.db, IDS.project, {
      recordIds: [IDS.world],
      operation: { setPrimary: { category: "law" } },
    });
    expect(preview.conflicts.some((item) => item.kind === "overwrite_primary")).toBe(true);
    expect(preview.canApply).toBe(true);
  });
});
