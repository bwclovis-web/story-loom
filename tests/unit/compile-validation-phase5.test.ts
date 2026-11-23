import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getCompileProfile, upsertCompileProfile } from "@/server/services/compileProfileService";
import { validateManuscriptCompile } from "@/server/services/compileValidationService";
import { createRecord } from "@/server/services/recordService";
import { layoutForPreset } from "@/writing/exportPresets";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";

describe("compile validation (Phase 5)", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });

  afterEach(() => t.cleanup());

  it("marks reader-safe when synopses and comments are off", async () => {
    const current = await getCompileProfile(t.db, IDS.project);
    await upsertCompileProfile(t.db, IDS.project, {
      ...current,
      ...layoutForPreset("ebook"),
      excludedRecordIds: current.excludedRecordIds,
    });
    const report = await validateManuscriptCompile(t.db, IDS.project, {
      sceneTitles: false,
      hasDrafts: false,
      draftId: null,
    });
    expect(report.readerSafe).toBe(true);
    expect(report.issues.some((i) => i.code === "PACKAGE_METADATA")).toBe(true);
  });

  it("warns when drop cap pairs with mono manuscript spacing", async () => {
    const current = await getCompileProfile(t.db, IDS.project);
    await upsertCompileProfile(t.db, IDS.project, {
      ...current,
      ...layoutForPreset("standard_manuscript"),
      dropCap: true,
      excludedRecordIds: current.excludedRecordIds,
    });
    const report = await validateManuscriptCompile(t.db, IDS.project, {
      sceneTitles: false,
      hasDrafts: false,
      draftId: null,
    });
    expect(report.issues.some((i) => i.code === "LAYOUT_DROP_CAP_MONO")).toBe(true);
    expect(report.issues.some((i) => i.code === "LAYOUT_DROP_CAP_MANUSCRIPT")).toBe(true);
  });

  it("resolves [[links]] against known titles", async () => {
    await createRecord(t.db, IDS.project, {
      type: "worldbuilding",
      title: "Harbour",
      body: "Stone quay.",
      fields: { kind: "place" },
      authorityStatus: "approved",
    });
    await createRecord(t.db, IDS.project, {
      type: "manuscript_scene",
      title: "Named quay",
      body: "[[Harbour]] waited in the fog. [[Missing Place]] did not.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    const report = await validateManuscriptCompile(t.db, IDS.project, {
      sceneTitles: false,
      hasDrafts: false,
      draftId: null,
    });
    const linkIssue = report.issues.find((i) => i.code === "UNRESOLVED_LINKS" && i.title.includes("Named quay"));
    expect(linkIssue?.detail).toContain("Missing Place");
    expect(linkIssue?.detail).not.toContain("[[Harbour]]");
  });
});
