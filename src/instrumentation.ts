/**
 * Next.js Node startup hook. Applies library lock when a library folder is set.
 * Assistant secrets are merged on each getAssistantConfig() call (no env mutation).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadLibrarySettings, ensureLibraryDir, inspectLibraryLock, writeLibraryLock, clearLibraryLock } =
    await import("@/server/libraryLocation");
  const { appInstanceId } = await import("@/server/appInstance");
  const settings = loadLibrarySettings();
  if (!settings.libraryDir) return;
  ensureLibraryDir(settings.libraryDir);
  const id = appInstanceId();
  const check = inspectLibraryLock(settings.libraryDir, id);
  if (check.status === "foreign") {
    console.warn(
      `[story-loom] Library lock: another session may be open (${check.lock.hostname} pid ${check.lock.pid}, started ${check.lock.startedAt}). Do not run two copies against the same database.`,
    );
  }
  writeLibraryLock(settings.libraryDir, id);
  const release = () => {
    try {
      clearLibraryLock(settings.libraryDir!, id);
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
