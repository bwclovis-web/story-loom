"use client";

import { ConfirmAction } from "@/components/ConfirmAction";
import { HelpHint } from "@/components/HelpHint";
import { RECORD } from "@/ui/labels";
import { restoreRecordAction } from "../../actions";

export function RecordRestoreForm({
  projectId,
  recordId,
  currentRevision,
  fromRevision,
  isProtected,
}: {
  projectId: string;
  recordId: string;
  currentRevision: number;
  fromRevision: number;
  isProtected: boolean;
}) {
  if (fromRevision < 1 || fromRevision >= currentRevision) return null;

  return (
    <ConfirmAction
      action={restoreRecordAction.bind(null, projectId, recordId, fromRevision)}
      label={RECORD.restoreVersion(fromRevision)}
      confirmLabel={RECORD.confirmRestore(fromRevision)}
      pendingLabel={RECORD.restoring}
      small
      danger={false}
      unlockLabel={isProtected ? RECORD.unlockProtected : undefined}
      details={
        <div className="stack small">
          <input type="hidden" name="expectedRevision" value={String(currentRevision)} />
          <p className="muted mb-0">{RECORD.restoreHelp}</p>
          <HelpHint anchor="saved-versions" topic="restoring a version">
            Nothing is deleted. The new version is listed in revision history as restored from this one.
          </HelpHint>
          <label className="inline">
            <input type="checkbox" name="includeFields" /> {RECORD.restoreIncludeFields}
          </label>
        </div>
      }
    />
  );
}