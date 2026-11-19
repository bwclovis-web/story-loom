"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import type { RestoreOutcome } from "@/server/services/backupService";
import { BACKUP } from "@/ui/labels";
import { checkBackupAction, restoreBackupAction, type BackupCheck } from "./actions";
import { Banner } from "@/components/ui/Banner";

export function RestoreClient() {
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState("");
  const [check, setCheck] = useState<BackupCheck | null>(null);
  const [name, setName] = useState("");
  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  const onFile = (file: File | undefined) => {
    setCheck(null);
    setOutcome(null);
    if (!file) return;
    setFileName(file.name);
    startTransition(async () => {
      const text = await file.text();
      setRaw(text);
      const result = await checkBackupAction(text);
      setCheck(result);
      if (result.summary) setName(`${result.summary.workspaceName} (restored ${new Date().toISOString().slice(0, 10)})`);
    });
  };

  const restore = () =>
    startTransition(async () => {
      setOutcome(await restoreBackupAction(raw, name));
    });

  return (
    <div className="stack">
      <div className="row">
        <input
          type="file"
          accept=".json,application/json"
          onChange={(e) => onFile(e.target.files?.[0])}
          aria-label="Backup file to restore"
        />
        {pending ? <span className="small muted">Working...</span> : null}
      </div>

      {check?.summary ? (
        <div className="panel small">
          <div>
            <strong>{fileName}</strong>: workspace &ldquo;{check.summary.workspaceName}&rdquo;{" "}
            <span className="muted">({check.summary.workspaceId})</span>, backed up{" "}
            {new Date(check.summary.createdAt).toLocaleString()}
          </div>
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Records</th>
                <th>Applied packages</th>
                <th>Open review items</th>
              </tr>
            </thead>
            <tbody>
              {check.summary.projects.map((p) => (
                <tr key={p.id}>
                  <td>{p.title}</td>
                  <td>{p.records}</td>
                  <td>{p.changePackages}</td>
                  <td>{p.openReviewItems}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted">
            {check.summary.counts.revisions} revisions, {check.summary.counts.sources} provenance sources,{" "}
            {check.summary.counts.auditEntries} audit entries, {check.summary.counts.importedFiles} imported files,{" "}
            {check.summary.counts.dictionaryEntries ?? 0} dictionary words, {check.summary.counts.recordImages ?? 0} images
          </div>
        </div>
      ) : null}

      {check && !check.ok ? (
        <div className="panel">
          <Banner tone="error">{BACKUP.cannotRestore}</Banner>
          <IssueList issues={check.issues} />
        </div>
      ) : null}

      {check?.ok && !outcome ? (
        <div className="row">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ minWidth: "min(24rem, 100%)" }}
            aria-label="Name for the restored workspace"
          />
          <button onClick={restore} disabled={pending || !name.trim()}>
            {BACKUP.restore}
          </button>
        </div>
      ) : null}

      {outcome?.ok ? (
        <Banner tone="ok">
          Restored &ldquo;{outcome.workspaceName}&rdquo;.{" "}
          {outcome.projects.map((p) => (
            <span key={p.id}>
              <Link href={`/projects/${p.id}`}>{p.title}</Link>{" "}
            </span>
          ))}
        </Banner>
      ) : null}
      {outcome && !outcome.ok ? (
        <div className="panel">
          <Banner tone="error">Restore rejected. Nothing was written.</Banner>
          <IssueList issues={outcome.issues} />
        </div>
      ) : null}
    </div>
  );
}
