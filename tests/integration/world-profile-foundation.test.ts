import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WORLD_PROFILE_KEY } from "@/domain/worldProfile";
import {
  readWorldMarkdownArchive,
  WORLD_MARKDOWN_ARCHIVE_KEY,
} from "@/domain/worldProfileUpgrade";
import { applyChangePackage, previewChangePackage } from "@/server/services/changePackageService";
import { createProject } from "@/server/services/projectService";
import { getRecord, restoreRecordFromRevision, updateRecord } from "@/server/services/recordService";
import {
  deleteWorldCategory,
  listAvailableWorldCategories,
  saveWorldCategory,
  setWorldCategoryScope,
} from "@/server/services/worldCategoryService";
import {
  listAvailableWorldKindTemplates,
  saveWorldKindTemplate,
} from "@/server/services/worldKindTemplateService";
import {
  applyWorldProfileUpgrade,
  buildWorldProfileUpgradePackage,
  previewWorldProfileUpgrade,
} from "@/server/services/worldProfileUpgradeService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

const FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "world-profile-upgrade.md"), "utf8");

describe("world profile foundations integration", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: 1,
      body: FIXTURE,
      fields: { kind: "place" },
    });
  });
  afterEach(() => t.cleanup());

  it("saves custom categories and profile-capable kind templates with series-home collision avoidance", async () => {
    await saveWorldCategory(t.db, {
      projectId: IDS.project,
      slug: "trade_routes",
      label: "Trade routes",
      description: "Merchant corridors",
    });
    await setWorldCategoryScope(t.db, {
      projectId: IDS.project,
      slug: "trade_routes",
      worldScope: "series",
    });

    const siblingId = "prj_test_sibling_world";
    await createProject(t.db, {
      id: siblingId,
      workspaceId: IDS.workspace,
      title: "Sibling novel",
    });
    await t.db.project.update({
      where: { id: IDS.project },
      data: { seriesName: "Saltbound", bookName: "Book One" },
    });
    await t.db.project.update({
      where: { id: siblingId },
      data: { seriesName: "Saltbound", bookName: "Book Two" },
    });

    await saveWorldCategory(t.db, {
      projectId: siblingId,
      slug: "trade_routes",
      label: "Sibling trade routes",
      worldScope: "series",
    });

    const availableHome = await listAvailableWorldCategories(t.db, IDS.project);
    const trade = availableHome.find((row) => row.slug === "trade_routes");
    expect(trade?.label).toBe("Trade routes");
    expect(trade?.home).toBeNull();

    const availableSibling = await listAvailableWorldCategories(t.db, siblingId);
    const siblingView = availableSibling.find((row) => row.slug === "trade_routes");
    expect(siblingView?.label).toBe("Sibling trade routes");

    await saveWorldKindTemplate(t.db, {
      projectId: IDS.project,
      kind: "harbor_league",
      fields: [{ key: "dockFees", label: "Dock fees", multiline: false }],
      definitionId: "custom:harbor_league",
      label: "Harbor league",
      categorySlug: "trade_routes",
      profileSpecJson: JSON.stringify({
        version: 1,
        fields: [{ key: "charterYear", label: "Charter year", type: "number", storage: "profile" }],
        collections: [],
      }),
    });
    const templates = await listAvailableWorldKindTemplates(t.db, IDS.project);
    const harbor = templates.find((row) => row.kind === "harbor_league");
    expect(harbor?.definitionId).toBe("custom:harbor_league");
    expect(harbor?.profileSpecJson).toContain("charterYear");

    await deleteWorldCategory(t.db, { projectId: IDS.project, slug: "trade_routes" });
    // Local row is gone; sibling series-shared definition can still surface under home.
    const afterDelete = await listAvailableWorldCategories(t.db, IDS.project);
    const remaining = afterDelete.find((row) => row.slug === "trade_routes");
    expect(remaining?.home?.projectId).toBe(siblingId);
    expect(remaining?.label).toBe("Sibling trade routes");
  });

  it("upgrades Markdown into worldProfile with archive, protection, and revision rollback", async () => {
    const preview = await previewWorldProfileUpgrade(t.db, IDS.project, IDS.world);
    expect(preview.summary.total).toBeGreaterThan(0);

    const acceptIds = new Set(
      preview.analysis.items
        .filter((item) => /Overview|Geography|Climate/i.test(item.sourceHeading))
        .map((item) => item.id),
    );
    const decisions = preview.analysis.items.map((item) => ({
      itemId: item.id,
      decision: acceptIds.has(item.id) ? ("accept" as const) : ("defer" as const),
    }));

    const first = await applyWorldProfileUpgrade(t.db, IDS.project, IDS.world, {
      previewToken: preview.previewToken,
      decisions,
    });
    expect(first.status).toBe("applied");
    if (first.status !== "applied") return;

    const after = await getRecord(t.db, IDS.project, IDS.world);
    expect(after.body).toBe(FIXTURE);
    expect(after.fields[WORLD_PROFILE_KEY]).toBeTruthy();
    expect(readWorldMarkdownArchive(after.fields).entries).toHaveLength(1);

    const secondPreview = await previewWorldProfileUpgrade(t.db, IDS.project, IDS.world);
    const second = await applyWorldProfileUpgrade(t.db, IDS.project, IDS.world, {
      previewToken: secondPreview.previewToken,
      decisions: secondPreview.analysis.items.map((item) => ({
        itemId: item.id,
        decision: acceptIds.has(item.id) ? ("accept" as const) : ("defer" as const),
      })),
    });
    expect(["already_applied", "applied"]).toContain(second.status);

    await restoreRecordFromRevision(t.db, IDS.project, {
      recordId: IDS.world,
      expectedRevision: after.currentRevision,
      fromRevisionNumber: 1,
      includeFields: true,
    });
    const restored = await getRecord(t.db, IDS.project, IDS.world);
    expect(restored.fields[WORLD_PROFILE_KEY]).toBeUndefined();
    expect(restored.fields[WORLD_MARKDOWN_ARCHIVE_KEY]).toBeUndefined();
  });

  it("exports an inspectable change package that applies cleanly when approved", async () => {
    const preview = await previewWorldProfileUpgrade(t.db, IDS.project, IDS.world);
    const decisions = preview.analysis.items.map((item) => ({
      itemId: item.id,
      decision: /Overview/i.test(item.sourceHeading) ? ("accept" as const) : ("defer" as const),
    }));
    const built = await buildWorldProfileUpgradePackage(t.db, IDS.project, IDS.world, {
      previewToken: preview.previewToken,
      decisions,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const pkg = JSON.parse(built.packageJson) as {
      approval: { status: string; statement?: string };
      [key: string]: unknown;
    };
    expect(pkg.approval.status).toBe("proposed");

    const approved = {
      ...pkg,
      approval: { status: "approved" as const, statement: "Author approved world profile upgrade package" },
    };
    const packagePreview = await previewChangePackage(t.db, approved, { projectId: IDS.project });
    expect(packagePreview.canApply).toBe(true);

    const applied = await applyChangePackage(t.db, approved, { projectId: IDS.project });
    expect(applied.status).toBe("applied");

    const record = await getRecord(t.db, IDS.project, IDS.world);
    expect(record.fields[WORLD_PROFILE_KEY]).toBeTruthy();
  });
});
