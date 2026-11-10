import Link from "next/link";
import { IssueList } from "@/components/IssueList";
import type { JsonValue } from "@/domain/json";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import type { OperationPreview } from "@/server/services/changePackageService";
import { REVIEW } from "@/ui/labels";
import { foldUnchanged, sideBySideSegments, unifiedSegments, type ReviewRecord, type Segment } from "@/ui/packageReview";

/* One record's changes: metadata first, then the text. All content is rendered as text, never as HTML. */

const OP_NAMES: Record<OperationPreview["op"], string> = {
  create_record: "Create",
  update_record: "Update",
  set_authority_status: "Set status",
};

function Segments({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) => {
        if (s.kind === "added")
          return (
            <ins key={i}>
              <span className="sr-only">[{REVIEW.added}: </span>
              {s.text}
              <span className="sr-only">]</span>
            </ins>
          );
        if (s.kind === "removed")
          return (
            <del key={i}>
              <span className="sr-only">[{REVIEW.removed}: </span>
              {s.text}
              <span className="sr-only">]</span>
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

function fieldText(value: JsonValue | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

interface DetailChange {
  key: string;
  label: string;
  kind: "added" | "removed" | "changed";
  before: string;
  after: string;
  code?: boolean;
}

function detailChanges(op: OperationPreview): DetailChange[] {
  const isNew = op.titleBefore === null;
  const out: DetailChange[] = [];
  if (isNew || op.titleBefore !== op.titleAfter) {
    out.push({ key: "title", label: REVIEW.title, kind: isNew ? "added" : "changed", before: op.titleBefore ?? "", after: op.titleAfter });
  }
  if (op.statusBefore !== op.statusAfter) {
    out.push({ key: "status", label: REVIEW.canonStatus, kind: isNew ? "added" : "changed", before: op.statusBefore ?? "", after: op.statusAfter });
  }
  if (op.supersededByBefore !== op.supersededByAfter) {
    out.push({
      key: "superseded",
      label: REVIEW.supersededBy,
      kind: op.supersededByBefore === null ? "added" : op.supersededByAfter === null ? "removed" : "changed",
      before: op.supersededByBefore ?? "",
      after: op.supersededByAfter ?? "",
      code: true,
    });
  }
  for (const d of op.fieldDiffs) {
    out.push({ key: `f:${d.key}`, label: d.key, kind: d.change, before: fieldText(d.before), after: fieldText(d.after), code: true });
  }
  return out;
}

const KIND_LABEL = { added: REVIEW.added, removed: REVIEW.removed, changed: REVIEW.changed } as const;

function DetailChanges({ op }: { op: OperationPreview }) {
  const changes = detailChanges(op);
  if (!changes.length) return <p className="small muted">{REVIEW.noDetailChanges}</p>;
  return (
    <ul className="review-changes">
      {changes.map((c) => (
        <li key={c.key} className="review-change">
          <div className="review-change-head">
            {c.code ? <code>{c.label}</code> : <strong>{c.label}</strong>} <span className={`review-kind ${c.kind}`}>{KIND_LABEL[c.kind]}</span>
          </div>
          <div className="review-pair">
            {c.kind !== "added" ? (
              <div className="review-side removed">
                <span className="review-tag">{REVIEW.removed}</span>
                <del className="review-value">{c.before || REVIEW.emptyText}</del>
              </div>
            ) : null}
            {c.kind !== "removed" ? (
              <div className="review-side added">
                <span className="review-tag">{REVIEW.added}</span>
                <ins className="review-value">{c.after || REVIEW.emptyText}</ins>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function TextChanges({ op }: { op: OperationPreview }) {
  const isNew = op.titleBefore === null;
  if (!isNew && !op.bodyChanged) return <p className="small muted">{REVIEW.textUnchanged}</p>;

  const afterText = op.bodyDiff.filter((p) => !p.removed).map((p) => p.value).join("");
  const beforeText = op.bodyDiff.filter((p) => !p.added).map((p) => p.value).join("");
  const { before, after } = sideBySideSegments(op.bodyDiff);
  const beforeHeading = isNew ? REVIEW.afterApplying : REVIEW.current(op.currentRevision ?? "?");

  if (isNew) {
    return (
      <div className="review-text">
        <p className="small muted">{REVIEW.newRecordBefore}</p>
        <div className="review-column">
          <h4 className="review-column-head">{beforeHeading}</h4>
          {afterText ? (
            <div className="diff review-diff" tabIndex={0} role="region" aria-label={REVIEW.afterApplying}>
              <Segments segments={foldUnchanged(after)} />
            </div>
          ) : (
            <p className="review-empty">{REVIEW.newRecordNoText}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="review-text">
      <p className="review-legend small">
        <del>{REVIEW.removed}</del> text is struck through; <ins>{REVIEW.added.toLowerCase()}</ins> text is underlined.
      </p>
      <div className="review-sbs">
        <div className="review-column">
          <h4 className="review-column-head">{beforeHeading}</h4>
          {beforeText ? (
            <div className="diff review-diff" tabIndex={0} role="region" aria-label={beforeHeading}>
              <Segments segments={foldUnchanged(before)} />
            </div>
          ) : (
            <p className="review-empty">{REVIEW.emptyText}</p>
          )}
        </div>
        <div className="review-column">
          <h4 className="review-column-head">{REVIEW.afterApplying}</h4>
          {afterText ? (
            <div className="diff review-diff" tabIndex={0} role="region" aria-label={REVIEW.afterApplying}>
              <Segments segments={foldUnchanged(after)} />
            </div>
          ) : (
            <p className="review-empty">{REVIEW.allTextRemoved}</p>
          )}
        </div>
      </div>
      <div className="review-unified">
        <h4 className="review-column-head">
          {beforeHeading} &rarr; {REVIEW.afterApplying}
        </h4>
        <div className="diff review-diff" tabIndex={0} role="region" aria-label={`${beforeHeading} to ${REVIEW.afterApplying}`}>
          <Segments segments={foldUnchanged(unifiedSegments(op.bodyDiff))} />
        </div>
        {!afterText ? <p className="review-empty">{REVIEW.allTextRemoved}</p> : null}
      </div>
    </div>
  );
}

export function ReviewDiff({ record, projectId, headingId }: { record: ReviewRecord; projectId: string; headingId: string }) {
  return (
    <div className="review-record">
      <div className="review-record-head">
        <h2 id={headingId}>{REVIEW.changesFor(record.title)}</h2>
        <p className="small muted review-record-meta">
          {RECORD_TYPE_LABELS[record.type]}
          {record.previousTitle ? <> &middot; renamed from &ldquo;{record.previousTitle}&rdquo;</> : null} &middot;{" "}
          {record.idAssignedOnApply ? (
            REVIEW.idOnApply
          ) : record.isNew ? (
            <code>{record.recordId}</code>
          ) : (
            <Link href={`/projects/${projectId}/records/${record.recordId}`} target="_blank" rel="noopener noreferrer">
              <code>{record.recordId}</code>
              <span className="sr-only"> (opens in a new tab)</span>
            </Link>
          )}
        </p>
      </div>
      {record.operations.map((op) => {
        const stale = op.issues.some((i) => i.code === "STALE_REVISION");
        return (
          <section key={op.index} className="review-op" aria-label={`${OP_NAMES[op.op]}, operation ${op.index}`}>
            {record.operations.length > 1 ? (
              <p className="small">
                <strong>{OP_NAMES[op.op]}</strong> (operation {op.index})
              </p>
            ) : null}
            {stale && op.expectedRevision !== null && op.currentRevision !== null ? (
              <p className="banner warn small">{REVIEW.staleRecord(op.expectedRevision, op.currentRevision)}</p>
            ) : null}
            <IssueList issues={op.issues} />
            {op.note ? (
              <p className="small">
                <span className="muted">{REVIEW.note}:</span> {op.note}
              </p>
            ) : null}
            <h3 className="review-section-head">{REVIEW.detailsHeading}</h3>
            <DetailChanges op={op} />
            <h3 className="review-section-head">{REVIEW.textHeading}</h3>
            <TextChanges op={op} />
          </section>
        );
      })}
    </div>
  );
}
