import Link from "next/link";
import { fieldDiffs, textDiff } from "@/changePackage/diff";
import { StatusBadge } from "@/components/Badges";
import { FieldDiffTable, TextDiff } from "@/components/DiffView";
import { ActionButton, ConfirmAction } from "@/components/ConfirmAction";
import { HelpHint } from "@/components/HelpHint";
import { Button } from "@/components/ui/Button";
import type { RecordView } from "@/domain/records";
import { RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import type { RevisionWithSource } from "@/server/services/recordService";
import { RECORD, TRASH } from "@/ui/labels";
import { setProtectionAction, trashRecordAction } from "../../actions";
import { RecordRestoreForm } from "./RecordRestoreForm";
import { StatusForm } from "./RecordForms";

/* Status, protection, history and compare: shared by the Write details and the reference page. */

export function StatusSection({ projectId, record }: { projectId: string; record: RecordView }) {
  return (
    <section className="panel" id="record-status">
      <h2>{RECORD.statusHeading}</h2>
      <HelpHint anchor="canon-status" topic="canon status">
        Only &ldquo;approved&rdquo; means canon. Changing the status saves a new version.
      </HelpHint>
      <StatusForm
        key={record.id}
        projectId={projectId}
        recordId={record.id}
        revision={record.currentRevision}
        status={record.authorityStatus}
        isProtected={record.protected}
      />
    </section>
  );
}

export function ProtectionSection({ projectId, record }: { projectId: string; record: RecordView }) {
  return (
    <section className="panel" id="record-protection">
      <h2>{RECORD.protectionHeading}</h2>
      <p className="small muted">
        Protected records cannot be changed by change packages unless explicitly listed as overrides, and require an
        explicit unlock to edit here. Manuscript chapters and scenes are protected by default.
      </p>
      <HelpHint anchor="protection" topic="protection">
        {record.protected
          ? "Removing protection asks for a second confirmation first."
          : "Protecting a record does not create a new saved version."}
      </HelpHint>
      {record.protected ? (
        <ConfirmAction
          action={setProtectionAction.bind(null, projectId, record.id, false)}
          label={RECORD.unprotect}
          confirmLabel={RECORD.confirmUnprotect}
          pendingLabel={RECORD.unprotecting}
          details={<p className="small">{RECORD.unprotectDetails}</p>}
        />
      ) : (
        <ActionButton
          action={setProtectionAction.bind(null, projectId, record.id, true)}
          label={RECORD.protect}
          pendingLabel={RECORD.protecting}
        />
      )}
    </section>
  );
}

export interface InsideRecord {
  id: string;
  title: string;
  type: RecordType;
  protected: boolean;
}

export function TrashSection({ projectId, record, inside }: { projectId: string; record: RecordView; inside: InsideRecord[] }) {
  const anyProtected = record.protected || inside.some((r) => r.protected);
  return (
    <section className="panel" id="record-trash">
      <h2>{TRASH.sectionHeading}</h2>
      <HelpHint anchor="move-to-trash" topic="the Trash">
        It disappears from every list but keeps its history. You can restore it from the {TRASH.heading} page.
      </HelpHint>
      <ConfirmAction
        action={trashRecordAction.bind(null, projectId, record.id)}
        label={TRASH.moveRecord}
        confirmLabel={TRASH.confirmMove(record.title)}
        pendingLabel={TRASH.moving}
        unlockLabel={anyProtected ? TRASH.unlockProtected : undefined}
        details={
          inside.length ? (
            <div className="small">
              These move to the Trash with it, and come back with it:
              <ul>
                {inside.map((r) => (
                  <li key={r.id}>
                    {r.title} <span className="muted">({RECORD_TYPE_LABELS[r.type].toLowerCase()})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null
        }
      />
    </section>
  );
}

/** Where a revision came from, in words. */
export function sourceSummary(source: RevisionWithSource["source"]): string {
  switch (source.kind) {
    case "change_package":
      return `Change package ${source.packageId ?? ""}`.trim();
    case "markdown_import":
      return `Markdown import of ${source.originalFilename ?? "a file"}`;
    case "docx_import":
      return `Word import of ${source.originalFilename ?? "a file"}`;
    case "scrivener_import":
      return `Scrivener import of ${source.originalFilename ?? "a file"}`;
    case "ui":
      return "Edited in the app";
    case "autosave":
      return "Autosaved";
    case "restore":
      return source.conversationLabel ? `Restored from ${source.conversationLabel}` : "Restored from an earlier version";
    default:
      return `${source.kind} (${source.actor})`;
  }
}

export function HistorySection({ projectId, record, revisions }: { projectId: string; record: RecordView; revisions: RevisionWithSource[] }) {
  const base = `/projects/${projectId}/records/${record.id}`;
  return (
    <section className="panel" id="history">
      <h2>{RECORD.historyHeading}</h2>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={RECORD.historyHeading}>
        <table>
          <thead>
            <tr>
              <th>Rev</th>
              <th>Status</th>
              <th>Source</th>
              <th>When</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {revisions.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`${base}?from=${Math.max(1, r.revisionNumber - 1)}&to=${r.revisionNumber}#compare`}>{r.revisionNumber}</Link>
                </td>
                <td>
                  <StatusBadge status={r.authorityStatus} />
                </td>
                <td className="small">
                  {r.source.kind === "change_package" ? (
                    <>
                      package <code>{r.source.packageId}</code>
                      {r.source.conversationLabel ? <div className="muted">{r.source.conversationLabel}</div> : null}
                      {r.source.url ? (
                        <div>
                          <a href={r.source.url} target="_blank" rel="noreferrer">
                            conversation
                          </a>
                        </div>
                      ) : null}
                    </>
                  ) : r.source.kind === "markdown_import" ? (
                    <>
                      Markdown import of <code>{r.source.originalFilename}</code>
                      {r.source.conversationLabel ? <div className="muted">{r.source.conversationLabel}</div> : null}
                    </>
                  ) : r.source.kind === "restore" ? (
                    <>
                      Restored from {r.source.conversationLabel ?? "earlier version"}
                    </>
                  ) : (
                    <>
                      {r.source.kind} ({r.source.actor})
                    </>
                  )}
                </td>
                <td className="small muted">{r.createdAt.toLocaleString()}</td>
                <td className="small">
                  <RecordRestoreForm
                    projectId={projectId}
                    recordId={record.id}
                    currentRevision={record.currentRevision}
                    fromRevision={r.revisionNumber}
                    isProtected={record.protected}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CompareSection({
  projectId,
  record,
  revisions,
  query,
}: {
  projectId: string;
  record: RecordView;
  revisions: RevisionWithSource[];
  query: { from?: string; to?: string };
}) {
  const latest = revisions.reduce((max, r) => Math.max(max, r.revisionNumber), 1);
  const toNum = Number(query.to ?? latest);
  const fromNum = Number(query.from ?? Math.max(1, toNum - 1));
  const fromRev = revisions.find((r) => r.revisionNumber === fromNum);
  const toRev = revisions.find((r) => r.revisionNumber === toNum);
  return (
    <section className="panel" id="compare">
      <h2>{RECORD.compareHeading}</h2>
      <HelpHint anchor="saved-versions" topic="saved versions">
        Pick the same number in both boxes to read that version in full.
      </HelpHint>
      <form className="row" method="get">
        <label className="inline">
          from
          <select name="from" defaultValue={String(fromNum)}>
            {revisions.map((r) => (
              <option key={r.id} value={r.revisionNumber}>
                {r.revisionNumber}
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          to
          <select name="to" defaultValue={String(toNum)}>
            {revisions.map((r) => (
              <option key={r.id} value={r.revisionNumber}>
                {r.revisionNumber}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary">
          {RECORD.compare}
        </Button>
      </form>
      {fromRev && toRev && fromNum === toNum ? (
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <RecordRestoreForm
            projectId={projectId}
            recordId={record.id}
            currentRevision={record.currentRevision}
            fromRevision={toNum}
            isProtected={record.protected}
          />
        </div>
      ) : null}
      {fromRev && toRev && fromNum !== toNum && toNum < record.currentRevision ? (
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <RecordRestoreForm
            projectId={projectId}
            recordId={record.id}
            currentRevision={record.currentRevision}
            fromRevision={toNum}
            isProtected={record.protected}
          />
        </div>
      ) : null}
      {fromRev && toRev ? (
        <div className="stack" style={{ marginTop: "0.8rem" }}>
          {fromRev.title !== toRev.title ? (
            <div>
              Title: <del>{fromRev.title}</del> &rarr; <ins>{toRev.title}</ins>
            </div>
          ) : null}
          {fromRev.authorityStatus !== toRev.authorityStatus ? (
            <div className="row">
              Status: <StatusBadge status={fromRev.authorityStatus} /> &rarr; <StatusBadge status={toRev.authorityStatus} />
            </div>
          ) : null}
          <TextDiff parts={textDiff(fromRev.body, toRev.body)} />
          <FieldDiffTable diffs={fieldDiffs(fromRev.fields, toRev.fields)} />
        </div>
      ) : (
        <p className="muted">Select two existing revisions.</p>
      )}
    </section>
  );
}
