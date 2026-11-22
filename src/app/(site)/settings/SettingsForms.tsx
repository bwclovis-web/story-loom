"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button, ButtonLink } from "@/components/ui/Button";
import type { Issue } from "@/domain/issues";
import type { AssistantProviderId } from "@/assistant/config";
import type { AssistantKeySource } from "@/server/assistantSecrets";
import { BACKUP, SETTINGS } from "@/ui/labels";
import {
  ASSISTANT_PROVIDER_OPTIONS,
  clearAssistantKeyAction,
  saveAssistantKeyAction,
  saveLibraryDirAction,
  saveSettingsMirrorDirAction,
  testAssistantConnectionAction,
  type SettingsFormResult,
} from "./actions";

function applyResult(
  result: SettingsFormResult,
  setIssues: (issues: Issue[]) => void,
  setMessage: (message: string | null) => void,
) {
  if (!result.ok) {
    setIssues(result.issues);
    setMessage(null);
    return;
  }
  setIssues([]);
  setMessage(result.message ?? "Saved.");
}

export function AssistantSettingsForm({
  provider,
  keySaved,
  model,
  baseUrl,
  secretsPath,
  keySource,
}: {
  provider: AssistantProviderId;
  keySaved: boolean;
  model: string;
  baseUrl: string;
  secretsPath: string;
  keySource: AssistantKeySource;
}) {
  const [apiKey, setApiKey] = useState("");
  const [providerValue, setProviderValue] = useState<AssistantProviderId>(provider);
  const [modelValue, setModelValue] = useState(model);
  const [baseUrlValue, setBaseUrlValue] = useState(baseUrl);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isDesktop = typeof window !== "undefined" && Boolean(window.storyLoomDesktop?.isDesktop);

  const save = () => {
    startTransition(async () => {
      if (isDesktop && window.storyLoomDesktop) {
        if (apiKey.trim()) {
          await window.storyLoomDesktop.saveAssistantKey({ apiKey: apiKey.trim(), model: modelValue });
        } else if (modelValue.trim()) {
          await window.storyLoomDesktop.saveAssistantKey({ model: modelValue });
        }
      }
      const data = new FormData();
      data.set("provider", providerValue);
      data.set("apiKey", isDesktop ? "" : apiKey);
      data.set("model", modelValue);
      data.set("baseUrl", baseUrlValue);
      const result = await saveAssistantKeyAction(data);
      applyResult(result, setIssues, setMessage);
      if (result.ok) setApiKey("");
    });
  };

  const clearKey = () => {
    startTransition(async () => {
      if (isDesktop && window.storyLoomDesktop) {
        await window.storyLoomDesktop.saveAssistantKey({ clear: true });
      }
      const result = await clearAssistantKeyAction();
      applyResult(result, setIssues, setMessage);
      if (result.ok) setApiKey("");
    });
  };

  const test = () => {
    startTransition(async () => {
      const result = await testAssistantConnectionAction();
      applyResult(result, setIssues, setMessage);
    });
  };

  return (
    <div className="stack">
      <p className="small muted">{SETTINGS.aiLead}</p>
      <p className="small muted">{SETTINGS.aiEnvNote}</p>
      {keySaved ? (
        <Banner tone="info">{SETTINGS.aiKeySaved}</Banner>
      ) : (
        <p className="small muted">{SETTINGS.aiKeyMissing}</p>
      )}
      {keySource === "desktop-keychain" ? <p className="small muted">{SETTINGS.aiKeySourceDesktop}</p> : null}
      <IssueList issues={issues} />
      {message ? <Banner tone="ok">{message}</Banner> : null}
      <label>
        {SETTINGS.aiProviderLabel}
        <select
          name="provider"
          value={providerValue}
          disabled={pending}
          onChange={(e) => setProviderValue(e.target.value as AssistantProviderId)}
        >
          {ASSISTANT_PROVIDER_OPTIONS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>
      <p className="small muted">{SETTINGS.aiProviderHint}</p>
      <label>
        {SETTINGS.aiKeyLabel}
        <input
          type="password"
          name="apiKey"
          autoComplete="off"
          spellCheck={false}
          value={apiKey}
          disabled={pending}
          placeholder={SETTINGS.aiKeyPlaceholder}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      <label>
        {SETTINGS.aiModelLabel}
        <input
          type="text"
          name="model"
          autoComplete="off"
          spellCheck={false}
          value={modelValue}
          disabled={pending}
          placeholder={SETTINGS.aiModelPlaceholder}
          onChange={(e) => setModelValue(e.target.value)}
        />
      </label>
      <p className="small muted">{SETTINGS.aiModelHint}</p>
      <label>
        {SETTINGS.aiBaseUrlLabel}
        <input
          type="url"
          name="baseUrl"
          autoComplete="off"
          spellCheck={false}
          value={baseUrlValue}
          disabled={pending}
          placeholder={SETTINGS.aiBaseUrlPlaceholder}
          onChange={(e) => setBaseUrlValue(e.target.value)}
        />
      </label>
      <p className="small muted">{SETTINGS.aiBaseUrlHint}</p>
      <p className="small muted">
        {SETTINGS.aiSecretsFile} <code>{secretsPath}</code>
      </p>
      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          {SETTINGS.aiSave}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={pending || !keySaved} onClick={clearKey}>
          {SETTINGS.aiClearKey}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={test}>
          {SETTINGS.aiTest}
        </Button>
      </div>
      <p className="small muted">{SETTINGS.aiTestHint}</p>
    </div>
  );
}

export function LibrarySettingsForm({
  libraryDir,
  fromEnv,
  settingsPath,
  databasePath,
  lockStatus,
  lockDetail,
}: {
  libraryDir: string | null;
  fromEnv: boolean;
  settingsPath: string;
  databasePath: string;
  lockStatus: string;
  lockDetail: string | null;
}) {
  const [value, setValue] = useState(libraryDir ?? "");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const result = await saveLibraryDirAction(value);
      applyResult(result, setIssues, setMessage);
    });
  };

  return (
    <div className="stack">
      <p className="small muted">{SETTINGS.libraryLead}</p>
      {fromEnv ? <p className="small muted">{SETTINGS.libraryEnvOverride}</p> : null}
      {lockStatus === "foreign" ? (
        <Banner tone="warn">
          {SETTINGS.libraryLockForeign}
          {lockDetail ? ` ${lockDetail}` : null}
        </Banner>
      ) : null}
      {lockStatus === "stale" ? <Banner tone="info">{SETTINGS.libraryLockStale}</Banner> : null}
      <IssueList issues={issues} />
      {message ? <Banner tone="ok">{message}</Banner> : null}
      <label>
        {SETTINGS.libraryFolder}
        <input
          type="text"
          value={value}
          disabled={fromEnv || pending}
          placeholder={SETTINGS.libraryPlaceholder}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <p className="small muted">
        {SETTINGS.aiSecretsFile} <code>{settingsPath}</code>
      </p>
      <p className="small muted">
        {SETTINGS.libraryDatabase}: <code>{databasePath}</code>
      </p>
      {libraryDir ? (
        <p className="small muted">{SETTINGS.libraryActive(libraryDir)}</p>
      ) : (
        <p className="small muted">{SETTINGS.libraryInactive}</p>
      )}
      <p className="small muted">{SETTINGS.libraryRestart}</p>
      <Button type="button" size="sm" disabled={fromEnv || pending} onClick={save}>
        {SETTINGS.librarySave}
      </Button>
    </div>
  );
}

export function MirrorSettingsForm({
  mirrorDir,
  fromEnv,
  settingsPath,
}: {
  mirrorDir: string | null;
  fromEnv: boolean;
  settingsPath: string;
}) {
  const [value, setValue] = useState(mirrorDir ?? "");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const result = await saveSettingsMirrorDirAction(value);
      applyResult(result, setIssues, setMessage);
    });
  };

  return (
    <div className="stack">
      <p className="small muted">{SETTINGS.mirrorLead}</p>
      {fromEnv ? <p className="small muted">{BACKUP.mirrorEnvOverride}</p> : null}
      <IssueList issues={issues} />
      {message ? <Banner tone="ok">{message}</Banner> : null}
      <label>
        {BACKUP.mirrorFolder}
        <input
          type="text"
          value={value}
          disabled={fromEnv || pending}
          placeholder={BACKUP.mirrorPlaceholder}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <p className="small muted">
        {BACKUP.mirrorSettingsFile} <code>{settingsPath}</code>
      </p>
      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <Button type="button" size="sm" disabled={fromEnv || pending} onClick={save}>
          {BACKUP.mirrorSave}
        </Button>
        <ButtonLink href="/backup" variant="secondary" size="sm">
          {SETTINGS.openBackup}
        </ButtonLink>
      </div>
    </div>
  );
}

export function SettingsLinks() {
  return (
    <p className="small muted">
      <Link href="/connections">{SETTINGS.openConnections}</Link>
      {" · "}
      <Link href="/backup">{SETTINGS.openBackup}</Link>
    </p>
  );
}
