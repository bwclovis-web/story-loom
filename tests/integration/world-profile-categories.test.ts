import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptyWorldProfile,
  readWorldProfile,
  WORLD_PROFILE_KEY,
  withWorldProfile,
} from "@/domain/worldProfile";
import { applyWorldProfileUpgrade, previewWorldProfileUpgrade } from "@/server/services/worldProfileUpgradeService";
import { getRecord, restoreRecordFromRevision, updateRecord } from "@/server/services/recordService";
import { createProject } from "@/server/services/projectService";
import {
  listAvailableWorldKindTemplates,
  saveWorldKindTemplate,
} from "@/server/services/worldKindTemplateService";
import { definitionFromKindTemplate, resolveWorldProfileDefinition } from "@/world/worldProfileRegistry";
import { withRecordTaxonomy } from "@/world/taxonomy";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

const CITY_BODY = `# Saltwind

## Climate
Wet winters, cool summers.

## Terrain
Rocky cliffs and eelgrass flats.
`;

const MAGIC_BODY = `# Tide Binding

## Source
The pull of the moon on saltwater.

## Costs
A day of deafness after each working.

## Limits
Cannot bind living blood.

## Workings
Knots spoken over a tide pool.
`;

describe("W5B category profiles — author workflows", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(() => t.cleanup());

  it("keeps legacy climate once and persists a geography profile detail", async () => {
    const fields = withRecordTaxonomy(
      { kind: "place", climate: "Wet winters, cool summers." },
      { version: 1, primary: { category: "geography", subcategory: "cities_and_settlements" } },
    );
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: 1,
      body: CITY_BODY,
      fields: withWorldProfile(fields, {
        ...emptyWorldProfile(),
        definitionId: "category:geography",
        values: { terrain: "Rocky cliffs and eelgrass flats." },
        fieldMeta: {
          "values.terrain": { approval: "draft", provenance: { origin: "author", note: "" } },
        },
      }),
    });

    const saved = await getRecord(t.db, IDS.project, IDS.world);
    expect(saved.fields.climate).toBe("Wet winters, cool summers.");
    const profile = readWorldProfile(saved.fields).profile;
    expect(profile.definitionId).toBe("category:geography");
    expect(profile.values.terrain).toBe("Rocky cliffs and eelgrass flats.");
    expect(saved.id).toBe(IDS.world);

    const withReligion = withRecordTaxonomy(saved.fields, {
      version: 1,
      primary: { category: "geography", subcategory: "cities_and_settlements" },
      secondary: [{ category: "religion", subcategory: "sacred_places" }],
      tags: ["harbor"],
    });
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: saved.currentRevision,
      fields: withReligion,
    });
    const afterTaxonomy = await getRecord(t.db, IDS.project, IDS.world);
    expect(afterTaxonomy.id).toBe(IDS.world);
    expect(afterTaxonomy.fields.climate).toBe("Wet winters, cool summers.");
    const sticky = readWorldProfile(afterTaxonomy.fields).profile;
    expect(sticky.definitionId).toBe("category:geography");
    expect(sticky.values.terrain).toBe("Rocky cliffs and eelgrass flats.");
  });

  it("previews magic Costs/Limits, applies as draft, and stays idempotent", async () => {
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: 1,
      body: MAGIC_BODY,
      fields: withWorldProfile(
        { kind: "magic_system" },
        { ...emptyWorldProfile(), definitionId: "category:magic" },
      ),
    });

    const preview = await previewWorldProfileUpgrade(t.db, IDS.project, IDS.world);
    const costs = preview.analysis.items.find((item) => item.sourceHeading === "Costs");
    const limits = preview.analysis.items.find((item) => item.sourceHeading === "Limits");
    expect(costs?.fieldPath).toBe("costs");
    expect(limits?.fieldPath).toBe("limits");

    const decisions = preview.analysis.items.map((item) => ({
      itemId: item.id,
      decision:
        item.sourceHeading === "Costs" || item.sourceHeading === "Limits" || item.sourceHeading === "Workings"
          ? ("accept" as const)
          : ("defer" as const),
    }));
    const first = await applyWorldProfileUpgrade(t.db, IDS.project, IDS.world, {
      previewToken: preview.previewToken,
      decisions,
    });
    expect(first.status).toBe("applied");

    const after = await getRecord(t.db, IDS.project, IDS.world);
    const profile = readWorldProfile(after.fields).profile;
    expect(profile.values.costs).toContain("deafness");
    expect(after.fields.limits).toContain("living blood");
    expect(profile.fieldMeta["values.costs"]?.provenance.origin).toBe("extracted");
    expect(profile.fieldMeta["values.costs"]?.approval).toBe("draft");

    const secondPreview = await previewWorldProfileUpgrade(t.db, IDS.project, IDS.world);
    const second = await applyWorldProfileUpgrade(t.db, IDS.project, IDS.world, {
      previewToken: secondPreview.previewToken,
      decisions: secondPreview.analysis.items.map((item) => ({
        itemId: item.id,
        decision:
          item.sourceHeading === "Costs" || item.sourceHeading === "Limits" || item.sourceHeading === "Workings"
            ? ("accept" as const)
            : ("defer" as const),
      })),
    });
    expect(["already_applied", "applied"]).toContain(second.status);
    const again = readWorldProfile((await getRecord(t.db, IDS.project, IDS.world)).fields).profile;
    expect(Object.keys(again.values).filter((key) => key === "costs")).toHaveLength(1);
  });

  it("resolves home-book template labels for a shared kind name", async () => {
    const siblingId = "prj_w5b_sibling";
    await createProject(t.db, { id: siblingId, workspaceId: IDS.workspace, title: "Sibling" });
    await t.db.project.update({
      where: { id: IDS.project },
      data: { seriesName: "Saltbound", bookName: "Book One" },
    });
    await t.db.project.update({
      where: { id: siblingId },
      data: { seriesName: "Saltbound", bookName: "Book Two" },
    });

    await saveWorldKindTemplate(t.db, {
      projectId: IDS.project,
      kind: "harbor_league",
      fields: [{ key: "dockFees", label: "Home dock fees", multiline: false }],
      definitionId: "custom:harbor_home",
      label: "Home harbor labels",
      worldScope: "series",
    });
    await saveWorldKindTemplate(t.db, {
      projectId: siblingId,
      kind: "harbor_league",
      fields: [{ key: "dockFees", label: "Sibling dock fees", multiline: false }],
      definitionId: "custom:harbor_sibling",
      label: "Sibling harbor labels",
      worldScope: "series",
    });

    const { listWorldKindTemplates } = await import("@/server/services/worldKindTemplateService");
    const homeTemplates = await listWorldKindTemplates(t.db, IDS.project);
    const siblingView = await listAvailableWorldKindTemplates(t.db, siblingId);
    // Viewing from the sibling still resolves a home-owned record against home templates first.
    const resolved = resolveWorldProfileDefinition({
      fields: { kind: "harbor_league" },
      recordProjectId: IDS.project,
      templates: [
        ...homeTemplates,
        ...siblingView.filter((row) => row.projectId !== IDS.project),
      ],
    });
    expect(resolved?.label).toBe("Home harbor labels");
    expect(definitionFromKindTemplate(homeTemplates.find((row) => row.kind === "harbor_league")!).label).toBe(
      "Home harbor labels",
    );
  });

  it("restores worldProfile through revision rollback", async () => {
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: 1,
      fields: withWorldProfile(
        { kind: "place", climate: "Fog" },
        { ...emptyWorldProfile(), definitionId: "category:geography", values: { terrain: "Cliffs" } },
      ),
    });
    const mid = await getRecord(t.db, IDS.project, IDS.world);
    expect(mid.fields[WORLD_PROFILE_KEY]).toBeTruthy();

    await restoreRecordFromRevision(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: mid.currentRevision,
      fromRevisionNumber: 1,
      includeFields: true,
    });
    const restored = await getRecord(t.db, IDS.project, IDS.world);
    expect(restored.fields[WORLD_PROFILE_KEY]).toBeUndefined();
  });
});
