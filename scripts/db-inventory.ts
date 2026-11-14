import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { databaseFilePath } from "../src/server/dbLocation";
import {
  compareInventories,
  INVENTORY_META_PATHS,
  inventoryDatabase,
  inventoryTotals,
  NOT_IN_WORKSPACE_BACKUPS,
  type DatabaseInventory,
} from "../src/server/inventory";
import { BACKUPS_DIR, flagValue, hasFlag, main, positionalArgs, printDifferences, timestamp } from "./lib/dbTools";

/*
 * Read-only. Writes an inventory of a database (IDs, structure, counts and
 * sha256 hashes; no titles or text) or compares two inventories.
 */

const USAGE = `Usage:
  pnpm db:inventory [--database <file>] [--out <file.json>] [--label name]
  pnpm db:inventory --compare <before.json> <after.json> [--ignore-not-in-backups]`;

function readInventory(file: string): DatabaseInventory {
  return JSON.parse(readFileSync(path.resolve(file), "utf8")) as DatabaseInventory;
}

main(async () => {
  if (hasFlag("--compare")) {
    const [beforeFile, afterFile] = positionalArgs();
    if (!beforeFile || !afterFile) {
      console.log(USAGE);
      process.exit(1);
    }
    const before = readInventory(beforeFile);
    const after = readInventory(afterFile);
    const ignore = hasFlag("--ignore-not-in-backups") ? [...INVENTORY_META_PATHS, NOT_IN_WORKSPACE_BACKUPS] : INVENTORY_META_PATHS;
    console.log(`Migrations before: ${before.migrations.length}, after: ${after.migrations.length}`);
    const added = after.migrations.filter((m) => !before.migrations.includes(m));
    const removed = before.migrations.filter((m) => !after.migrations.includes(m));
    if (added.length) console.log(`  added: ${added.join(", ")}`);
    if (removed.length) console.log(`  MISSING: ${removed.join(", ")}`);
    const differences = compareInventories(before, after, ignore);
    if (differences.length === 0) {
      console.log("No differences in stored records, revisions, links, images, book order, packages or imports.");
      return;
    }
    console.log(`${differences.length} difference(s):`);
    printDifferences(differences);
    process.exit(1);
  }

  const file = path.resolve(flagValue("--database") ?? databaseFilePath());
  if (!existsSync(file)) throw new Error(`No database at ${file}.`);
  const label = flagValue("--label");
  const out = path.resolve(flagValue("--out") ?? path.join(BACKUPS_DIR, `${timestamp()}-inventory${label ? `-${label}` : ""}.json`));
  const inventory = inventoryDatabase(file);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
  console.log(`Database:  ${file}`);
  console.log(`Inventory: ${out}`);
  for (const [key, value] of Object.entries(inventoryTotals(inventory))) console.log(`  ${(key + ":").padEnd(34)}${value}`);
});
