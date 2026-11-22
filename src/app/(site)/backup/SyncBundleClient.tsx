"use client";

import { useMemo, useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import type { DiffPart } from "@/changePackage/diff";
import { foldUnchanged, unifiedSegments, type Segment } from "@/ui/packageReview";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { FileInput } from "@/components/ui/FileInput";
import { RadioGroup } from "@/components/ui/RadioGroup";
import type { Issue } from "@/domain/issues";
import type { SyncCompareResult, SyncMergeChoice } from "@/server/syncBundleService";
import { BACKUP, REVIEW } from "@/ui/labels";
import { applySyncBundleMergeAction, inspectSyncBundleAction } from "./syncActions";

type WorkspaceOption = { id: string; name: string; projects: Array<{ id: string; title: string }> };

function DiffSegments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) => {
        if (s.kind === "added")
          return (
            <ins key={i}>
              {s.text}
            </ins>
          );
        if (s.kind === "removed")
          return (
            <del key={i}>
              {s.text}
            </del>
          );
        if (s.kind === "folded")
          return (
            <details key={i} className="diff-fold">
              <summary>{REVIEW.unchangedLines(s.lines)}</summary>
              <span>{s.text}</span>
            </details>
          );
        return <span key={i}>{s.text}</span>;
      })}
    </>
  );
}

function SyncBodyDiff({ parts }: { parts: DiffPart[] }) {
  return (
    <div className="diff-body">
      <DiffSegments segments={foldUnchanged(unifiedSegments(parts))} />
    </div>
  );
}

const CHOICE_OPTIONS: Array<{ value: SyncMergeChoice; label: string }> = [
  { value: "skip", label: BACKUP.syncChoiceSkip },
  { value: "keep_local", label: BACKUP.syncChoiceLocal },
  { value: "take_remote", label: BACKUP.syncChoiceRemote },
];

export function SyncBundleClient({ workspaces }: { workspaces: WorkspaceOption[] }) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [projectId, setProjectId] = useState(workspaces[0]?.projects[0]?.id ?? "");
  const [compare, setCompare] = useState<SyncCompareResult | null>(null);
  const [bundleJson, setBundleJson] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, SyncMergeChoice>>({});
  const [confirmProtected, setConfirmProtected] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const projects = useMemo(
    () => workspaces.find((w) => w.id === workspaceId)?.projects ?? [],
    [workspaceId, workspaces],
  );

  const interesting = compare?.rows.filter((r) => r.kind !== "match") ?? [];

  const inspect = (file: File | null) => {
    if (!file || !workspaceId) return;
    startTransition(async () => {
      const text = await file.text();
      const result = await inspectSyncBundleAction(workspaceId, text);
      if (!result.ok) {
        setCompare(null);
        setBundleJson(null);
        setIssues(result.issues);
        setMessage(null);
        return;
      }
      setIssues([]);
      setCompare(result.data.compare);
      setBundleJson(result.data.bundleJson);
      const defaults: Record<string, SyncMergeChoice> = {};
      for (const row of result.data.compare.rows) {
        if (row.kind === "conflict" || row.kind === "remote_only") defaults[row.recordId] = "skip";
      }
      setChoices(defaults);
      setMessage(BACKUP.syncInspectReady(result.data.compare.rows.filter((r) => r.kind !== "match").length));
    });
  };

  const applyMerge = () => {
    if (!bundleJson || !projectId) return;
    startTransition(async () => {
      const list = Object.entries(choices).map(([recordId, choice]) => ({ recordId, choice }));
      const result = await applySyncBundleMergeAction(workspaceId, projectId, bundleJson, list, confirmProtected);
      if (!result.ok) {
        setIssues(result.issues);
        setMessage(null);
        return;
      }
      setIssues([]);
      setMessage(result.data.summary);
    });
  };

  return (
    <div className="stack">
      <p className="small muted">{BACKUP.syncLead}</p>
      <IssueList issues={issues} />
      {message ? <Banner tone="ok">{message}</Banner> : null}
      <label>
        {BACKUP.syncWorkspace}
        <select
          value={workspaceId}
          disabled={pending}
          onChange={(e) => {
            const id = e.target.value;
            setWorkspaceId(id);
            const first = workspaces.find((w) => w.id === id)?.projects[0]?.id ?? "";
            setProjectId(first);
            setCompare(null);
          }}
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {BACKUP.syncProject}
        <select value={projectId} disabled={pending || projects.length === 0} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <FileInput
        accept="application/json,.json"
        disabled={pending || !workspaceId}
        onChange={(e) => inspect(e.target.files?.[0] ?? null)}
      />
      {compare ? (
        <SyncDiffReview interesting={interesting} choices={choices} setChoices={setChoices} compare={compare} />
      ) : null}
      {interesting.some((r) => r.localProtected) ? (
        <label className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
          <input
            type="checkbox"
            checked={confirmProtected}
            onChange={(e) => setConfirmProtected(e.target.checked)}
          />
          {BACKUP.syncConfirmProtected}
        </label>
      ) : null}
      {compare && interesting.length > 0 ? (
        <Button type="button" size="sm" disabled={pending || !projectId} onClick={applyMerge}>
          {BACKUP.syncApplyMerge}
        </Button>
      ) : null}
    </div>
  );
}

function SyncDiffReview({
  interesting,
  choices,
  setChoices,
  compare,
}: {
  interesting: SyncCompareResult["rows"];
  choices: Record<string, SyncMergeChoice>;
  setChoices: (value: Record<string, SyncMergeChoice>) => void;
  compare: SyncCompareResult;
}) {
  if (interesting.length === 0) {
    return <p className="small muted">{BACKUP.syncNoDiffs}</p>;
  }
  return (
    <div className="stack">
      <p className="small muted">
        {BACKUP.syncBundleFrom(compare.bundleWorkspaceName, compare.exportedAt)}
      </p>
      <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
        {interesting.map((row) => (
          <li key={row.recordId} className="panel" style={{ padding: "0.75rem" }}>
            <p>
              <strong>{row.title || row.recordId}</strong>{" "}
              <span className="muted small">
                {BACKUP.syncKind(row.kind)} · local rev {row.localRevision ?? "—"} · remote rev {row.remoteRevision ?? "—"}
              </span>
            </p>
            {row.kind === "conflict" && row.bodyDiff.length > 0 ? <SyncBodyDiff parts={row.bodyDiff} /> : null}
            <RadioGroup
              legend={BACKUP.syncChoiceLegend}
              name={`sync-${row.recordId}`}
              value={choices[row.recordId] ?? "skip"}
              options={CHOICE_OPTIONS}
              onValueChange={(value) => setChoices({ ...choices, [row.recordId]: value as SyncMergeChoice })}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}