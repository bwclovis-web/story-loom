import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveExportDraftId } from "@/server/draftSelection";
import { inventoryDatabase } from "@/server/inventory";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { applyChangePackage } from "@/server/services/changePackageService";
import {
  getDraftDefaults,
  listManuscriptDrafts,
  setDefaultExportDraft,
  startAuthorRewrite,
} from "@/server/services/draftService";
import { addRecordImages } from "@/server/services/imageService";
import { buildManuscriptPdf } from "@/server/services/pdfExportService";
import { getRecord, listRecordNav } from "@/server/services/recordService";
import { addWorldMapPin, createWorldMap, getWorldMap } from "@/server/services/worldMapService";
import { createTestDb, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";
import { L, PROSE } from "../fixtures/legacy/ids";

/*
 * Rehearses the Step 0 → current-app upgrade contract on an isolated database:
 * restore the frozen legacy baseline, keep history, refuse/accept packages as
 * before, then exercise post-baseline features (drafts, map pins, export draft)
 * with invented data only. Never touches prisma/dev.db.
 */

const DIR = path.resolve(__dirname, "..", "fixtures", "legacy");
const text = (name: string) => readFileSync(path.join(DIR, name), "utf8");
const UNLOCK = { confirmProtected: true };

describe("Step 0 upgrade rehearsal (isolated)", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("restores baseline records/history, applies a legacy package safely, then verifies drafts, map pins and export draft", async () => {
    const restored = await restoreWorkspaceBackup(t.db, text(L.files.fullBackup), { idStrategy: "preserve" });
    expect(restored.ok).toBe(true);

    const chapter = await getRecord(t.db, L.project, L.ch01);
    expect(chapter.body).toBe(PROSE.ch01v2);
    expect(chapter.currentRevision).toBe(2);
    const dossier = await getRecord(t.db, L.project, L.dossier);
    expect(dossier.body).toBe(PROSE.dossierV2);

    const inventory = inventoryDatabase(t.file);
    const project = inventory.workspaces[0]!.projects[0]!;
    expect(project.records.every((r) => r.matchesLatestRevision)).toBe(true);

    const target = { projectId: L.project };

    // Already-applied package stays idempotent.
    const again = await applyChangePackage(t.db, text(L.files.applied), target);
    expect(again.status).toBe("already_applied");

    // Stale package is refused; prose unchanged.
    const stale = await applyChangePackage(t.db, text(L.files.stale), target);
    expect(stale.status).toBe("rejected");
    if (stale.status === "rejected") {
      expect(stale.issues.map((i) => i.code)).toEqual(["STALE_REVISION"]);
    }
    expect((await getRecord(t.db, L.project, L.dossier)).body).toBe(PROSE.dossierV2);

    // Post-baseline: both drafts survive backup round-trip.
    const started = await startAuthorRewrite(t.db, L.project);
    expect(started.alreadyExisted).toBe(false);
    const drafts = await listManuscriptDrafts(t.db, L.project);
    expect(drafts.map((d) => d.kind).sort()).toEqual(["author_manuscript", "zero_draft"]);
    const zero = drafts.find((d) => d.kind === "zero_draft")!;
    const author = drafts.find((d) => d.kind === "author_manuscript")!;
    await setDefaultExportDraft(t.db, L.project, author.id);

    const [img] = await addRecordImages(
      t.db,
      L.project,
      L.world,
      [{ filename: "rehearsal-chart.png", bytes: makePng(20, 16) }],
      UNLOCK,
    );
    const map = await createWorldMap(t.db, L.project, { title: "Rehearsal chart", imageId: img.id });
    const pin = await addWorldMapPin(t.db, L.project, map.id, {
      recordId: L.dossier,
      xNorm: 0.33,
      yNorm: 0.66,
    });
    expect(pin.recordId).toBe(L.dossier);
    const mapView = await getWorldMap(t.db, L.project, map.id);
    expect(mapView.pins.map((p) => p.recordId)).toEqual([L.dossier]);
    expect(mapView.pins[0]!.title).toContain("Ivo");

    const defaults = await getDraftDefaults(t.db, L.project);
    expect(resolveExportDraftId(drafts, defaults, null)).toBe(author.id);
    expect(resolveExportDraftId(drafts, defaults, zero.id)).toBe(zero.id);

    const authorNav = await listRecordNav(t.db, L.project, { hasDrafts: true, draftId: author.id });
    const zeroNav = await listRecordNav(t.db, L.project, { hasDrafts: true, draftId: zero.id });
    expect(authorNav.some((r) => r.type === "manuscript_chapter")).toBe(true);
    expect(zeroNav.some((r) => r.id === L.ch01)).toBe(true);
    expect((await getRecord(t.db, L.project, L.ch01)).body).toBe(PROSE.ch01v2);

    const pdfAuthor = await buildManuscriptPdf(t.db, L.project, {
      sceneTitles: false,
      draftId: author.id,
      hasDrafts: true,
    });
    const pdfZero = await buildManuscriptPdf(t.db, L.project, {
      sceneTitles: false,
      draftId: zero.id,
      hasDrafts: true,
    });
    expect(pdfAuthor.bytes.byteLength).toBeGreaterThan(100);
    expect(pdfZero.bytes.byteLength).toBeGreaterThan(100);
    // Author rewrite pages start blank; Zero draft keeps baseline prose → different PDFs.
    expect(Buffer.compare(pdfAuthor.bytes, pdfZero.bytes) !== 0).toBe(true);

    const backup = await createWorkspaceBackup(t.db, L.workspace);
    expect(backup.manuscriptDrafts?.length).toBe(2);
    expect(backup.worldMaps?.length).toBe(1);
    expect(backup.worldMapPins?.some((p) => p.recordId === L.dossier)).toBe(true);

    const copy = await createTestDb();
    try {
      const roundTrip = await restoreWorkspaceBackup(copy.db, backup, { idStrategy: "remap" });
      expect(roundTrip.ok).toBe(true);
      if (!roundTrip.ok) return;
      const projectId = roundTrip.projects[0]!.id;
      const restoredDrafts = await listManuscriptDrafts(copy.db, projectId);
      expect(restoredDrafts.map((d) => d.kind).sort()).toEqual(["author_manuscript", "zero_draft"]);
      const restoredDefaults = await getDraftDefaults(copy.db, projectId);
      const authorAgain = restoredDrafts.find((d) => d.kind === "author_manuscript")!;
      expect(restoredDefaults.defaultExportDraftId).toBe(authorAgain.id);
      expect(resolveExportDraftId(restoredDrafts, restoredDefaults, null)).toBe(authorAgain.id);

      const maps = await copy.db.worldMap.findMany({ where: { projectId } });
      expect(maps).toHaveLength(1);
      const pins = await copy.db.worldMapPin.findMany({ where: { mapId: maps[0]!.id } });
      expect(pins).toHaveLength(1);
      const pinRecord = await copy.db.record.findUniqueOrThrow({ where: { id: pins[0]!.recordId! } });
      expect(pinRecord.type).toBe("character_dossier");
      expect(pinRecord.title).toContain("Ivo");
    } finally {
      await copy.cleanup();
    }
  });
});
