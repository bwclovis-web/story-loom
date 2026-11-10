import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTagBadge, StatusBadge } from "@/components/Badges";
import { TargetStatus, xrefHref } from "@/components/CrossRefsPanel";
import { HelpHint } from "@/components/HelpHint";
import { RECORD_TYPE_LABELS, isRecordType } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { loadCrossRefIndex } from "@/server/services/crossRefService";
import { findProject } from "@/server/services/projectService";
import { NAV, XREF, XREF_CHECK } from "@/ui/labels";
import { crossRefReport, type RecordRef } from "@/writing/crossRefs";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${NAV.crossRefCheck} · ${NAV.brand}` };

function typeLabel(type: string): string {
  return isRecordType(type) ? RECORD_TYPE_LABELS[type] : type;
}

export default async function CrossReferenceCheckPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getDb();
  const project = await findProject(db, projectId);
  if (!project) notFound();
  const report = crossRefReport(await loadCrossRefIndex(db, projectId));
  const recordHref = (id: string) => `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(id)}`;
  const Refs = ({ refs }: { refs: RecordRef[] }) => (
    <ul>
      {refs.map((r) => (
        <li key={r.recordId}>
          <Link href={recordHref(r.recordId)}>{r.title}</Link> <span className="small muted">{typeLabel(r.type)}</span>
        </li>
      ))}
    </ul>
  );
  const None = () => <p className="small muted">{XREF_CHECK.none}</p>;
  const count = (n: number) => <span className="muted"> ({n})</span>;
  const unnamed = report.names.filter((n) => n.chapters === 0);

  return (
    <div className="xref-report">
      <h1>{XREF_CHECK.heading}</h1>
      <p className="page-lead">{XREF_CHECK.lead}</p>
      <HelpHint anchor="cross-reference-check" topic="the cross-reference check">
        {report.supersededSkipped ? XREF_CHECK.supersededSkipped(report.supersededSkipped) : null}
      </HelpHint>

      <section className="panel" aria-labelledby="xref-undefined">
        <h2 id="xref-undefined">
          {XREF_CHECK.undefinedIds}
          {count(report.undefinedIds.length)}
        </h2>
        <p className="small muted">{XREF_CHECK.undefinedIdsNote}</p>
        {report.undefinedIds.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{XREF_CHECK.id}</th>
                  <th scope="col">{XREF_CHECK.mentionedIn}</th>
                </tr>
              </thead>
              <tbody>
                {report.undefinedIds.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <code>{u.id}</code>
                    </td>
                    <td>
                      <Refs refs={u.mentionedBy} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <None />
        )}
      </section>

      <section className="panel" aria-labelledby="xref-files">
        <h2 id="xref-files">
          {XREF_CHECK.missingFiles}
          {count(report.missingFiles.length)}
        </h2>
        {report.missingFiles.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{XREF_CHECK.filename}</th>
                  <th scope="col">{XREF_CHECK.mentionedIn}</th>
                </tr>
              </thead>
              <tbody>
                {report.missingFiles.map((f) => (
                  <tr key={f.filename}>
                    <td>
                      <code>{f.filename}</code>
                    </td>
                    <td>
                      <Refs refs={f.mentionedBy} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <None />
        )}
      </section>

      <section className="panel" aria-labelledby="xref-conflicts">
        <h2 id="xref-conflicts">
          {XREF_CHECK.conflicts}
          {count(report.conflicts.length)}
        </h2>
        <p className="small muted">{XREF_CHECK.conflictsNote}</p>
        {report.conflicts.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{XREF_CHECK.id}</th>
                  <th scope="col">{XREF_CHECK.definedIn}</th>
                </tr>
              </thead>
              <tbody>
                {report.conflicts.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <code>{c.id}</code>
                    </td>
                    <td>
                      <ul>
                        {c.places.map((p, i) => (
                          <li key={`${p.recordId}-${i}`}>
                            <Link href={xrefHref(projectId, "", p)}>{p.title}</Link>{" "}
                            <span className="small muted">
                              {p.via === "refIds" ? XREF_CHECK.given : p.via === "file" ? "" : `${XREF.definedIn(p.via)}: ${p.label}`}
                            </span>{" "}
                            {p.statusTag ? <SectionTagBadge tag={p.statusTag} /> : null}{" "}
                            {p.status ? <StatusBadge status={p.status} /> : null}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <None />
        )}
      </section>

      <section className="panel" aria-labelledby="xref-flagged">
        <h2 id="xref-flagged">
          {XREF_CHECK.flagged}
          {count(report.flaggedMentions.length)}
        </h2>
        {report.flaggedMentions.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{XREF_CHECK.from}</th>
                  <th scope="col">{XREF_CHECK.mention}</th>
                  <th scope="col">{XREF_CHECK.target}</th>
                </tr>
              </thead>
              <tbody>
                {report.flaggedMentions.map((m, i) => (
                  <tr key={`${m.from.recordId}-${m.token}-${i}`}>
                    <td>
                      <Link href={recordHref(m.from.recordId)}>{m.from.title}</Link>
                    </td>
                    <td>
                      <code>{m.token}</code>
                    </td>
                    <td>
                      <Link href={xrefHref(projectId, "", m.target)}>{m.target.title}</Link>
                      <TargetStatus projectId={projectId} target={m.target} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <None />
        )}
      </section>

      <section className="panel" aria-labelledby="xref-names">
        <h2 id="xref-names">
          {XREF_CHECK.names}
          {count(report.names.length)}
        </h2>
        <p className="small muted">{XREF_CHECK.namesNote}</p>
        {report.names.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{XREF_CHECK.record}</th>
                  <th scope="col">{XREF_CHECK.forms}</th>
                  <th scope="col">{XREF_CHECK.chapters}</th>
                  <th scope="col">{XREF_CHECK.mentions}</th>
                </tr>
              </thead>
              <tbody>
                {report.names.map((n) => (
                  <tr key={n.recordId}>
                    <td>
                      <Link href={recordHref(n.recordId)}>{n.title}</Link>{" "}
                      <span className="small muted">{typeLabel(n.type)}</span>
                    </td>
                    <td>{n.forms.join(", ")}</td>
                    <td>{n.chapters}</td>
                    <td>{n.mentions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <None />
        )}
        {unnamed.length ? (
          <p className="small muted">{XREF_CHECK.neverNamed(unnamed.map((n) => n.title))}</p>
        ) : null}
      </section>
    </div>
  );
}
