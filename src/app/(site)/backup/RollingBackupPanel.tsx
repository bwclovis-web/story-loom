"use client";

import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import type { Issue } from "@/domain/issues";
import { BACKUP } from "@/ui/labels";
import { runRollingBackupNowAction, saveBackupScheduleAction } from "./rollingActions";

export function RollingBackupPanel({
  scheduleEnabled,
  retentionCount,
  lastScheduledBackupAt,
  mirrorConfigured,
  fromEnv,
}: {
  scheduleEnabled: boolean;
  retentionCount: number;
  lastScheduledBackupAt: string | null;
  mirrorConfigured: boolean;
  fromEnv: boolean;
}) {
  const [enabled, setEnabled] = useState(scheduleEnabled);
  const [retention, setRetention] = useState(String(retentionCount));
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const saveSchedule = () => {
    startTransition(async () => {
      const data = new FormData();
      data.set("scheduleEnabled", enabled ? "1" : "0");
      data.set("retentionCount", retention);
      const result = await saveBackupScheduleAction(data);
      if (!result.ok) {
        setIssues(result.issues);
        setMessage(null);
        return;
      }
      setIssues([]);
      setMessage(result.message);
    });
  };

  const runNow = () => {
    startTransition(async () => {
      const result = await runRollingBackupNowAction();
      if (!result.ok) {
        setIssues(result.issues);
        setMessage(null);
        return;
      }
      setIssues([]);
      setMessage(result.message);
    });
  };

  return (
    <div className="stack">
      <p className="small muted">{BACKUP.rollingLead}</p>
      <IssueList issues={issues} />
      {message ? <Banner tone="ok">{message}</Banner> : null}
      <label>
        {BACKUP.rollingRetention}
        <input
          type="number"
          min={1}
          max={365}
          value={retention}
          disabled={fromEnv || pending}
          onChange={(e) => setRetention(e.target.value)}
        />
      </label>
      <Checkbox
        checked={enabled}
        disabled={fromEnv || pending || !mirrorConfigured}
        onChange={(e) => setEnabled(e.target.checked)}
        label={BACKUP.rollingScheduleEnable}
        name="scheduleEnabled"
      />
      {!mirrorConfigured ? <p className="small muted">{BACKUP.rollingNeedsMirror}</p> : null}
      {lastScheduledBackupAt ? (
        <p className="small muted">{BACKUP.rollingLastRun(lastScheduledBackupAt)}</p>
      ) : null}
      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <Button type="button" size="sm" disabled={fromEnv || pending} onClick={saveSchedule}>
          {BACKUP.rollingScheduleSave}
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={pending || !mirrorConfigured} onClick={runNow}>
          {BACKUP.rollingRunNow}
        </Button>
      </div>
      <p className="small muted">{BACKUP.rollingDesktopNote}</p>
    </div>
  );
}