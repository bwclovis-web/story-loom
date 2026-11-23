"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ButtonLink } from "@/components/ui/Atoms/Button";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { fetchManuscriptSnapshotAction, type ManuscriptSnapshot } from "@/app/projects/[projectId]/records/[recordId]/split-actions";
import { hasTextChange, textDiff } from "@/changePackage/diff";
import { confirmLeave } from "@/components/shell/unsaved";
import { splitGroups, type ManuscriptSplitOption } from "@/writing/splitPeers";
import { WRITE } from "@/ui/labels";

export type { ManuscriptSplitOption };

export function WriteSplitPane({
  projectId,
  recordId,
  splitRecordId,
  options,
  liveText,
  onSelectSplit,
}: {
  projectId: string;
  recordId: string;
  splitRecordId: string;
  options: readonly ManuscriptSplitOption[];
  liveText: string;
  onSelectSplit: (recordId: string) => void;
}) {
  const titleId = useId();
  const [snapshot, setSnapshot] = useState<ManuscriptSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setSnapshot(null);
    void (async () => {
      const result = await fetchManuscriptSnapshotAction(projectId, splitRecordId);
      if (cancelled) return;
      if (!result.ok) {
        setError(true);
        setSnapshot(null);
      } else {
        setSnapshot(result.snapshot);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, splitRecordId]);

  const href = `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(splitRecordId)}`;
  const peers = options.filter((o) => o.id !== recordId);
  const groups = splitGroups(peers);
  const diff = useMemo(
    () => (showDiff && snapshot ? textDiff(liveText, snapshot.body) : []),
    [showDiff, snapshot, liveText],
  );

  return (
    <aside className="write-split" aria-labelledby={titleId}>
      <header className="write-split-head">
        <h2 id={titleId} className="write-split-title">
          {WRITE.splitPaneHeading}
        </h2>
        <p className="small muted" role="status">
          {WRITE.splitReadOnly}
        </p>
      </header>
      <div className="write-split-body">
        {loading ? <p className="small muted">{WRITE.splitLoading}</p> : null}
        {error ? <p className="small">{WRITE.splitLoadError}</p> : null}
        {snapshot ? (
          <>
            {snapshot.kind === "scene" && snapshot.parentTitle ? (
              <p className="write-split-crumb small muted">
                {WRITE.inChapter} {snapshot.parentTitle}
              </p>
            ) : null}
            <h3 className="write-split-doc-title">{snapshot.title}</h3>
            <p className="small muted">
              {WRITE.savedRevision(snapshot.revision)}
              {snapshot.isProtected ? ` · ${WRITE.protectedReadOnly}` : null}
            </p>
            {showDiff ? (
              hasTextChange(diff) ? (
                <p className="write-split-diff" aria-label={WRITE.splitDiff}>
                  {diff.map((part, index) => (
                    <span key={index} className={part.added ? "diff-added" : part.removed ? "diff-removed" : undefined}>
                      {part.value}
                    </span>
                  ))}
                </p>
              ) : (
                <p className="small muted">{WRITE.splitDiffHint}</p>
              )
            ) : (
              <textarea
                className="document manuscript-text write-split-text"
                readOnly
                aria-label={WRITE.splitPaneText}
                value={snapshot.body}
                tabIndex={0}
              />
            )}
          </>
        ) : null}
      </div>
      <footer className="write-split-foot">
        <label className="write-split-pick">
          <span className="small muted">{WRITE.splitPick}</span>
          <select
            value={peers.some((o) => o.id === splitRecordId) ? splitRecordId : peers[0]?.id ?? ""}
            onChange={(e) => {
              const next = e.target.value;
              if (next && next !== recordId) onSelectSplit(next);
            }}
          >
            {groups.map((group) => (
              <optgroup key={group.draftId || group.draftLabel} label={group.draftLabel}>
                {group.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.kind === "scene" ? `${WRITE.sceneKind}: ${option.title}` : option.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <Checkbox checked={showDiff} onChange={(event) => setShowDiff(event.target.checked)} label={WRITE.splitDiff} />
        <ButtonLink
          href={href}
          variant="outline"
          size="sm"
          onClick={(e) => {
            if (!confirmLeave()) e.preventDefault();
          }}
        >
          {WRITE.splitEditHere}
        </ButtonLink>
      </footer>
    </aside>
  );
}
