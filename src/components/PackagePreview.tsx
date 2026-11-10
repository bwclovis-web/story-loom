import Link from "next/link";
import type { OperationPreview, PackageApplyResult } from "@/server/services/changePackageService";
import { PACKAGE_IMPORT } from "@/ui/labels";

/* The summary of an applied change package, shared by the review screen and assistant proposals. */

export const OP_LABELS: Record<OperationPreview["op"], string> = {
  create_record: "Create",
  update_record: "Update",
  set_authority_status: "Set status",
};

export function ResultSummary({ result, projectId }: { result: PackageApplyResult; projectId: string }) {
  return (
    <div className="panel">
      <h3>
        Change summary for <code>{result.packageId}</code>
      </h3>
      <p className="small muted">
        {result.summary} &middot; applied <time dateTime={result.appliedAt} suppressHydrationWarning>{new Date(result.appliedAt).toLocaleString()}</time>
      </p>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Changed records">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Operation</th>
              <th>Record</th>
              <th>Revision</th>
            </tr>
          </thead>
          <tbody>
            {result.changes.map((c) => (
              <tr key={c.index}>
                <td>{c.index}</td>
                <td>{OP_LABELS[c.op]}</td>
                <td>
                  <Link href={`/projects/${projectId}/records/${c.recordId}`}>{c.title}</Link> <code className="small">{c.recordId}</code>
                </td>
                <td>
                  {c.previousRevision === null ? "new" : c.previousRevision} &rarr; {c.newRevision}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.reviewItems.length > 0 ? (
        <>
          <h3 style={{ marginTop: "1rem" }}>{PACKAGE_IMPORT.flaggedForReview}</h3>
          <ul className="small">
            {result.reviewItems.map((r) => (
              <li key={r.id}>
                <Link href={`/projects/${projectId}/records/${r.recordId}`}>{r.title}</Link>{" "}
                <span className="muted">[{r.origin === "package_note" ? "package note" : "detected mention"}]</span> {r.note}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
