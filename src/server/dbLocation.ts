import path from "node:path";
import { libraryDatabasePath, loadLibrarySettings } from "./libraryLocation";

export const DEFAULT_DATABASE_URL = "file:./prisma/dev.db";

/**
 * Absolute path of the SQLite file. Relative `file:` URLs resolve against the
 * project root (the working directory of `pnpm` scripts, `next dev/start`,
 * and the Prisma CLI), so all of them open the same file.
 *
 * When a library folder is configured (desktop / WORDLY_LIBRARY_DIR /
 * local/library.json), that folder's storyloom.db wins over DATABASE_URL.
 */
export function databaseUrl(): string {
  const libraryDb = libraryDatabasePath(loadLibrarySettings());
  if (libraryDb) return fileUrl(libraryDb);
  return process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
}

export function databaseFilePath(url: string = databaseUrl()): string {
  if (!url.startsWith("file:")) throw new Error(`Only SQLite file: URLs are supported (got ${url})`);
  const raw = url.slice("file:".length);
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
    return path.normalize(raw);
  }
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), raw);
}

export function fileUrl(filePath: string): string {
  return `file:${path.resolve(/*turbopackIgnore: true*/ filePath).replace(/\\/g, "/")}`;
}
