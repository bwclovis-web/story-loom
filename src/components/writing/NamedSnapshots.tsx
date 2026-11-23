"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Atoms/Button";
import { Banner } from "@/components/ui/Banner";
import { WRITE } from "@/ui/labels";

export type NamedSnapshotItem = {
  revisionNumber: number;
  label: string;
};

/** Compact list of author-named revisions with compare / restore deep links. */
export function NamedSnapshotsStrip({
  projectId,
  recordId,
  currentRevision,
  snapshots,
  headingId,
  actions,
}: {
  projectId: string;
  recordId: string;
  currentRevision: number;
  snapshots: readonly NamedSnapshotItem[];
  headingId?: string;
  actions?: ReactNode;
}) {
  const base = `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(recordId)}`;
  return (
    <section className="panel named-snapshots" id="named-snapshots" aria-labelledby={headingId ?? "named-snapshots-heading"}>
      <div className="named-snapshots-head">
        <h2 id={headingId ?? "named-snapshots-heading"}>{WRITE.namedSnapshots}</h2>
        {actions}
      </div>
      <p className="small muted">{WRITE.namedSnapshotsLead}</p>
      {snapshots.length === 0 ? (
        <p className="small muted">{WRITE.namedSnapshotsEmpty}</p>
      ) : (
        <ul className="named-snapshots-list">
          {snapshots.map((snap) => {
            const from = Math.max(1, snap.revisionNumber - 1);
            const compareHref = `${base}?from=${from}&to=${snap.revisionNumber}#compare`;
            return (
              <li key={snap.revisionNumber} className="named-snapshots-item">
                <div className="named-snapshots-meta">
                  <span className="named-snapshots-label">{snap.label}</span>
                  <span className="small muted">
                    Rev {snap.revisionNumber}
                    {snap.revisionNumber === currentRevision ? " · tip" : ""}
                  </span>
                </div>
                <div className="named-snapshots-actions">
                  <Link className="small" href={compareHref}>
                    {snap.revisionNumber === currentRevision ? WRITE.namedSnapshotsCompare : WRITE.namedSnapshotsRestore}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Dialog + submit for takeNamedSnapshotAction. Keeps the editor form free of nested forms. */
export function TakeSnapshotDialog({
  open,
  onClose,
  onSubmit,
  pending,
  error,
  defaultLabel = "",
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (label: string) => void | Promise<void>;
  pending: boolean;
  error: string | null;
  defaultLabel?: string;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [label, setLabel] = useState(defaultLabel);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      setLabel(defaultLabel);
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, defaultLabel]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    void onSubmit(trimmed);
  };

  return (
    <dialog
      ref={dialogRef}
      className="take-snapshot-dialog"
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form onSubmit={submit} className="stack">
        <h2 id={`${id}-title`}>{WRITE.takeSnapshotHeading}</h2>
        <p className="small">{WRITE.takeSnapshotLead}</p>
        <label>
          {WRITE.snapshotLabel}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={120}
            required
            disabled={pending}
          />
        </label>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <div className="row">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {WRITE.close}
          </Button>
          <Button type="submit" disabled={pending || !label.trim()}>
            {pending ? WRITE.takeSnapshotWorking : WRITE.takeSnapshotDo}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
