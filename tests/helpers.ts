import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ChangePackageV1Input } from "@/changePackage/schema.v1";
import { createDb, type Db } from "@/server/db";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord } from "@/server/services/recordService";

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "prisma", "migrations");

export interface MigrationDir {
  name: string;
  sql: string;
  checksum: string;
}

export function listMigrationDirs(): MigrationDir[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

function ensurePrismaMigrationsTable(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function applyMigrations(sqlite: Database.Database, migrations: MigrationDir[]) {
  ensurePrismaMigrationsTable(sqlite);
  const insert = sqlite.prepare(
    `INSERT INTO "_prisma_migrations"
      ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
     VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`,
  );
  for (const migration of migrations) {
    sqlite.exec(migration.sql);
    const now = new Date().toISOString();
    insert.run(randomUUID(), migration.checksum, now, migration.name, now);
  }
}

export interface TestDb {
  db: Db;
  /** Absolute path of the isolated SQLite file. */
  file: string;
  cleanup: () => Promise<void>;
}

/** Fresh SQLite file with all migrations applied. */
export async function createTestDb(): Promise<TestDb> {
  return createTestDbThrough(undefined);
}

/**
 * Fresh SQLite with migrations applied through `throughInclusive` (inclusive).
 * When omitted, applies every migration. Records `_prisma_migrations` so
 * `prisma migrate deploy` can continue from that point on an isolated file.
 */
export async function createTestDbThrough(throughInclusive?: string): Promise<TestDb> {
  const all = listMigrationDirs();
  const migrations = throughInclusive
    ? all.filter((m) => m.name <= throughInclusive)
    : all;
  if (throughInclusive && !migrations.some((m) => m.name === throughInclusive)) {
    throw new Error(`Unknown migration cutoff: ${throughInclusive}`);
  }
  const dir = mkdtempSync(path.join(tmpdir(), "wordly-test-"));
  const file = path.join(dir, "test.db");
  const sqlite = new Database(file);
  applyMigrations(sqlite, migrations);
  sqlite.close();
  const db = createDb(`file:${file.replace(/\\/g, "/")}`);
  return {
    db,
    file,
    cleanup: async () => {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const IDS = {
  workspace: "wsp_test",
  project: "prj_test_novel",
  chapter: "rec_test_ch01_prose",
  outline: "rec_test_ch01_outline",
  dossier: "rec_test_mara_dossier",
  world: "rec_test_salt_guild",
  decision: "rec_test_decision_age",
} as const;

export const CHAPTER_PROSE =
  "The ledger had been dry for three hundred years. Mara Venn knew this because she had checked it every morning.";

export async function seedProject(db: Db) {
  await createWorkspace(db, { id: IDS.workspace, name: "Test workspace" });
  await createProject(db, { id: IDS.project, workspaceId: IDS.workspace, title: "Test novel" });
  await createRecord(db, IDS.project, {
    recordId: IDS.dossier,
    type: "character_dossier",
    title: "Mara Venn",
    body: "Archivist. Thirty years old.",
    fields: { name: "Mara Venn", aliases: ["Mara"], age: 30 },
    authorityStatus: "approved",
  });
  await createRecord(db, IDS.project, {
    recordId: IDS.world,
    type: "worldbuilding",
    title: "The Salt Guild",
    body: "Archivists who preserve records in salt. Mara is a senior member.",
    authorityStatus: "approved",
  });
  await createRecord(db, IDS.project, {
    recordId: IDS.outline,
    type: "chapter_outline",
    title: "Chapter 1 outline",
    body: "1. Mara finds the wet ledger.",
    authorityStatus: "approved",
  });
  await createRecord(db, IDS.project, {
    recordId: IDS.chapter,
    type: "manuscript_chapter",
    title: "Chapter 1",
    body: CHAPTER_PROSE,
    authorityStatus: "draft",
  });
  await createRecord(db, IDS.project, {
    recordId: IDS.decision,
    type: "canon_decision",
    title: "Mara's age",
    body: "Is Mara 30 or 34?",
    authorityStatus: "unresolved",
  });
}

let counter = 0;

export function makePackage(overrides: Partial<ChangePackageV1Input> = {}): ChangePackageV1Input {
  counter += 1;
  return {
    format: "wordly.change-package",
    formatVersion: 1,
    packageId: `pkg_test_${Date.now()}_${counter}`,
    workspaceId: IDS.workspace,
    projectId: IDS.project,
    summary: "Approved dossier update",
    source: { conversationLabel: "Test conversation" },
    approval: { status: "approved", statement: "Author approved" },
    scope: "reference",
    operations: [
      {
        op: "update_record",
        recordId: IDS.dossier,
        expectedRevision: 1,
        changes: { body: { replace: "Archivist. Thirty-four years old." }, fields: { set: { age: 34 } } },
      },
    ],
    ...overrides,
  };
}

/** Everything that a failed import must leave untouched. */
export async function snapshotState(db: Db) {
  const [records, revisions, packages, reviewItems, sources] = await Promise.all([
    db.record.findMany({ orderBy: { id: "asc" } }),
    db.revision.findMany({ orderBy: [{ recordId: "asc" }, { revisionNumber: "asc" }] }),
    db.changePackage.findMany({ orderBy: { packageId: "asc" } }),
    db.reviewItem.findMany({ orderBy: { id: "asc" } }),
    db.source.findMany({ orderBy: { id: "asc" } }),
  ]);
  return { records, revisions, packages, reviewItems, sources };
}
