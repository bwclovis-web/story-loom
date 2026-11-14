import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createDb } from "../src/server/db";
import { fileUrl } from "../src/server/dbLocation";
import {
  compareInventories,
  INVENTORY_META_PATHS,
  inventoryDatabase,
  inventoryTotals,
  NOT_IN_WORKSPACE_BACKUPS,
} from "../src/server/inventory";
import { restoreWorkspaceBackup } from "../src/server/services/backupService";
import { main, positionalArgs, printDifferences, runPrisma } from "./lib/dbTools";

/*
 * Proves a `pnpm db:backup` folder restores. Never touches the working
 * database: it creates <folder>/restore-check.db, restores every workspace
 * file into it with the original IDs, and compares an inventory of that copy
 * with an inventory of the folder's SQLite snapshot. Both inventories and the
 * restored copy stay in the (git-ignored) backup folder.
 */

const RESTORE_FILE = "restore-check.db";

main(async () => {
  const [folderArg] = positionalArgs();
  if (!folderArg) {
    console.log("Usage: pnpm db:verify-backup backups/<folder>");
    process.exit(1);
  }
  const folder = path.resolve(folderArg);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`${folder} is not a folder.`);
  const names = readdirSync(folder);
  const snapshots = names.filter((n) => /\.(db|sqlite3?)$/.test(n) && n !== RESTORE_FILE);
  const workspaceFiles = names.filter((n) => n.endsWith(".wordly-backup.json")).sort();
  if (snapshots.length !== 1) throw new Error(`Expected one SQLite snapshot in ${folder}, found ${snapshots.length}.`);
  if (workspaceFiles.length === 0) throw new Error(`No *.wordly-backup.json files in ${folder}.`);
  const target = path.join(folder, RESTORE_FILE);
  if (existsSync(target)) throw new Error(`${target} already exists. Remove it or verify another folder.`);

  console.log(`Creating ${target}`);
  runPrisma(["migrate", "deploy"], target);
  const db = createDb(fileUrl(target));
  try {
    for (const name of workspaceFiles) {
      const outcome = await restoreWorkspaceBackup(db, readFileSync(path.join(folder, name), "utf8"), {
        idStrategy: "preserve",
        actor: "author (db:verify-backup)",
      });
      if (!outcome.ok) {
        for (const issue of outcome.issues) console.error(`  [${issue.code}] ${issue.message}`);
        throw new Error(`${name} did not restore.`);
      }
      console.log(`Restored ${name}: ${outcome.projects.length} project(s)`);
    }
  } finally {
    await db.$disconnect();
  }

  const snapshot = inventoryDatabase(path.join(folder, snapshots[0]));
  const restored = inventoryDatabase(target);
  writeFileSync(path.join(folder, "inventory-snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  writeFileSync(path.join(folder, "inventory-restore-check.json"), `${JSON.stringify(restored, null, 2)}\n`, "utf8");

  const totals = inventoryTotals(snapshot);
  console.log("Snapshot:");
  for (const [key, value] of Object.entries(totals)) console.log(`  ${(key + ":").padEnd(34)}${value}`);
  if (totals.invalidRevisionHashes || totals.recordsNotMatchingLatestRevision) {
    console.log("WARNING: the snapshot itself has revisions or records that fail their integrity checks.");
  }

  const differences = compareInventories(snapshot, restored, [...INVENTORY_META_PATHS, NOT_IN_WORKSPACE_BACKUPS]);
  if (differences.length) {
    console.log(`Restore differs from the snapshot in ${differences.length} place(s):`);
    printDifferences(differences);
    process.exit(1);
  }
  console.log("Restore matches the snapshot: records, text hashes, revisions, links, images, book order, packages and imports.");
  console.log("Assistant conversations, proposals and proofreading runs are kept only in the SQLite snapshot, not in workspace backups.");
});
