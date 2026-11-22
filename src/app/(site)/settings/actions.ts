"use server";

import { revalidatePath } from "next/cache";
import {
  ASSISTANT_PROVIDERS,
  BASE_URL_ENV,
  MODEL_ENV,
  PROVIDER_ENV,
  type AssistantProviderId,
  parseAssistantBaseUrl,
  parseAssistantProvider,
} from "@/assistant/config";
import { errorIssue, type Issue } from "@/domain/issues";
import { testAssistantConnection } from "@/server/assistantConnectionTest";
import {
  assistantSecretsStatus,
  loadAssistantSecrets,
  saveAssistantSecrets,
} from "@/server/assistantSecrets";
import {
  ensureLibraryDir,
  inspectLibraryLock,
  loadLibrarySettings,
  libraryDatabasePath,
  librarySettingsPath,
  saveLibrarySettings,
  validateLibraryDir,
  writeLibraryLock,
} from "@/server/libraryLocation";
import { appInstanceId } from "@/server/appInstance";
import { databaseFilePath } from "@/server/dbLocation";
import {
  backupMirrorSettingsPath,
  loadBackupMirrorSettings,
  saveBackupMirrorSettings,
  validateMirrorDir,
} from "@/server/backupMirrorSettings";

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export type SettingsFormResult = { ok: true; message?: string } | { ok: false; issues: Issue[] };

export async function loadSettingsViewAction() {
  const secrets = assistantSecretsStatus();
  const library = loadLibrarySettings();
  const mirror = loadBackupMirrorSettings();
  const lock =
    library.libraryDir != null
      ? inspectLibraryLock(library.libraryDir, appInstanceId())
      : { status: "clear" as const };
  return {
    provider: secrets.provider,
    keySaved: secrets.keySaved,
    model: secrets.model ?? process.env[MODEL_ENV]?.trim() ?? "",
    baseUrl: secrets.baseUrl ?? process.env[BASE_URL_ENV]?.trim() ?? "",
    secretsPath: secrets.secretsPath,
    libraryDir: library.libraryDir,
    libraryFromEnv: Boolean(process.env.WORDLY_LIBRARY_DIR?.trim()),
    librarySettingsPath: librarySettingsPath(),
    databasePath: databaseFilePath(),
    libraryDbPath: libraryDatabasePath(library),
    mirrorDir: mirror.mirrorDir,
    mirrorFromEnv: Boolean(process.env.WORDLY_BACKUP_MIRROR_DIR?.trim()),
    mirrorSettingsPath: backupMirrorSettingsPath(),
    scheduleEnabled: mirror.scheduleEnabled ?? false,
    retentionCount: mirror.retentionCount ?? 14,
    lastScheduledBackupAt: mirror.lastScheduledBackupAt ?? null,
    keySource: secrets.keySource,
    precedenceNote: secrets.precedenceNote,
    lockStatus: lock.status,
    lockDetail:
      lock.status === "foreign" || lock.status === "stale"
        ? `${lock.lock.hostname} · pid ${lock.lock.pid} · ${lock.lock.startedAt}`
        : null,
  };
}

export const ASSISTANT_PROVIDER_OPTIONS = ASSISTANT_PROVIDERS;

export async function saveAssistantKeyAction(formData: FormData): Promise<SettingsFormResult> {
  const rawKey = String(formData.get("apiKey") ?? "");
  const rawModel = String(formData.get("model") ?? "").trim();
  const rawBaseUrl = String(formData.get("baseUrl") ?? "").trim();
  const rawProvider = String(formData.get("provider") ?? "").trim();
  const clearKey = formData.get("clearKey") === "1";
  const issues: Issue[] = [];

  const providerProblems: string[] = [];
  const provider = parseAssistantProvider(rawProvider || process.env[PROVIDER_ENV], providerProblems);
  for (const problem of providerProblems) issues.push(errorIssue("INVALID_CHANGE", problem));

  if (rawModel && !MODEL_PATTERN.test(rawModel)) {
    issues.push(errorIssue("INVALID_CHANGE", `${MODEL_ENV} does not look like a model ID.`));
  }
  const baseProblems: string[] = [];
  const parsedBase = parseAssistantBaseUrl(rawBaseUrl || null, baseProblems);
  for (const problem of baseProblems) issues.push(errorIssue("INVALID_CHANGE", problem));
  if (issues.length) return { ok: false, issues };

  const current = loadAssistantSecrets();
  const keys = { ...current.keys };
  if (clearKey) keys[provider] = null;
  else if (rawKey.trim()) keys[provider] = rawKey.trim();

  const model = rawModel || null;
  const baseUrl = rawBaseUrl ? parsedBase : null;
  saveAssistantSecrets({ provider, keys, model, baseUrl });
  revalidatePath("/settings");
  revalidatePath("/connections");
  return { ok: true, message: clearKey ? "API key cleared." : "Assistant settings saved." };
}

export async function clearAssistantKeyAction(): Promise<SettingsFormResult> {
  const current = loadAssistantSecrets();
  const provider = assistantSecretsStatus(current).provider;
  const keys = { ...current.keys, [provider]: null };
  saveAssistantSecrets({ provider: current.provider ?? provider, keys, model: current.model, baseUrl: current.baseUrl });
  revalidatePath("/settings");
  revalidatePath("/connections");
  return { ok: true, message: "API key cleared." };
}

export async function testAssistantConnectionAction(): Promise<SettingsFormResult> {
  const result = await testAssistantConnection();
  if (!result.ok) return { ok: false, issues: [errorIssue("INVALID_CHANGE", result.message)] };
  return {
    ok: true,
    message: `Connected (${result.provider}) with model ${result.model} at ${result.baseUrl}. Reply: ${result.outputPreview}`,
  };
}

export async function saveLibraryDirAction(raw: string): Promise<SettingsFormResult> {
  if (process.env.WORDLY_LIBRARY_DIR?.trim()) {
    return {
      ok: false,
      issues: [errorIssue("INVALID_CHANGE", "Clear WORDLY_LIBRARY_DIR in .env before changing the library folder here.")],
    };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    saveLibrarySettings(null);
    revalidatePath("/settings");
    return { ok: true, message: "Library folder cleared. The default database path will be used after restart." };
  }
  const check = validateLibraryDir(trimmed);
  if (!check.ok) return { ok: false, issues: [errorIssue("INVALID_CHANGE", check.message)] };
  ensureLibraryDir(check.path);
  const id = appInstanceId();
  const lock = inspectLibraryLock(check.path, id);
  if (lock.status === "foreign") {
    return {
      ok: false,
      issues: [
        errorIssue(
          "INVALID_CHANGE",
          `That library looks open elsewhere (${lock.lock.hostname}, pid ${lock.lock.pid}). Close the other copy, or remove storyloom.lock.json only if you are sure nothing else is using it.`,
        ),
      ],
    };
  }
  saveLibrarySettings(check.path);
  writeLibraryLock(check.path, id);
  revalidatePath("/settings");
  return {
    ok: true,
    message: `Library folder saved. Restart the app so it opens ${check.path}\\storyloom.db (or storyloom.db inside that folder).`,
  };
}

export async function saveSettingsMirrorDirAction(raw: string): Promise<SettingsFormResult> {
  if (process.env.WORDLY_BACKUP_MIRROR_DIR?.trim()) {
    return {
      ok: false,
      issues: [errorIssue("INVALID_CHANGE", "Clear WORDLY_BACKUP_MIRROR_DIR in .env before changing the mirror folder here.")],
    };
  }
  const trimmed = raw.trim();
  const current = loadBackupMirrorSettings();
  if (!trimmed) {
    saveBackupMirrorSettings(null, {
      scheduleEnabled: false,
      retentionCount: current.retentionCount,
      lastScheduledBackupAt: current.lastScheduledBackupAt,
    });
    revalidatePath("/settings");
    revalidatePath("/backup");
    return { ok: true, message: "Backup mirror cleared." };
  }
  const check = validateMirrorDir(trimmed);
  if (!check.ok) return { ok: false, issues: [errorIssue("INVALID_CHANGE", check.message)] };
  saveBackupMirrorSettings(check.path, {
    scheduleEnabled: current.scheduleEnabled,
    retentionCount: current.retentionCount,
    lastScheduledBackupAt: current.lastScheduledBackupAt,
  });
  revalidatePath("/settings");
  revalidatePath("/backup");
  return { ok: true, message: `Backup mirror set to ${check.path}.` };
}
