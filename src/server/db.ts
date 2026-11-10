import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { databaseFilePath, fileUrl } from "./dbLocation";

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;
export type DbOrTx = Db | Tx;

/**
 * Opens SQLite through Prisma's better-sqlite3 adapter.
 * The adapter does not change journal_mode. A new file stays in SQLite's
 * delete (rollback) journal mode, and an existing file keeps its own mode.
 * better-sqlite3 waits up to its default 5000 ms on a lock before failing.
 * Do not set a journal mode here without checking both the UI and the MCP process.
 */
export function createDb(url: string): Db {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

const globalForDb = globalThis as unknown as { __wordlyDbClient?: { client: Db; generated: typeof PrismaClient } };

/**
 * Process-wide client for the Next.js app. Services take a `db` argument instead of calling this.
 * The cache outlives dev reloads, so a client from before `prisma generate` is replaced
 * rather than kept with an outdated schema.
 */
export function getDb(): Db {
  const cached = globalForDb.__wordlyDbClient;
  if (cached?.generated === PrismaClient) return cached.client;
  void cached?.client.$disconnect();
  const client = createDb(fileUrl(databaseFilePath()));
  globalForDb.__wordlyDbClient = { client, generated: PrismaClient };
  return client;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
