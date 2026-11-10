import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceBackupV1 } from "@/backup/format.v1";
import { sha256, stableStringify } from "@/domain/json";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import {
  addRecordImages,
  getImageData,
  listRecordImages,
  removeRecordImage,
  updateRecordImage,
} from "@/server/services/imageService";
import { buildManuscriptPdf, buildReferencesPdf } from "@/server/services/pdfExportService";
import { createRecord, getRecord, setProtection, updateRecord } from "@/server/services/recordService";
import { createTestDb, IDS, seedProject, type TestDb } from "../helpers";
import { makeGifHeader, makePng } from "../imageFixtures";

const codes = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    if (error instanceof MutationRejectedError) return error.issues.map((i) => i.code);
    throw error;
  }
  throw new Error("expected the change to be refused");
};

const UNLOCK = { confirmProtected: false };

describe("images on reference documents", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => t.cleanup());

  it("stores images with their detected type, names them, and changes no record text or revision", async () => {
    const png = makePng(8, 4);
    const added = await addRecordImages(
      t.db,
      IDS.project,
      IDS.dossier,
      [
        { filename: "Mara Portrait.png", bytes: png },
        { filename: "sketch.gif", bytes: makeGifHeader(5, 6) },
      ],
      UNLOCK,
    );
    expect(added.map((a) => [a.name, a.mimeType, a.width, a.height])).toEqual([
      ["mara-portrait.png", "image/png", 8, 4],
      ["sketch.gif", "image/gif", 5, 6],
    ]);
    const again = await addRecordImages(t.db, IDS.project, IDS.dossier, [{ filename: "mara portrait.png", bytes: png }], UNLOCK);
    expect(again[0].name).toBe("mara-portrait-2.png");

    const stored = await getImageData(t.db, IDS.project, added[0].id);
    expect(Buffer.from(stored.data).equals(Buffer.from(png))).toBe(true);
    expect((await listRecordImages(t.db, IDS.project, IDS.dossier))?.map((i) => i.name)).toEqual([
      "mara-portrait.png",
      "sketch.gif",
      "mara-portrait-2.png",
    ]);

    const dossier = await getRecord(t.db, IDS.project, IDS.dossier);
    expect(dossier.currentRevision).toBe(1);
    expect(dossier.body).toBe("Archivist. Thirty years old.");
    const audit = await t.db.auditEntry.findMany({ where: { projectId: IDS.project, action: "record.image.add" } });
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain(Buffer.from(png).toString("base64"));
  });

  it("refuses chapters, wrong files and locked protected documents, writing nothing", async () => {
    const png = makePng(2, 2);
    expect(await codes(addRecordImages(t.db, IDS.project, IDS.chapter, [{ filename: "a.png", bytes: png }], UNLOCK))).toEqual([
      "INVALID_REFERENCE",
    ]);
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");
    expect(
      await codes(
        addRecordImages(
          t.db,
          IDS.project,
          IDS.dossier,
          [
            { filename: "good.png", bytes: png },
            { filename: "renamed.png", bytes: svg },
          ],
          UNLOCK,
        ),
      ),
    ).toEqual(["IMAGE_INVALID"]);

    await setProtection(t.db, IDS.project, IDS.world, true);
    expect(await codes(addRecordImages(t.db, IDS.project, IDS.world, [{ filename: "a.png", bytes: png }], UNLOCK))).toEqual([
      "PROTECTED_CONFIRMATION_REQUIRED",
    ]);
    expect(await t.db.recordImage.count()).toBe(0);

    await addRecordImages(t.db, IDS.project, IDS.world, [{ filename: "a.png", bytes: png }], { confirmProtected: true });
    expect(await t.db.recordImage.count()).toBe(1);
  });

  it("keeps an image the text shows, and audits caption changes and removal", async () => {
    const [img] = await addRecordImages(t.db, IDS.project, IDS.dossier, [{ filename: "map.png", bytes: makePng(3, 3) }], UNLOCK);
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: 1,
      body: "Archivist.\n\n![Harbour](image:map.png)",
    });
    await updateRecordImage(t.db, IDS.project, img.id, { caption: "The harbour at dawn", altText: "A harbour" }, UNLOCK);
    expect((await listRecordImages(t.db, IDS.project, IDS.dossier))?.[0].caption).toBe("The harbour at dawn");

    expect(await codes(removeRecordImage(t.db, IDS.project, img.id, UNLOCK))).toEqual(["INVALID_REFERENCE"]);
    expect(await t.db.recordImage.count()).toBe(1);

    await updateRecord(t.db, IDS.project, { recordId: IDS.dossier, expectedRevision: 2, body: "Archivist." });
    await removeRecordImage(t.db, IDS.project, img.id, UNLOCK);
    expect(await t.db.recordImage.count()).toBe(0);
    const actions = (await t.db.auditEntry.findMany({ where: { action: { startsWith: "record.image." } } })).map((a) => a.action);
    expect(actions.sort()).toEqual(["record.image.add", "record.image.remove", "record.image.update"]);
    expect((await getRecord(t.db, IDS.project, IDS.dossier)).currentRevision).toBe(3);
  });

  it("never serves an image to another project", async () => {
    const [img] = await addRecordImages(t.db, IDS.project, IDS.dossier, [{ filename: "a.png", bytes: makePng(2, 2) }], UNLOCK);
    await expect(getImageData(t.db, "prj_other", img.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("images in workspace backups", () => {
  let source: TestDb;
  let target: TestDb;
  beforeEach(async () => {
    source = await createTestDb();
    target = await createTestDb();
    await seedProject(source.db);
  });
  afterEach(async () => {
    await source.cleanup();
    await target.cleanup();
  });

  it("restores images byte for byte, keeping names so the text still shows them", async () => {
    const png = makePng(6, 6, [10, 120, 200]);
    await addRecordImages(source.db, IDS.project, IDS.dossier, [{ filename: "map.png", bytes: png }], UNLOCK);
    await updateRecord(source.db, IDS.project, { recordId: IDS.dossier, expectedRevision: 1, body: "![Map](image:map.png)" });
    const backup = await createWorkspaceBackup(source.db, IDS.workspace);
    expect(backup.counts.recordImages).toBe(1);

    const preserved = await restoreWorkspaceBackup(target.db, JSON.stringify(backup), { idStrategy: "preserve" });
    expect(preserved.ok).toBe(true);
    const copy = await target.db.recordImage.findFirstOrThrow({ where: { recordId: IDS.dossier } });
    expect(Buffer.from(copy.data).equals(Buffer.from(png))).toBe(true);

    const remapped = await restoreWorkspaceBackup(source.db, backup, { idStrategy: "remap" });
    expect(remapped.ok).toBe(true);
    if (!remapped.ok) return;
    const newProject = remapped.projects[0].id;
    const newDossier = await source.db.record.findFirstOrThrow({ where: { projectId: newProject, title: "Mara Venn" } });
    const images = await listRecordImages(source.db, newProject, newDossier.id);
    expect(images?.map((i) => i.name)).toEqual(["map.png"]);
    expect(images?.[0].id).not.toBe(backup.recordImages?.[0].id);
    expect(images?.[0].id.startsWith("img_")).toBe(true);
    expect(newDossier.body).toBe("![Map](image:map.png)");
  });

  it("rejects a backup whose image data was altered", async () => {
    await addRecordImages(source.db, IDS.project, IDS.dossier, [{ filename: "map.png", bytes: makePng(4, 4) }], UNLOCK);
    const backup = await createWorkspaceBackup(source.db, IDS.workspace);
    const { checksum: _c, ...body } = backup;
    const other = Buffer.from(makePng(4, 4, [0, 0, 0])).toString("base64");
    const altered = { ...body, recordImages: body.recordImages!.map((img) => ({ ...img, dataBase64: other })) };
    const signed: WorkspaceBackupV1 = { ...altered, checksum: sha256(stableStringify(altered)) };
    const outcome = await restoreWorkspaceBackup(target.db, signed, { idStrategy: "preserve" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.issues.map((i) => i.code)).toContain("BACKUP_INTEGRITY");
    expect(await target.db.recordImage.count()).toBe(0);
  });
});

describe("PDF export", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
    await seedProject(t.db);
  });
  afterEach(async () => t.cleanup());

  const isPdf = (bytes: Buffer) => bytes.subarray(0, 5).toString("latin1") === "%PDF-" && bytes.subarray(-6).toString("latin1").includes("%%EOF");

  it("builds a reference PDF with images, and leaves out manuscript records", async () => {
    await addRecordImages(
      t.db,
      IDS.project,
      IDS.dossier,
      [
        { filename: "portrait.png", bytes: makePng(40, 60) },
        { filename: "old.gif", bytes: makeGifHeader(4, 4) },
      ],
      UNLOCK,
    );
    await updateRecord(t.db, IDS.project, {
      recordId: IDS.dossier,
      expectedRevision: 1,
      body: "# Mara\n\n![Portrait](image:portrait.png)\n\n| Trait | Value |\n| --- | --- |\n| Age | 30 |\n\n> Quoted *line*.\n\n- one\n- two\n\n![Gone](image:missing.png)",
    });
    const now = new Date(2026, 9, 26, 12, 0);
    const file = await buildReferencesPdf(t.db, IDS.project, [IDS.dossier, IDS.world, IDS.chapter], now);
    expect(isPdf(file.bytes)).toBe(true);
    expect(file.documentCount).toBe(2);
    expect(file.imagesEmbedded).toBe(1);
    expect(file.pageCount).toBeGreaterThanOrEqual(3);
    expect(file.filename).toBe("test-novel-references-2026-10-26.pdf");

    const single = await buildReferencesPdf(t.db, IDS.project, [IDS.dossier], now);
    expect(single.filename).toBe("test-novel-mara-venn-2026-10-26.pdf");
    expect(single.documentCount).toBe(1);

    await expect(buildReferencesPdf(t.db, IDS.project, [IDS.chapter])).rejects.toBeInstanceOf(NotFoundError);
    await expect(buildReferencesPdf(t.db, "prj_other", [IDS.dossier])).rejects.toBeInstanceOf(NotFoundError);
  });

  it("builds the manuscript in Write-page order, with or without scene titles", async () => {
    await createRecord(t.db, IDS.project, {
      type: "manuscript_scene",
      title: "The wet ledger",
      body: "Water beaded on the page.",
      authorityStatus: "draft",
      parentRecordId: IDS.chapter,
    });
    await createRecord(t.db, IDS.project, { type: "manuscript_chapter", title: "Chapter 2", body: "Ünïcödé — names: Ærin, Łukasz, 東京.", authorityStatus: "draft" });
    for (const sceneTitles of [true, false]) {
      const file = await buildManuscriptPdf(t.db, IDS.project, { sceneTitles }, new Date(2026, 0, 2));
      expect(isPdf(file.bytes)).toBe(true);
      expect(file.documentCount).toBe(2);
      expect(file.pageCount).toBe(3);
      expect(file.filename).toBe("test-novel-manuscript-2026-01-02.pdf");
    }
  });

  it("says when there is no manuscript", async () => {
    const empty = await createTestDb();
    try {
      const { createProject, createWorkspace } = await import("@/server/services/projectService");
      await createWorkspace(empty.db, { id: "wsp_empty", name: "Empty" });
      await createProject(empty.db, { id: "prj_empty", workspaceId: "wsp_empty", title: "Empty" });
      await expect(buildManuscriptPdf(empty.db, "prj_empty", { sceneTitles: false })).rejects.toBeInstanceOf(NotFoundError);
    } finally {
      await empty.cleanup();
    }
  });
});
