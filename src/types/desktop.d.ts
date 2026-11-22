export {};

declare global {
  interface Window {
    storyLoomDesktop?: {
      isDesktop: boolean;
      pickLibraryFolder: () => Promise<string | null>;
      pickBackupMirrorFolder: () => Promise<string | null>;
      getDesktopInfo: () => Promise<{
        libraryDir: string | null;
        backupMirrorDir: string | null;
        hasEncryptedKey: boolean;
        userData: string;
      }>;
      saveAssistantKey: (payload: { apiKey?: string; model?: string; clear?: boolean }) => Promise<{ ok: boolean }>;
    };
  }
}