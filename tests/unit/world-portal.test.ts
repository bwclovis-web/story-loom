import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRecord } from "@/server/services/recordService";
import { buildWorldPortalZip } from "@/server/services/worldPortalExport";
import { createTestDb, type TestDb } from "../helpers";
import { ROADMAP_IDS, seedRoadmapSeries } from "../helpers/roadmapFixture";

describe("World Portal export (Phase 5)", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await seedRoadmapSeries(t.db);
  });

  afterEach(() => t.cleanup());

  it("builds a public-safe portal without private notes or revision tables", async () => {
    await createRecord(t.db, ROADMAP_IDS.book1, {
      type: "scene_note",
      title: "Secret quay note",
      body: "Do not leak this planning note into the portal.",
      authorityStatus: "draft",
      parentRecordId: ROADMAP_IDS.scene,
    });

    const file = await buildWorldPortalZip(t.db, ROADMAP_IDS.book1, { mode: "publicSafe" });
    expect(file.contentType).toBe("application/zip");
    expect(file.filename).toContain("world-portal-publicSafe");

    const zip = await JSZip.loadAsync(file.bytes);
    expect(zip.file("portal.html")).toBeTruthy();
    expect(zip.file("PORTAL-README.txt")).toBeTruthy();
    expect(zip.file("data/relationships.json")).toBeTruthy();
    expect(zip.file("data/maps.json")).toBeTruthy();
    expect(zip.file("index.html")).toBeTruthy();

    const readme = (await zip.file("PORTAL-README.txt")?.async("string")) ?? "";
    expect(readme).toMatch(/publicSafe|approved/i);
    expect(readme).toMatch(/Scene notes/);

    const allText = await Promise.all(
      Object.keys(zip.files).map(async (name) => {
        const entry = zip.file(name);
        if (!entry || entry.dir) return "";
        return entry.async("string").catch(() => "");
      }),
    );
    const blob = allText.join("\n");
    expect(blob).not.toContain("Do not leak this planning note into the portal.");
    expect(blob).not.toContain("Secret quay note");
    // Package describes privacy rules; it must not embed assistant secret files or revision tables.
    expect(Object.keys(zip.files).some((name) => /assistant-secrets|revision/i.test(name))).toBe(false);
  });

  it("audits private portal exports", async () => {
    const before = await t.db.auditEntry.count();
    await buildWorldPortalZip(t.db, ROADMAP_IDS.book1, { mode: "private" });
    expect(await t.db.auditEntry.count()).toBeGreaterThan(before);
    const latest = await t.db.auditEntry.findFirst({ orderBy: { createdAt: "desc" } });
    expect(latest?.action).toBe("world_portal.export");
  });
});
