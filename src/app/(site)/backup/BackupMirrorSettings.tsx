"use client";

import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import { Button } from "@/components/ui/Atoms/Button";
import type { Issue } from "@/domain/issues";
import { BACKUP } from "@/ui/labels";
import { clearBackupMirrorDirAction, saveBackupMirrorDirAction } from "./mirrorActions";

export function BackupMirrorSettings({
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
  const [saved, setSaved] = useState(mirrorDir);
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const result = await saveBackupMirrorDirAction(value);
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setIssues([]);
      setSaved(result.mirrorDir);
      setValue(result.mirrorDir ?? "");
    });
  };

  const clear = () => {
    startTransition(async () => {
      const result = await clearBackupMirrorDirAction();
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setIssues([]);
      setSaved(null);
      setValue("");
    });
  };

  return (
    <div className="stack">
      <p className="small muted">{BACKUP.mirrorLead}</p>
      <p className="warning small">{BACKUP.mirrorWarning}</p>
      {fromEnv ? <p className="small muted">{BACKUP.mirrorEnvOverride}</p> : null}
      <IssueList issues={issues} />
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
      {saved ? (
        <p className="small muted">
          {BACKUP.mirrorActive(saved)}
        </p>
      ) : (
        <p className="small muted">{BACKUP.mirrorInactive}</p>
      )}
      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <Button type="button" size="sm" disabled={fromEnv || pending} onClick={save}>
          {BACKUP.mirrorSave}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={fromEnv || pending || !saved} onClick={clear}>
          {BACKUP.mirrorClear}
        </Button>
      </div>
      <p className="small muted">
        {BACKUP.mirrorAppliesTo}
      </p>
    </div>
  );
}