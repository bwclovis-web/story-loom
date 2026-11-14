import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WorkspaceBackupV1 } from "@/backup/format.v1";
import type { ChangePackageV1Input } from "@/changePackage/schema.v1";
import { sha256, stableStringify } from "@/domain/json";
import { inventoryDatabase } from "@/server/inventory";
import { createWorkspaceBackup, knownMigrations, restoreWorkspaceBackup } from "@/server/services/backupService";
import { applyChangePackage } from "@/server/services/changePackageService";
import { applyChapterImport } from "@/server/services/chapterImportService";
import { addDictionaryEntry } from "@/server/services/dictionaryService";
import { addRecordImages, updateRecordImage } from "@/server/services/imageService";
import { linkReference } from "@/server/services/linkService";
import { applyMarkdownImport } from "@/server/services/markdownImportService";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord, moveRecordInBook, moveRecordToTrash, setProtection, updateRecord } from "@/server/services/recordService";
import { listReviewItems, resolveReviewItem } from "@/server/services/reviewService";
import { createTestDb } from "../../helpers";
import { makePng } from "../../imageFixtures";
import { EARLY, FILES, L, PROSE } from "./ids";

/*
 * Builds the frozen legacy fixture with the pre-upgrade code:
 *   pnpm exec tsx tests/fixtures/legacy/generate.ts [--force]
 * The files it writes are the compatibility contract for the upgrade. Once the
 * upgrade starts, never regenerate them with new code; a new app must read
 * these exact bytes. All content is invented.
 */

const OUT = __dirname;

function write(name: string, value: unknown) {
  writeFileSync(path.join(OUT, name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function must<T extends { status: string }>(label: string, outcome: T): T {
  if (outcome.status !== "applied") throw new Error(`${label}: ${JSON.stringify(outcome)}`);
  return outcome;
}

const appliedPackage: ChangePackageV1Input = {
  format: "wordly.change-package",
  formatVersion: 1,
  packageId: L.appliedPackage,
  workspaceId: L.workspace,
  projectId: L.project,
  summary: "Approved: Ivo is 41; the bell-tax question is settled by a new decision.",
  source: { conversationLabel: "Legacy fixture conversation", url: "https://chatgpt.com/c/legacy-fixture" },
  approval: { status: "approved", statement: "Update the working files with the decisions I approved." },
  scope: "reference",
  protectedOverrides: [],
  operations: [
    {
      op: "update_record",
      recordId: L.dossier,
      expectedRevision: 1,
      changes: { body: { replace: PROSE.dossierV2 }, fields: { set: { age: 41 } } },
      note: "Age settled in conversation.",
    },
    {
      op: "create_record",
      newRecordId: L.decisionV2,
      type: "canon_decision",
      title: "Bell tax — settled",
      body: "The wardens collect the bell tax at every slack tide.",
      authorityStatus: "approved",
    },
    { op: "set_authority_status", recordId: L.decision, expectedRevision: 1, status: "superseded", supersededBy: L.decisionV2 },
  ],
  relatedRecords: [{ recordId: L.outline, note: "Check the outline still matches the settled bell tax." }],
};

async function buildFull() {
  const t = await createTestDb();
  const { db } = t;
  await createWorkspace(db, { id: L.workspace, name: "Legacy fixture workspace" });
  await createProject(db, { id: L.project, workspaceId: L.workspace, title: "The Lantern Ledger" });

  const chapter = (recordId: string, title: string, body: string) =>
    createRecord(db, L.project, { recordId, type: "manuscript_chapter", title, body, authorityStatus: "draft" });
  await chapter(L.ch01, "Chapter 1 — Low Water", PROSE.ch01v1);
  await chapter(L.ch02, "Chapter 2 — The Bell Tax", PROSE.ch02);
  await chapter(L.ch03, "Chapter 3 — Salt Road", PROSE.ch03);
  const scene = (recordId: string, parentRecordId: string, title: string, body: string) =>
    createRecord(db, L.project, { recordId, parentRecordId, type: "manuscript_scene", title, body, authorityStatus: "draft" });
  await scene(L.sc01, L.ch01, "The empty quay", "Ivo counted the mooring rings. Eleven, again.");
  await scene(L.sc02, L.ch01, "A warden at the door", "The warden’s lantern was out, which meant nothing good.");
  await scene(L.sc03, L.ch02, "Tally sticks", "Each notch was a crossing nobody paid for.");
  await createRecord(db, L.project, {
    recordId: L.note01,
    parentRecordId: L.sc01,
    type: "scene_note",
    title: "Ring count",
    body: "Keep the ring count at eleven in every later chapter.",
    authorityStatus: "approved",
  });
  await createRecord(db, L.project, {
    recordId: L.dossier,
    type: "character_dossier",
    title: "Ivo Marsh",
    body: PROSE.dossierV1,
    fields: { name: "Ivo Marsh", aliases: ["Ivo"], age: 38 },
    authorityStatus: "approved",
  });
  await createRecord(db, L.project, {
    recordId: L.world,
    type: "worldbuilding",
    title: "The Bell Wardens",
    body: "Wardens ring the harbour bells at slack water and collect the bell tax.",
    fields: { refIds: ["LL-WARD-001"] },
    authorityStatus: "approved",
  });
  await createRecord(db, L.project, {
    recordId: L.decision,
    type: "canon_decision",
    title: "Bell tax",
    body: "Is the bell tax collected daily or at each slack tide?",
    authorityStatus: "unresolved",
  });
  await createRecord(db, L.project, {
    recordId: L.outline,
    type: "chapter_outline",
    title: "Outline — Part One",
    body: "1. Low water.\n2. The bell tax.",
    authorityStatus: "approved",
  });

  // Protected prose with history: revision 2 needs the explicit unlock.
  await updateRecord(db, L.project, { recordId: L.ch01, expectedRevision: 1, body: PROSE.ch01v2, unlockProtected: true });
  await updateRecord(db, L.project, { recordId: L.outline, expectedRevision: 1, body: "1. Low water.\n2. The bell tax.\n3. Salt road." });
  await setProtection(db, L.project, L.world, true);

  // Book order: chapter 3 first, and a scene moved into another chapter.
  await moveRecordInBook(db, L.project, { recordId: L.ch03, parentRecordId: null, index: 0 });
  await moveRecordInBook(db, L.project, { recordId: L.sc02, parentRecordId: L.ch02, index: 0 });

  must("applied package", await applyChangePackage(db, appliedPackage, { projectId: L.project }));

  const markdown = await applyMarkdownImport(db, {
    projectId: L.project,
    conversationLabel: "Legacy fixture import",
    items: [{ ...FILES.glossary, title: "Bell Warden glossary", type: "reference_note", authorityStatus: "approved", protected: false }],
  });
  must("markdown import", markdown);
  const chapters = await applyChapterImport(db, {
    projectId: L.project,
    items: [{ ...FILES.chapter4, title: "Chapter 4 — Tide Mill", decision: { action: "create" } }],
  });
  must("chapter import", chapters);

  await linkReference(db, L.project, L.sc01, L.dossier);
  await linkReference(db, L.project, L.ch02, L.world);

  const [image] = await addRecordImages(db, L.project, L.dossier, [{ filename: "ivo-portrait.png", bytes: makePng(3, 2) }], {
    confirmProtected: false,
  });
  await updateRecordImage(db, L.project, image.id, { caption: "Ivo at the quay", altText: "A small brown square" }, { confirmProtected: false });

  await addDictionaryEntry(db, L.project, { word: "Lanternmarch", caseSensitive: true, scope: "workspace" }, "manual");
  await addDictionaryEntry(db, L.project, { word: "tallystick", caseSensitive: false, note: "one word here", scope: "project" }, "editor");

  const packageNote = (await listReviewItems(db, L.project, "open")).find((r) => r.origin === "package_note");
  if (!packageNote) throw new Error("expected a package review note");
  await resolveReviewItem(db, L.project, packageNote.id);

  await createRecord(db, L.project, {
    recordId: L.trashed,
    type: "reference_note",
    title: "Discarded bell theory",
    body: "The bells were never rung at all.",
    authorityStatus: "draft",
  });
  await moveRecordToTrash(db, L.project, L.trashed, false);

  const backup = await createWorkspaceBackup(db, L.workspace);
  await t.cleanup();
  return backup;
}

async function buildEarly(): Promise<WorkspaceBackupV1> {
  const t = await createTestDb();
  const { db } = t;
  await createWorkspace(db, { id: EARLY.workspace, name: "Early backup workspace" });
  await createProject(db, { id: EARLY.project, workspaceId: EARLY.workspace, title: "The First Ledger" });
  await createRecord(db, EARLY.project, {
    recordId: EARLY.chapter,
    type: "manuscript_chapter",
    title: "Chapter 1",
    body: "The first ledger was kept in brine.",
    authorityStatus: "draft",
  });
  await createRecord(db, EARLY.project, {
    recordId: EARLY.dossier,
    type: "character_dossier",
    title: "Pell Rook",
    body: "Clerk.",
    fields: { name: "Pell Rook" },
    authorityStatus: "draft",
  });
  must(
    "early package",
    await applyChangePackage(
      db,
      {
        format: "wordly.change-package",
        formatVersion: 1,
        packageId: EARLY.package,
        workspaceId: EARLY.workspace,
        projectId: EARLY.project,
        summary: "Approved: Pell is the senior clerk.",
        approval: { status: "approved" },
        operations: [{ op: "update_record", recordId: EARLY.dossier, expectedRevision: 1, changes: { body: { replace: "Senior clerk." } } }],
      },
      { projectId: EARLY.project },
    ),
  );
  const current = await createWorkspaceBackup(db, EARLY.workspace);
  await t.cleanup();

  // The shape written by the first v1 code (commit 906d5f0): no scenes, book
  // order, Trash, dictionary, links or images, and only the first two migrations.
  const { checksum: _checksum, dictionaryEntries: _d, recordLinks: _l, recordImages: _i, ...rest } = current;
  const { dictionaryEntries: _dc, recordLinks: _lc, recordImages: _ic, ...counts } = rest.counts;
  const early = {
    ...rest,
    app: { name: rest.app.name, migrations: knownMigrations().slice(0, 2) },
    records: rest.records.map(({ parentRecordId: _p, position: _pos, trashedAt: _t, trashBatchId: _b, ...r }) => r),
    counts,
  };
  return { ...early, checksum: sha256(stableStringify(early)) } as WorkspaceBackupV1;
}

/** Inventory of a backup restored with its original IDs into a fresh database, without run metadata. */
async function expectedInventory(backup: WorkspaceBackupV1) {
  const t = await createTestDb();
  const outcome = await restoreWorkspaceBackup(t.db, JSON.stringify(backup), { idStrategy: "preserve" });
  if (!outcome.ok) throw new Error(`fixture does not restore: ${JSON.stringify(outcome.issues)}`);
  const { createdAt: _c, databaseFile: _f, tables: _t, migrations: _m, ...inventory } = inventoryDatabase(t.file);
  await t.cleanup();
  return inventory;
}

async function main() {
  const targets = Object.values(L.files);
  if (!process.argv.includes("--force") && targets.some((f) => existsSync(path.join(OUT, f)))) {
    throw new Error("The legacy fixture already exists and is frozen. Pass --force only before the upgrade starts.");
  }
  mkdirSync(OUT, { recursive: true });

  const full = await buildFull();
  const early = await buildEarly();
  write(L.files.fullBackup, full);
  write(L.files.earlyBackup, early);
  write(L.files.expectedInventory, await expectedInventory(full));
  write(L.files.expectedEarlyInventory, await expectedInventory(early));

  const dossierRevision = full.records.find((r) => r.id === L.dossier)!.currentRevision;
  const chapterRevision = full.records.find((r) => r.id === L.ch01)!.currentRevision;
  const chapterEdit = {
    op: "update_record" as const,
    recordId: L.ch01,
    expectedRevision: chapterRevision,
    changes: { body: { replace: "Rewritten by a package." } },
  };

  write(L.files.applied, appliedPackage);
  // Same content, different key order and formatting: still the same package.
  const { operations, relatedRecords, ...header } = appliedPackage;
  write(L.files.duplicate, `${JSON.stringify({ relatedRecords, operations, ...Object.fromEntries(Object.entries(header).reverse()) })}\n`);
  write(L.files.conflict, { ...appliedPackage, summary: "Same package ID, different content." });
  write(L.files.stale, {
    ...appliedPackage,
    packageId: L.stalePackage,
    summary: "Written against revision 1 of the dossier, which has moved on.",
    operations: [{ op: "update_record", recordId: L.dossier, expectedRevision: dossierRevision - 1, changes: { body: { replace: "Stale edit." } } }],
    relatedRecords: [],
  });
  write(L.files.protectedReference, {
    ...appliedPackage,
    packageId: L.protectedReferencePackage,
    summary: "A reference-scope package that tries to rewrite chapter prose.",
    operations: [chapterEdit],
    relatedRecords: [],
  });
  write(L.files.protectedManuscript, {
    ...appliedPackage,
    packageId: L.protectedManuscriptPackage,
    summary: "A manuscript-scope package with an override; it still needs the author's confirmation.",
    scope: "manuscript",
    protectedOverrides: [L.ch01],
    operations: [chapterEdit],
    relatedRecords: [],
  });
  write(L.files.unsupportedVersion, { ...appliedPackage, packageId: L.futurePackage, formatVersion: 2 });

  console.log(`Wrote the legacy fixture to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
