import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceBackupV1 } from "@/backup/format.v1";
import { sha256, sha256Bytes, stableStringify } from "@/domain/json";
import { compareInventories, INVENTORY_META_PATHS, inventoryDatabase, type DatabaseInventory } from "@/server/inventory";
import { createWorkspaceBackup, restoreWorkspaceBackup, validateWorkspaceBackup } from "@/server/services/backupService";
import { applyChangePackage } from "@/server/services/changePackageService";
import { getRecord, getRevision, updateRecord } from "@/server/services/recordService";
import { createTestDb, type TestDb } from "../helpers";
import { makePng } from "../imageFixtures";
import { EARLY, FILES, L, PROSE } from "../fixtures/legacy/ids";

/*
 * The frozen legacy fixture (tests/fixtures/legacy, written once by the
 * pre-upgrade code) is the compatibility contract for the upgrade: any later
 * version of the app must restore it, keep its history and refuse the same
 * unsafe packages. Never regenerate the fixture to make this test pass.
 */

const DIR = path.resolve(__dirname, "..", "fixtures", "legacy");
const text = (name: string) => readFileSync(path.join(DIR, name), "utf8");
const json = <T>(name: string) => JSON.parse(text(name)) as T;
const target = { projectId: L.project };

function differences(expected: unknown, actual: DatabaseInventory) {
  return compareInventories(expected as DatabaseInventory, actual, INVENTORY_META_PATHS);
}

/**
 * A backup without its timestamp, checksum, counts, the restore audit entries,
 * and app.migrations (the writing app always lists every migration it knows,
 * which grows when the schema gains optional fields).
 */
function comparable(b: WorkspaceBackupV1) {
  const { createdAt: _c, checksum: _s, counts: _n, ...rest } = b;
  return {
    ...rest,
    app: { name: rest.app.name },
    auditEntries: rest.auditEntries.filter((a) => a.action !== "workspace.restore"),
  };
}

describe("legacy fixture: restore and history", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(() => t.cleanup());

  it("restores the frozen backup with its original IDs and matches the frozen inventory", async () => {
    const outcome = await restoreWorkspaceBackup(t.db, text(L.files.fullBackup), { idStrategy: "preserve" });
    expect(outcome.ok).toBe(true);

    const inventory = inventoryDatabase(t.file);
    expect(differences(json(L.files.expectedInventory), inventory)).toEqual([]);

    const project = inventory.workspaces[0].projects[0];
    expect(project.records.every((r) => r.matchesLatestRevision && r.revisions.every((v) => v.hashValid))).toBe(true);
    expect(project.bookOrder.chapters.slice(0, 3)).toEqual([L.ch03, L.ch01, L.ch02]);
    expect(project.bookOrder.scenes).toEqual({ [L.ch01]: [L.sc01], [L.ch02]: [L.sc02, L.sc03] });
  });

  it("keeps exact prose, every revision, provenance, links, images, imports and the Trash", async () => {
    await restoreWorkspaceBackup(t.db, text(L.files.fullBackup), { idStrategy: "preserve" });

    const chapter = await getRecord(t.db, L.project, L.ch01);
    expect(chapter.body).toBe(PROSE.ch01v2);
    expect(chapter.protected).toBe(true);
    expect(chapter.currentRevision).toBe(2);
    expect((await getRevision(t.db, L.ch01, 1))?.body).toBe(PROSE.ch01v1);

    const dossier = await getRecord(t.db, L.project, L.dossier);
    expect(dossier.body).toBe(PROSE.dossierV2);
    expect(dossier.fields).toEqual({ name: "Ivo Marsh", aliases: ["Ivo"], age: 41 });
    expect((await getRevision(t.db, L.dossier, 1))?.body).toBe(PROSE.dossierV1);
    const rev2 = await t.db.revision.findFirstOrThrow({ where: { recordId: L.dossier, revisionNumber: 2 }, include: { source: true } });
    expect(rev2.source).toMatchObject({ kind: "change_package", packageId: L.appliedPackage, conversationLabel: "Legacy fixture conversation" });

    const decision = await getRecord(t.db, L.project, L.decision);
    expect(decision).toMatchObject({ authorityStatus: "superseded", supersededByRecordId: L.decisionV2 });
    expect((await getRecord(t.db, L.project, L.world)).protected).toBe(true);
    expect((await getRecord(t.db, L.project, L.note01)).parentRecordId).toBe(L.sc01);

    const links = await t.db.recordLink.findMany({ orderBy: { createdAt: "asc" } });
    expect(links.map((l) => [l.fromRecordId, l.toRecordId])).toEqual([
      [L.sc01, L.dossier],
      [L.ch02, L.world],
    ]);
    const image = await t.db.recordImage.findFirstOrThrow({ where: { recordId: L.dossier } });
    expect(sha256Bytes(image.data)).toBe(sha256Bytes(makePng(3, 2)));
    expect(image).toMatchObject({ caption: "Ivo at the quay", altText: "A small brown square", mimeType: "image/png" });

    const imported = await t.db.importedFile.findMany({ orderBy: { originalFilename: "asc" } });
    expect(imported.map((f) => [f.originalFilename, f.content])).toEqual([
      [FILES.chapter4.filename, FILES.chapter4.content],
      [FILES.glossary.filename, FILES.glossary.content],
    ]);

    const trashed = await t.db.record.findUniqueOrThrow({ where: { id: L.trashed } });
    expect(trashed.trashedAt).not.toBeNull();
    await expect(getRecord(t.db, L.project, L.trashed)).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("backs up again to the same content it was restored from", async () => {
    const fixture = json<WorkspaceBackupV1>(L.files.fullBackup);
    await restoreWorkspaceBackup(t.db, text(L.files.fullBackup), { idStrategy: "preserve" });
    expect(comparable(await createWorkspaceBackup(t.db, L.workspace))).toEqual(comparable(fixture));
  });

  it("restores beside existing work with new IDs, keeping revisions and package identity", async () => {
    await restoreWorkspaceBackup(t.db, text(L.files.fullBackup), { idStrategy: "preserve" });
    const collision = await restoreWorkspaceBackup(t.db, text(L.files.fullBackup), { idStrategy: "preserve" });
    expect(collision.ok === false && collision.issues.map((i) => i.code)).toContain("BACKUP_ID_COLLISION");

    const copy = await restoreWorkspaceBackup(t.db, text(L.files.fullBackup), { idStrategy: "remap" });
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    const inventory = inventoryDatabase(t.file);
    const [original, restored] = [L.workspace, copy.workspaceId].map((id) => inventory.workspaces.find((w) => w.id === id)!.projects[0]);
    expect(restored.counts).toEqual(original.counts);
    // Revision hashes cover superseded-by IDs, which a copy rewrites, so compare the text and the revision count.
    const texts = (p: typeof original) => p.records.map((r) => [r.titleSha256, r.bodySha256, r.fieldsSha256, r.revisions.length]).sort();
    expect(texts(restored)).toEqual(texts(original));
    expect(restored.records.every((r) => r.matchesLatestRevision && r.revisions.every((v) => v.hashValid))).toBe(true);

    const reapply = await applyChangePackage(t.db, text(L.files.applied), { projectId: restored.id });
    expect(reapply.status).toBe("already_applied");
  });
});

describe("legacy fixture: unsafe packages are refused", () => {
  let t: TestDb;
  let before: DatabaseInventory;
  beforeEach(async () => {
    t = await createTestDb();
    await restoreWorkspaceBackup(t.db, text(L.files.fullBackup), { idStrategy: "preserve" });
    before = inventoryDatabase(t.file);
  });
  afterEach(() => t.cleanup());

  const unchanged = () => expect(differences(before, inventoryDatabase(t.file))).toEqual([]);
  const codes = (outcome: Awaited<ReturnType<typeof applyChangePackage>>) => (outcome.status === "rejected" ? outcome.issues.map((i) => i.code) : []);

  it("refuses protected writes without an explicit override and confirmation", async () => {
    const referenceScope = await applyChangePackage(t.db, text(L.files.protectedReference), target, { confirmProtected: true });
    expect(referenceScope.status).toBe("rejected");
    expect(codes(referenceScope)).toEqual(expect.arrayContaining(["SCOPE_VIOLATION", "PROTECTED_RECORD"]));

    const unconfirmed = await applyChangePackage(t.db, text(L.files.protectedManuscript), target);
    expect(codes(unconfirmed)).toContain("PROTECTED_CONFIRMATION_REQUIRED");

    await expect(
      updateRecord(t.db, L.project, { recordId: L.ch01, expectedRevision: 2, body: "Unlocked? No." }),
    ).rejects.toMatchObject({ name: "MutationRejectedError" });
    unchanged();
    expect((await getRecord(t.db, L.project, L.ch01)).body).toBe(PROSE.ch01v2);

    // The explicit path still works: manuscript scope, override and the author's confirmation.
    const confirmed = await applyChangePackage(t.db, text(L.files.protectedManuscript), target, { confirmProtected: true });
    expect(confirmed.status).toBe("applied");
    expect((await getRecord(t.db, L.project, L.ch01)).currentRevision).toBe(3);
    expect((await getRevision(t.db, L.ch01, 2))?.body).toBe(PROSE.ch01v2);
  });

  it("refuses a package written against an older revision", async () => {
    const stale = await applyChangePackage(t.db, text(L.files.stale), target);
    expect(codes(stale)).toEqual(["STALE_REVISION"]);
    unchanged();
  });

  it("treats a repeated package as already applied and a reused ID with new content as a conflict", async () => {
    const again = await applyChangePackage(t.db, text(L.files.applied), target);
    expect(again.status).toBe("already_applied");
    const reformatted = await applyChangePackage(t.db, text(L.files.duplicate), target);
    expect(reformatted.status).toBe("already_applied");
    expect(text(L.files.duplicate)).not.toBe(text(L.files.applied));

    const conflict = await applyChangePackage(t.db, text(L.files.conflict), target);
    expect(conflict.status).toBe("rejected");
    expect(codes(conflict)).toContain("PACKAGE_ID_CONFLICT");
    unchanged();
  });

  it("rejects unsupported package and backup versions before writing", async () => {
    expect(codes(await applyChangePackage(t.db, text(L.files.unsupportedVersion), target))).toEqual(["UNSUPPORTED_FORMAT_VERSION"]);

    const fixture = json<WorkspaceBackupV1>(L.files.fullBackup);
    const future = await validateWorkspaceBackup(t.db, { ...fixture, formatVersion: 2 }, { idStrategy: "remap" });
    expect(future.issues.map((i) => i.code)).toEqual(["UNSUPPORTED_FORMAT_VERSION"]);

    const { checksum: _c, ...body } = fixture;
    const newerSchema = { ...body, app: { ...body.app, migrations: [...body.app.migrations, "20990101000000_from_the_future"] } };
    const signed = { ...newerSchema, checksum: sha256(stableStringify(newerSchema)) };
    const refused = await restoreWorkspaceBackup(t.db, signed, { idStrategy: "remap" });
    expect(refused.ok === false && refused.issues.map((i) => i.message).join(" ")).toContain("newer schema");
    unchanged();
  });

  it("notices a change, so an empty comparison means something", async () => {
    await updateRecord(t.db, L.project, { recordId: L.outline, expectedRevision: 2, body: "1. Changed." });
    const found = differences(before, inventoryDatabase(t.file)).map((d) => d.path);
    expect(found).toContain(`workspaces.[id=${L.workspace}].projects.[id=${L.project}].records.[id=${L.outline}].bodySha256`);
    expect(found).toContain(`workspaces.[id=${L.workspace}].projects.[id=${L.project}].records.[id=${L.outline}].revisions.[n=3]`);
  });
});

describe("legacy fixture: earliest v1 backup shape", () => {
  let t: TestDb;
  beforeEach(async () => {
    t = await createTestDb();
  });
  afterEach(() => t.cleanup());

  it("restores a backup without scenes, book order, Trash, dictionary, links or images", async () => {
    const early = json<Record<string, unknown>>(L.files.earlyBackup);
    expect(early).not.toHaveProperty("recordLinks");
    expect(early).not.toHaveProperty("recordImages");
    expect(early).not.toHaveProperty("dictionaryEntries");

    const outcome = await restoreWorkspaceBackup(t.db, text(L.files.earlyBackup), { idStrategy: "preserve" });
    expect(outcome.ok).toBe(true);
    expect(differences(json(L.files.expectedEarlyInventory), inventoryDatabase(t.file))).toEqual([]);
    expect((await getRecord(t.db, EARLY.project, EARLY.chapter)).parentRecordId).toBeNull();
    expect((await getRevision(t.db, EARLY.dossier, 1))?.body).toBe("Clerk.");
    expect((await getRecord(t.db, EARLY.project, EARLY.dossier)).body).toBe("Senior clerk.");
  });
});
