import { appInstanceId } from "@/server/appInstance";
import {
  clearLibraryLock,
  ensureLibraryDir,
  inspectLibraryLock,
  loadLibrarySettings,
  writeLibraryLock,
} from "@/server/libraryLocation";

/**
 * Node-only side effects for instrumentation.register().
 * Imported only when NEXT_RUNTIME === "nodejs".
 */
const settings = loadLibrarySettings();
if (settings.libraryDir) {
  ensureLibraryDir(settings.libraryDir);
  const id = appInstanceId();
  const check = inspectLibraryLock(settings.libraryDir, id);
  if (check.status === "foreign") {
    console.warn(
      `[story-loom] Library lock: another session may be open (${check.lock.hostname} pid ${check.lock.pid}, started ${check.lock.startedAt}). Do not run two copies against the same database.`,
    );
  }
  writeLibraryLock(settings.libraryDir, id);
  const libraryDir = settings.libraryDir;
  const release = () => {
    try {
      clearLibraryLock(libraryDir, id);
    } catch {
      // Best-effort on shutdown.
    }
  };
  process.once("exit", release);
  process.once("SIGINT", () => {
    release();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    release();
    process.exit(0);
  });
}
